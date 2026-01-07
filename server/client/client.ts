export {};
const sigInput = document.getElementById('sig') as HTMLInputElement;
const connectBtn = document.getElementById('connect') as HTMLButtonElement;
const log = document.getElementById('log') as HTMLTextAreaElement;
const msgInput = document.getElementById('msg') as HTMLInputElement;
const sendBtn = document.getElementById('send') as HTMLButtonElement;
const videoElement = document.getElementById('video') as HTMLVideoElement;
const pcConfig: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let ws: WebSocket | null = null;
let pc: RTCPeerConnection | null = null;
let channel: RTCDataChannel | null = null;
const id: string = 'client-' + Math.random().toString(36).slice(2, 8);
let isReceivingCommand = false;

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

connectBtn.onclick = async () => {
  if (ws) ws.close();
  ws = new WebSocket(sigInput.value);
  ws.onopen = () => {
    ws!.send(JSON.stringify({ type: 'register', id }));
    appendLog('Connected to signaling server as ' + id);
    void createOffer();
  };

  ws.onmessage = async (ev: MessageEvent) => {
    const msg = JSON.parse(ev.data as string) as any;
    const { type, from, data } = msg;
    if (type === 'registered') return;
    if (type === 'answer') {
      appendLog('Received answer from ' + from);
      if (pc) await pc.setRemoteDescription(data as RTCSessionDescriptionInit);
    }
    if (type === 'ice') {
      try { if (pc) await pc.addIceCandidate(data as RTCIceCandidateInit); } catch (e) { console.warn(e); }
    }
  };
};

async function createOffer(): Promise<void> {
  pc = new RTCPeerConnection(pcConfig);
  pc.onicecandidate = (e) => {
    if (e.candidate && ws) ws.send(JSON.stringify({ type: 'ice', from: id, to: 'host', data: e.candidate }));
  };

  channel = pc.createDataChannel('p2p');
  channel.onopen = () => {
    appendLog('DataChannel open');
    setupVideoSync();
  };
  channel.onmessage = (m: MessageEvent) => {
    handleSyncMessage(m.data);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  if (ws) ws.send(JSON.stringify({ type: 'offer', from: id, to: 'host', data: pc.localDescription }));
  appendLog('Sent offer to host');
}
function handleSyncMessage(data: string): void {
  try {
    const message: SyncMessage = JSON.parse(data);
    
    if (!videoElement) return;
    
    if (!message.type || !['play', 'pause', 'seek', 'sync', 'videoUrl', 'initialState'].includes(message.type)) {
      appendLog('Received: ' + data);
      return;
    }
    
    isReceivingCommand = true;
    
    switch (message.type) {
      case 'play':
        videoElement.play().catch(e => console.warn('Play failed:', e));
        appendLog('Sync: play');
        break;
        
      case 'pause':
        videoElement.pause();
        appendLog('Sync: pause');
        break;
        
      case 'seek':
        if (message.timestamp !== undefined) {
          videoElement.currentTime = message.timestamp;
          appendLog(`Sync: seek to ${message.timestamp.toFixed(2)}s`);
        }
        break;
        
      case 'sync':
        if (message.timestamp !== undefined) {
          const diff = Math.abs(videoElement.currentTime - message.timestamp);
          if (diff > 1.0) {
            videoElement.currentTime = message.timestamp;
            appendLog(`Sync: corrected timestamp to ${message.timestamp.toFixed(2)}s (diff: ${diff.toFixed(2)}s)`);
          }
        }
        break;
        
      case 'videoUrl':
        if (message.videoUrl) {
          videoElement.src = message.videoUrl;
          appendLog(`Sync: video URL changed to ${message.videoUrl}`);
        }
        break;
        
      case 'initialState':
        if (message.videoUrl) {
          videoElement.src = message.videoUrl;
        }
        if (message.timestamp !== undefined) {
          videoElement.currentTime = message.timestamp;
        }
        if (message.paused !== undefined) {
          if (message.paused) {
            videoElement.pause();
          } else {
            videoElement.play().catch(e => console.warn('Play failed:', e));
          }
        }
        appendLog(`Sync: received initial state (time: ${message.timestamp?.toFixed(2)}s, paused: ${message.paused})`);
        break;
    }
    
    setTimeout(() => { isReceivingCommand = false; }, 100);
    
  } catch (e) {
    appendLog('Received: ' + data);
  }
}

function setupVideoSync(): void {
  if (!videoElement) return;
}

sendBtn.onclick = () => {
  const text = msgInput.value.trim();
  if (!text || !channel || channel.readyState !== 'open') return;
  channel.send(text);
  appendLog('[me] ' + text);
  msgInput.value = '';
};
