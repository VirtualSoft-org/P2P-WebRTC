export {};
import * as Crypto from '../../src/crypto/index';

const sigInput = document.getElementById('sig') as HTMLInputElement;
const connectBtn = document.getElementById('connect') as HTMLButtonElement;
const peerList = document.getElementById('peerList') as HTMLUListElement;
const log = document.getElementById('log') as HTMLTextAreaElement;
const msgInput = document.getElementById('msg') as HTMLInputElement;
const sendBtn = document.getElementById('send') as HTMLButtonElement;
const videoElement = document.getElementById('video') as HTMLVideoElement;
const videoUrlInput = document.getElementById('videoUrl') as HTMLInputElement;
const loadVideoBtn = document.getElementById('loadVideo') as HTMLButtonElement;
const encryptSecretInput = document.getElementById('encryptSecret') as HTMLInputElement;
const setEncryptionSecretBtn = document.getElementById('setEncryptionSecret') as HTMLButtonElement;
const encryptionToggle = document.getElementById('encryptionToggle') as HTMLInputElement;
const encryptionStatus = document.getElementById('encryptionStatus') as HTMLSpanElement;

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

// Encryption controls
setEncryptionSecretBtn.onclick = () => {
  const secret = encryptSecretInput.value.trim();
  if (!secret) {
    alert('Please enter a secret');
    return;
  }
  Crypto.setEncryptionSecret(secret);
  appendLog('[Encryption] Secret set');
  encryptSecretInput.value = '';
};

encryptionToggle.onchange = () => {
  const enabled = encryptionToggle.checked;
  if (enabled && !Crypto.getEncryptionSecret()) {
    alert('Please set a secret first');
    encryptionToggle.checked = false;
    return;
  }
  Crypto.setEncryptionEnabled(enabled);
  encryptionStatus.textContent = enabled ? 'ON' : 'OFF';
  encryptionStatus.style.background = enabled ? '#e8f5e9' : '#ffe0e0';
  encryptionStatus.style.color = enabled ? '#2e7d32' : '#d32f2f';
  appendLog(`[Encryption] ${enabled ? 'Enabled' : 'Disabled'}`);
};

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

async function handleChannelMessage(peerId: string, rawData: string): Promise<void> {
  // Decrypt if encryption is enabled
  const data = await Crypto.decryptIfEnabled(rawData);
  if (data === null) {
    // Decryption failed, message dropped silently
    return;
  }

  // Try to parse as sync message
  try {
    const msg = JSON.parse(data);
    if (msg.type && !['play', 'pause', 'seek', 'sync', 'videoUrl', 'initialState'].includes(msg.type)) {
      appendLog(`From ${peerId}: ${data}`);
    }
  } catch (e) {
    appendLog(`From ${peerId}: ${data}`);
  }
}

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
      handleChannelMessage(id, m.data as string);
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
      Crypto.encryptIfEnabled(jsonMessage).then((encrypted) => {
        p.channel!.send(encrypted);
      });
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
  
  Crypto.encryptIfEnabled(JSON.stringify(initialState)).then((encrypted) => {
    channel.send(encrypted);
  });
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
  const displayText = Crypto.isEncryptionEnabled() ? '[encrypted]' : text;
  appendLog('[host] ' + displayText);
  for (const [, p] of peers.entries()) {
    if (p.channel && p.channel.readyState === 'open') {
      Crypto.encryptIfEnabled(`[host] ${text}`).then((encrypted) => {
        p.channel!.send(encrypted);
      });
    }
  }
  msgInput.value = '';
};
