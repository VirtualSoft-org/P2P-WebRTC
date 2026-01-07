import { supabase as defaultSupabase } from './supabase'
import { ensureAuth } from './auth'
import type { SupabaseClient } from '@supabase/supabase-js'
import { initSignaling, closeSignaling } from './signaling'
import { initWebRTC, broadcast, onMessage, cleanup, connectToPeer } from './webrtc'
import { joinPresence, leavePresence } from './presence'
import { listenForHostChanges, amIHost } from './hostElection'
import { randomUUID } from 'crypto'

export interface RoomConnectionResult {
  roomId: string
  role: string
  isHost: boolean
  autoConnect?: boolean
}

export async function joinRoom(roomId: string, client?: SupabaseClient, roomName?: string) {
  const sb = client ?? defaultSupabase
  const userId = await ensureAuth(sb)
  console.log('Logged in as:', userId)

  const { data: roomExists } = await sb
    .from('rooms')
    .select('id')
    .eq('id', roomId)
    .maybeSingle()

  if (!roomExists) {
    console.log(`[joinRoom] Room ${roomId} doesn't exist, creating it...`)
    const { error: createError } = await sb
      .from('rooms')
      .insert({ id: roomId, room_name: roomName || roomId, owner: userId })

    if (createError) {
      console.error('Create room failed:', createError)
      throw createError
    }
    console.log(`[joinRoom] Room ${roomId} created`)
  }

  const { error } = await sb
    .from('room_members')
    .insert({
      room_id: roomId,
      user_id: userId
    })

  if (error) {
    console.error('Join room failed:', error)
    return
  }

  try {
    const { data: claimed, error: claimErr } = await sb
      .from('rooms')
      .update({ owner: userId })
      .eq('id', roomId)
      .is('owner', null)
      .select('owner')
      .maybeSingle()

    if (claimErr) {
      console.warn('[joinRoom] host claim error:', claimErr)
    } else if (claimed && claimed.owner === userId) {
      console.log(`[joinRoom] Claimed host for room ${roomId} as ${userId}`)
    }
  } catch (err) {
    console.warn('[joinRoom] error attempting host claim', err)
  }

  console.log(`✅ User ${userId} joined room ${roomId}`)
}

export async function leaveRoom(roomId: string, client?: SupabaseClient) {
  const sb = client ?? defaultSupabase
  const userId = await ensureAuth(sb)

  try {
    const { error: delErr } = await sb
      .from('room_members')
      .delete()
      .match({ room_id: roomId, user_id: userId })

    if (delErr) {
      console.error('[leaveRoom] error deleting membership:', delErr)
      return
    }

    console.log(`[leaveRoom] ${userId} left room ${roomId}`)

    const { data: roomData, error: roomErr } = await sb
      .from('rooms')
      .select('owner')
      .eq('id', roomId)
      .maybeSingle()

    if (roomErr) {
      console.warn('[leaveRoom] error fetching room row:', roomErr)
      return
    }

    if (!roomData) return

    const currentHost = roomData.owner
    if (currentHost !== userId) return

    const { data: rows, error: rowsErr } = await sb
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)
      .order('user_id', { ascending: true })
      .limit(1)

    if (rowsErr) {
      console.warn('[leaveRoom] error fetching next candidate:', rowsErr)
      return
    }

    const candidate = rows && rows.length ? rows[0].user_id : null

    if (!candidate) {
      await sb.from('rooms').update({ owner: null }).eq('id', roomId)
      console.log('[leaveRoom] cleared host (no members left)')
      return
    }

    const { data: updated, error: updateErr } = await sb
      .from('rooms')
      .update({ owner: candidate })
      .eq('id', roomId)
      .eq('owner', currentHost)
      .select('owner')
      .maybeSingle()

    if (updateErr) {
      console.warn('[leaveRoom] error promoting candidate:', updateErr)
      return
    }

    if (updated && updated.owner === candidate) {
      console.log(`[leaveRoom] promoted ${candidate} to host for room ${roomId}`)
    } else {
      console.log('[leaveRoom] promotion did not take effect (race or changed host)')
    }
  } catch (err) {
    console.error('[leaveRoom] unexpected error:', err)
  }
}

/**
 * Create a new room and connect to it
 */
export async function createRoom(roomName: string, autoConnect: boolean = false, client?: SupabaseClient): Promise<RoomConnectionResult> {
  const sb = client ?? defaultSupabase
  const roomId = randomUUID()
  
  await joinRoom(roomId, sb, roomName)
  await joinPresence(roomId, 'host')
  await initSignaling(roomId)
  await initWebRTC(roomId, autoConnect)
  
  const isHost = await amIHost(roomId)
  
  return {
    roomId,
    role: 'host',
    isHost,
    autoConnect
  }
}

/**
 * Connect to an existing room
 */
export async function connectToExistingRoom(roomId: string, role: string, client?: SupabaseClient): Promise<RoomConnectionResult> {
  const sb = client ?? defaultSupabase
  
  await joinRoom(roomId, sb)
  await joinPresence(roomId, role)
  await initSignaling(roomId)
  await initWebRTC(roomId, false) // Clients don't set auto-connect, it's room-level
  
  const isHost = await amIHost(roomId)
  
  return {
    roomId,
    role,
    isHost
  }
}

/**
 * Disconnect from a room
 */
export async function disconnectFromRoom(roomId: string): Promise<void> {
  await leavePresence()
  await closeSignaling()
  await cleanup()
  await leaveRoom(roomId)
}
