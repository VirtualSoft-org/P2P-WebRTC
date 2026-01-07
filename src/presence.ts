import { supabase } from './supabase'
import { ensureAuth } from './auth'
import { leaveRoom } from './joinRoom'

let channel: any = null
let tracked = false
let currentRoomId: string | null = null

export async function joinPresence(roomId: string, role: string) {
  if (!roomId) throw new Error('roomId is required')

  if (channel) {
    await leavePresence()
  }

  const userId = await ensureAuth()

  const topic = `presence:${roomId}`
  channel = supabase.channel(topic, { config: { presence: { enabled: true } } })

  channel.on('presence', { event: 'sync' }, () => {
    try {
      const state = channel.presenceState()
      if (process.env.DEBUG === 'true') {
        console.log(`Presence sync for room ${roomId}:`, state)
      }
    } catch (e) {
      // ignore
    }
  })

  channel.on('presence', { event: 'join' }, (payload: any) => {
    const { key, currentPresences, newPresences } = payload || {}
    if (process.env.DEBUG === 'true') {
      console.log(`User joined (room=${roomId}) key=${key} current=`, currentPresences, 'new=', newPresences)
    }
  })

  channel.on('presence', { event: 'leave' }, (payload: any) => {
    const { key, currentPresences, leftPresences } = payload || {}
    if (process.env.DEBUG === 'true') {
      console.log(`User left (room=${roomId}) key=${key} left=`, leftPresences, 'current=', currentPresences)
    }

    ;(async () => {
      try {
        const leftUserId = key
        if (!leftUserId) return
        const { error } = await supabase
          .from('room_members')
          .delete()
          .match({ room_id: roomId, user_id: leftUserId })

        if (error) {
          console.warn('[presence] error deleting member on leave:', error)
        } else {
          console.log(`[presence] removed membership for ${leftUserId} from room ${roomId}`)
        }
      } catch (err) {
        console.error('[presence] unexpected error deleting member on leave:', err)
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    let settled = false
    channel.subscribe((status: any, err?: Error) => {
      if (settled) return
      if (err) {
        settled = true
        reject(err)
        return
      }
      if (status === 'SUBSCRIBED') {
        settled = true
        resolve()
        return
      }
    })
    setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error('subscribe timeout'))
      }
    }, 5000)
  })

  const trackRes = await channel.track({ user_id: userId, role })
  if (trackRes !== 'ok') {
    try {
      await channel.unsubscribe()
    } catch {}
    channel = null
    throw new Error(`track failed: ${String(trackRes)}`)
  }

  tracked = true
  currentRoomId = roomId
  console.log(`✅ User ${userId} joined presence for room ${roomId} as role=${role}`)

  // Wait for presence sync to complete before reconciliation
  // This prevents removing users that are still syncing
  await new Promise(resolve => setTimeout(resolve, 2000))

  try {
    const state = channel.presenceState()
    const presentUserIds = new Set<string>()
    for (const key of Object.keys(state || {})) {
      const metas = state[key]
      if (Array.isArray(metas) && metas.length > 0) {
        const meta = metas[0]
        if (meta && meta.user_id) presentUserIds.add(meta.user_id)
      }
    }

    // Only do reconciliation if we have at least one presence entry
    // This ensures presence sync has completed
    if (presentUserIds.size === 0 && Object.keys(state || {}).length === 0) {
      console.log('[presence] Skipping reconciliation - presence sync may not be complete')
      return
    }

    const { data: members, error: membersErr } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)

    if (!membersErr && Array.isArray(members)) {
      const toRemove: string[] = []
      for (const m of members) {
        // Only remove if user is definitely not in presence AND not the current user
        // This prevents removing users during sync or temporary disconnects
        if (!presentUserIds.has(m.user_id) && m.user_id !== userId) {
          toRemove.push(m.user_id)
        }
      }

      // Only remove if we have confirmed presence state (at least 1 user present)
      // This prevents removing users when presence sync hasn't completed
      if (toRemove.length > 0 && presentUserIds.size > 0) {
        for (const uid of toRemove) {
          try {
            const { error: delErr } = await supabase
              .from('room_members')
              .delete()
              .match({ room_id: roomId, user_id: uid })

            if (delErr) console.warn('[presence] error deleting stale member', uid, delErr)
            else console.log('[presence] deleted stale room_member for', uid)
          } catch (err) {
            console.warn('[presence] unexpected error deleting stale member', uid, err)
          }
        }
      }
    } else if (membersErr) {
      console.warn('[presence] error fetching room_members for reconciliation', membersErr)
    }
  } catch (err) {
    console.warn('[presence] error during presence->room_members reconciliation', err)
  }
}

export async function leavePresence() {
  if (!channel) return

  try {
    if (tracked) {
      await channel.untrack()
      tracked = false
    }
  } catch (e) {
  }

  if (currentRoomId) {
    try {
      await leaveRoom(currentRoomId)
    } catch (err) {
      console.warn('Error leaving room membership during presence.leavePresence:', err)
    }
    currentRoomId = null
  }

  try {
    await channel.unsubscribe()
  } catch (e) {
    console.error('Error unsubscribing presence channel:', e)
  }

  channel = null
  console.log('Left presence channel')
}

export default {
  joinPresence,
  leavePresence
}
