export {};
const sigInput = document.getElementById('sig') as HTMLInputElement;
const connectBtn = document.getElementById('connect') as HTMLButtonElement;
const peerList = document.getElementById('peerList') as HTMLUListElement;
const log = document.getElementById('log') as HTMLTextAreaElement;
const msgInput = document.getElementById('msg') as HTMLInputElement;
const sendBtn = document.getElementById('send') as HTMLButtonElement;
const videoElement = document.getElementById('video') as HTMLVideoElement;
const videoUrlInput = document.getElementById('videoUrl') as HTMLInputElement;
const loadVideoBtn = document.getElementById('loadVideo') as HTMLButtonElement;

const pcConfig: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let ws: WebSocket | null = null;
const peers = new Map<string, { pc: RTCPeerConnection; channel: RTCDataChannel | null }>();
let isHostControlling = true;
let syncInterval: number | null = null;

interface SyncMessage {
  type: 'play' | 'pause' | 'seek' | 'sync' | 'videoUrl' | 'initialState';
  timestamp?: number;
  videoUrl?: string;
  paused?: boolean;
}

function appendLog(s: string): void {
  log.value += s + '\n';
  log.scrollTop = log.scrollHeight;
}

connectBtn.onclick = () => {
  if (ws) ws.close();
  ws = new WebSocket(sigInput.value);
  ws.onopen = () => {
    ws!.send(JSON.stringify({ type: 'register', id: 'host' }));
    appendLog('Connected to signaling server');
  };

  ws.onmessage = async (ev: MessageEvent) => {
    const msg = JSON.parse(ev.data as string) as any;
    const { type, from, data } = msg;
    if (type === 'registered') return;

    if (type === 'offer') {
      appendLog('Received offer from ' + from);
      await handleOffer(from, data);
    }
    if (type === 'ice' && peers.has(from)) {
      const candidate = data as RTCIceCandidateInit;
      try { await peers.get(from)!.pc.addIceCandidate(candidate); } catch (e) { console.warn(e); }
    }
  };
};

async function handleOffer(id: string, offer: any): Promise<void> {
  const pc = new RTCPeerConnection(pcConfig);
  peers.set(id, { pc, channel: null });

  pc.onicecandidate = (e) => {
    if (e.candidate && ws) ws.send(JSON.stringify({ type: 'ice', from: 'host', to: id, data: e.candidate }));
  };

  pc.ondatachannel = (ev: RTCDataChannelEvent) => {
    const channel = ev.channel;
    channel.onopen = () => { 
      appendLog('DataChannel open: ' + id); 
      updatePeerList();
      sendInitialState(id, channel);
    };
    channel.onmessage = (m: MessageEvent) => {
      try {
        const msg = JSON.parse(m.data);
        if (msg.type && !['play', 'pause', 'seek', 'sync'].includes(msg.type)) {
          appendLog(`From ${id}: ${m.data}`);
        }
      } catch (e) {
        appendLog(`From ${id}: ${m.data}`);
      }
    };
    const entry = peers.get(id) || { pc, channel: null };
    entry.channel = channel;
    peers.set(id, entry);
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    if (state === 'disconnected' || state === 'failed' || state === 'closed') {
      if (peers.has(id)) {
        const p = peers.get(id)!;
        try { p.pc.close(); } catch (e) { /* ignore */ }
        peers.delete(id);
        appendLog('Peer removed: ' + id + ' (' + state + ')');
        updatePeerList();
      }
    }
  };

  await pc.setRemoteDescription(offer as RTCSessionDescriptionInit);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  if (ws) ws.send(JSON.stringify({ type: 'answer', from: 'host', to: id, data: pc.localDescription }));

  updatePeerList();
}

function updatePeerList(): void {
  peerList.innerHTML = '';
  for (const [id, p] of peers.entries()) {
    const li = document.createElement('li');
    const status = p.channel ? p.channel.readyState : 'pending';
    li.textContent = id + ' — ' + status;
    peerList.appendChild(li);
  }
}

function broadcastSyncCommand(message: SyncMessage): void {
  const jsonMessage = JSON.stringify(message);
  for (const [, p] of peers.entries()) {
    if (p.channel && p.channel.readyState === 'open') {
      p.channel.send(jsonMessage);
    }
  }
}

function sendInitialState(clientId: string, channel: RTCDataChannel): void {
  if (!videoElement) return;
  
  const initialState: SyncMessage = {
    type: 'initialState',
    timestamp: videoElement.currentTime,
    paused: videoElement.paused,
    videoUrl: videoElement.src || undefined
  };
  
  channel.send(JSON.stringify(initialState));
  appendLog(`Sent initial state to ${clientId}`);
}

function setupVideoControls(): void {
  if (!videoElement) return;

  videoElement.onplay = () => {
    if (isHostControlling) {
      broadcastSyncCommand({ type: 'play' });
      appendLog('Broadcast: play');
    }
  };

  videoElement.onpause = () => {
    if (isHostControlling) {
      broadcastSyncCommand({ type: 'pause' });
      appendLog('Broadcast: pause');
    }
  };

  videoElement.onseeked = () => {
    if (isHostControlling) {
      broadcastSyncCommand({ type: 'seek', timestamp: videoElement.currentTime });
      appendLog(`Broadcast: seek to ${videoElement.currentTime.toFixed(2)}s`);
    }
  };

  if (syncInterval !== null) {
    clearInterval(syncInterval);
  }
  
  syncInterval = window.setInterval(() => {
    if (isHostControlling && videoElement && !videoElement.paused && peers.size > 0) {
      broadcastSyncCommand({ type: 'sync', timestamp: videoElement.currentTime });
    }
  }, 5000);
}

loadVideoBtn.onclick = () => {
  const url = videoUrlInput.value.trim();
  if (!url || !videoElement) return;
  
  videoElement.src = url;
  broadcastSyncCommand({ type: 'videoUrl', videoUrl: url });
  appendLog(`Loaded and broadcast video URL: ${url}`);
};

if (videoElement) {
  setupVideoControls();
}

sendBtn.onclick = () => {
  const text = msgInput.value.trim();
  if (!text) return;
  appendLog('[host] ' + text);
  for (const [, p] of peers.entries()) {
    if (p.channel && p.channel.readyState === 'open') p.channel.send(`[host] ${text}`);
  }
  msgInput.value = '';
};
