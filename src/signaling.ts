import { supabase } from './supabase'
import { ensureAuth } from './auth'

type SignalType = 'offer' | 'answer' | 'ice' | 'host-elected'

type SignalMessage = {
  from: string
  to: string
  type: SignalType
  data: any
}

let channel: any = null
let privateChannel: any = null
const privateChannels: Map<string, any> = new Map()
let myUserId: string | null = null
let roomTopic: string | null = null
const listeners: Array<(msg: SignalMessage) => void> = []

function getUserChannelName(userId: string): string {
  return `user:${userId}`
}

/** Initialize signaling on the presence channel for `roomId`. */
export async function initSignaling(roomId: string) {
  if (!roomId) throw new Error('roomId is required')

  // close existing
  if (channel) await closeSignaling()
  if (privateChannel) {
    try {
      await privateChannel.unsubscribe()
    } catch (e) {
      console.error('[signaling] private channel cleanup error', e)
    }
    privateChannel = null
  }

  myUserId = await ensureAuth()
  roomTopic = `room:${roomId}`
  const privateTopic = getUserChannelName(myUserId)

  // create room broadcast channel for host updates
  channel = supabase.channel(roomTopic, { config: { broadcast: { self: false } } })

  // create private channel for receiving direct messages
  privateChannel = supabase.channel(privateTopic, { config: { broadcast: { self: false } } })

  // Listen for signals on private channel
  privateChannel.on(
    'broadcast',
    { event: 'signal' },
    ({ payload }: { payload: SignalMessage }) => {
      dispatchSignal(payload)
    }
  )

  // Listen for host updates on room channel
  channel.on(
    'broadcast',
    { event: 'host-update' },
    ({ payload }: { payload: SignalMessage }) => {
      dispatchSignal(payload)
    }
  )

  // Subscribe to both channels
  await Promise.all([
    new Promise<void>((resolve, reject) => {
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
          console.log(`[signaling] subscribed to room ${roomTopic} as ${myUserId}`)
          resolve()
        }
      })
      setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error('room subscribe timeout'))
        }
      }, 5000)
    }),
    new Promise<void>((resolve, reject) => {
      let settled = false
      privateChannel.subscribe((status: any, err?: Error) => {
        if (settled) return
        if (err) {
          settled = true
          reject(err)
          return
        }
        if (status === 'SUBSCRIBED') {
          settled = true
          console.log(`[signaling] subscribed to private channel ${privateTopic}`)
          resolve()
        }
      })
      setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error('private subscribe timeout'))
        }
      }, 5000)
    })
  ])
}

/** Send a signaling message to another user. */
export async function sendSignal(to: string, type: SignalType, data: any) {
  if (!myUserId) throw new Error('not authenticated')
  if (to === myUserId) {
    console.warn('[signaling] Attempted to send signal to self, ignoring')
    return
  }

  // Serialize ICE candidates properly
  let serializedData = data
  if (type === 'ice' && data) {
    serializedData = {
      candidate: data.candidate,
      sdpMLineIndex: data.sdpMLineIndex,
      sdpMid: data.sdpMid,
    }
  }

  const msg: SignalMessage = { from: myUserId, to, type, data: serializedData }
  console.log(`[signaling] sending ${type} → ${to.substring(0, 8)}`)

  if (type === 'host-elected') {
    if (!channel) throw new Error('room channel not initialized')
    return await channel.send({ type: 'broadcast', event: 'host-update', payload: msg })
  } else {
    // Cache private channels so we reuse subscriptions and ensure messages are delivered
    let userChannel = privateChannels.get(to)
    if (!userChannel) {
      userChannel = supabase.channel(getUserChannelName(to), { config: { broadcast: { self: false } } })
      privateChannels.set(to, userChannel)
      // subscribe immediately (fire-and-forget)
      userChannel.subscribe((status: any, err?: Error) => {
        if (err) console.warn('[signaling] private channel subscribe error for', to, err)
        else if (status === 'SUBSCRIBED') console.log('[signaling] private channel subscribed for', to)
      })
    }

    try {
      const res = await userChannel.send({ type: 'broadcast', event: 'signal', payload: msg })
      console.log('[signaling] sent to private channel', to.substring(0, 8))
      return res
    } catch (e) {
      console.error('[signaling] send to private channel failed', e)
      throw e
    }
  }
}

/** Register a callback for incoming signals addressed to this user. */
export function onSignal(cb: (msg: SignalMessage) => void) {
  listeners.push(cb)
  return () => {
    const idx = listeners.indexOf(cb)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

/** Dispatch a received signal message to listeners. */
function dispatchSignal(msg: SignalMessage) {
  if (!myUserId) return
  if (msg.to !== myUserId) return
  if (!['offer', 'answer', 'ice', 'host-elected'].includes(msg.type)) return

  console.log(`[signaling] ${msg.type} ← ${msg.from}`)

  for (const cb of listeners) {
    try {
      cb(msg)
    } catch (e) {
      console.error('[signaling] Listener error:', e)
    }
  }
}

/** Close the signaling channel and clear listeners. */
export async function closeSignaling() {
  try {
    if (privateChannel) {
      try {
        await privateChannel.unsubscribe()
      } catch (e) {
        console.error('[signaling] private unsubscribe error', e)
      }
    }
    if (channel) {
      try {
        await channel.unsubscribe()
      } catch (e) {
        console.error('[signaling] room unsubscribe error', e)
      }
    }
  } finally {
    channel = null
    privateChannel = null
    roomTopic = null
    myUserId = null
    listeners.length = 0
    console.log('[signaling] closed all channels')
  }
}

export default { initSignaling, sendSignal, onSignal, closeSignaling }
