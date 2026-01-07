import dotenv from 'dotenv'
import WebSocket, { Server as WebSocketServer } from 'ws'

dotenv.config()

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000
const wss = new WebSocketServer({ port: PORT }, () =>
  console.log(`Signaling server running on ws://localhost:${PORT}`)
)

const peers: Map<string, WebSocket> = new Map()
const wsToId: WeakMap<WebSocket, string> = new WeakMap()

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (message: WebSocket.RawData) => {
    let msg: any
    try {
      msg = JSON.parse(message.toString())
    } catch (e) {
      console.error('Received invalid JSON')
      return
    }

    if (!msg || typeof msg !== 'object') return

    const { type, id, from, to, data } = msg

    if (type === 'register' && id) {
      if (peers.has(id)) {
        const prev = peers.get(id)!
        try { prev.close() } catch (e) { /* ignore */ }
        console.log('Replaced previous registration for', id)
      }
      peers.set(id, ws)
      wsToId.set(ws, id)
      try { ws.send(JSON.stringify({ type: 'registered', id })) } catch (e) { /*ignore*/ }
      console.log('Registered', id)
      return
    }

    if (to && peers.has(to)) {
      const target = peers.get(to)!
      try { target.send(JSON.stringify({ type, from, data })) } catch (e) { console.warn('Send failed', e) }
      return
    }

    // fallback: broadcast to all
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && client !== ws) {
        try { client.send(JSON.stringify({ type, from, data })) } catch (e) { /*ignore*/ }
      }
    })
  })

  ws.on('close', () => {
    const id = wsToId.get(ws)
    if (id) {
      peers.delete(id)
      console.log('Disconnected', id)
    }
  })
})

process.on('SIGINT', () => {
  console.log('Shutting down signaling server...')
  try { wss.close() } catch {}
  process.exit(0)
})
