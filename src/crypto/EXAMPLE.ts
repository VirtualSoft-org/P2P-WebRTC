/**
 * Usage Example: Message Encryption Module
 * 
 * Demonstrates how to integrate encryption into your P2P messaging.
 */

import * as Crypto from './index';

// ============================================================================
// STEP 1: User sets shared secret (UI)
// ============================================================================

// In client.html or host.html:
// <input id="encryptSecret" type="password" placeholder="Enter shared secret..." />
// <button id="setEncryptionSecret">Set Secret</button>

const setSecretButton = document.getElementById('setEncryptionSecret');
const secretInput = document.getElementById('encryptSecret') as HTMLInputElement;

setSecretButton?.addEventListener('click', () => {
  const secret = secretInput.value.trim();
  if (!secret) {
    alert('Please enter a secret');
    return;
  }
  Crypto.setEncryptionSecret(secret);
  console.log('[Encryption] Secret set');
  secretInput.value = ''; // Clear for security
});

// ============================================================================
// STEP 2: User enables encryption toggle (UI)
// ============================================================================

// In client.html or host.html:
// <input id="encryptionToggle" type="checkbox" />
// <label for="encryptionToggle">Enable message encryption</label>

const encryptionToggle = document.getElementById('encryptionToggle') as HTMLInputElement;

encryptionToggle?.addEventListener('change', () => {
  const enabled = encryptionToggle.checked;
  
  // Validate: secret must be set first
  if (enabled && !Crypto.getEncryptionSecret()) {
    alert('Please set a secret first');
    encryptionToggle.checked = false;
    return;
  }
  
  Crypto.setEncryptionEnabled(enabled);
  console.log(`[Encryption] ${enabled ? 'Enabled' : 'Disabled'}`);
  
  // Update UI
  const status = document.getElementById('encryptionStatus');
  if (status) {
    status.textContent = enabled ? 'ON' : 'OFF';
    status.style.background = enabled ? '#e8f5e9' : '#ffe0e0';
    status.style.color = enabled ? '#2e7d32' : '#d32f2f';
  }
});

// ============================================================================
// STEP 3: Send encrypted message through DataChannel
// ============================================================================

let channel: RTCDataChannel | null = null;

async function sendMessage(text: string): Promise<void> {
  if (!channel || channel.readyState !== 'open') return;
  
  // Encrypt (if enabled) or pass through (if disabled)
  const payload = await Crypto.encryptIfEnabled(text);
  
  // Send
  channel.send(payload);
  
  // Log (show if encrypted)
  const display = Crypto.isEncryptionEnabled() ? '[encrypted]' : text;
  console.log(`[me] ${display}`);
}

// Example: wire up send button
const sendBtn = document.getElementById('send');
const msgInput = document.getElementById('msg') as HTMLInputElement;

sendBtn?.addEventListener('click', async () => {
  const text = msgInput.value.trim();
  if (!text) return;
  
  await sendMessage(text);
  msgInput.value = '';
});

// ============================================================================
// STEP 4: Receive and decrypt message from DataChannel
// ============================================================================

function setupChannelHandlers(channel: RTCDataChannel): void {
  channel.onmessage = async (event: MessageEvent) => {
    // Decrypt (if enabled) or pass through (if disabled)
    const plaintext = await Crypto.decryptIfEnabled(event.data as string);
    
    // If decryption failed (e.g., auth failure), message is silently dropped
    if (plaintext === null) {
      console.warn('[Crypto] Message authentication failed, dropped');
      return;
    }
    
    // Process decrypted message
    handleIncomingMessage(plaintext);
  };
}

function handleIncomingMessage(plaintext: string): void {
  console.log(`[peer] ${plaintext}`);
  
  // Parse as JSON (for sync commands) or plain text
  try {
    const msg = JSON.parse(plaintext);
    if (msg.type && ['play', 'pause', 'seek', 'sync'].includes(msg.type)) {
      handleSyncCommand(msg);
      return;
    }
  } catch {
    // Not JSON, treat as plain text message
  }
  
  // Display message in UI
  const log = document.getElementById('log') as HTMLTextAreaElement;
  if (log) {
    log.value += plaintext + '\n';
    log.scrollTop = log.scrollHeight;
  }
}

function handleSyncCommand(msg: any): void {
  console.log('[Sync]', msg.type);
  // Handle sync commands (play, pause, seek, etc.)
}

// ============================================================================
// STEP 5: Broadcasting encrypted messages (host side)
// ============================================================================

interface SyncMessage {
  type: string;
  timestamp?: number;
  [key: string]: any;
}

const peers = new Map<string, { channel: RTCDataChannel }>();

async function broadcastMessage(msg: SyncMessage): Promise<void> {
  const payload = JSON.stringify(msg);
  
  for (const [peerId, peer] of peers.entries()) {
    if (peer.channel.readyState !== 'open') continue;
    
    // Encrypt before sending
    const encrypted = await Crypto.encryptIfEnabled(payload);
    peer.channel.send(encrypted);
    
    console.log(`[broadcast] to ${peerId}: ${msg.type}`);
  }
}

// Example: broadcast a play command
async function broadcastPlay(): Promise<void> {
  await broadcastMessage({ type: 'play' });
}

// ============================================================================
// STEP 6: Cleanup on disconnect
// ============================================================================

function onDisconnect(): void {
  // Clear encryption state
  Crypto.clearEncryptionState();
  
  // Reset UI
  const toggle = document.getElementById('encryptionToggle') as HTMLInputElement;
  if (toggle) toggle.checked = false;
  
  const status = document.getElementById('encryptionStatus');
  if (status) {
    status.textContent = 'OFF';
    status.style.background = '#ffe0e0';
    status.style.color = '#d32f2f';
  }
  
  console.log('[Encryption] State cleared on disconnect');
}

// ============================================================================
// COMPLETE EXAMPLE: Integration in existing code
// ============================================================================

/*
BEFORE:
  channel.onmessage = (m: MessageEvent) => {
    const msg = JSON.parse(m.data);
    console.log('Received:', msg);
  };

  sendBtn.onclick = () => {
    const text = msgInput.value.trim();
    channel.send(text);
  };

AFTER:
  channel.onmessage = async (m: MessageEvent) => {
    const plaintext = await Crypto.decryptIfEnabled(m.data);
    if (plaintext === null) return; // Auth failed
    const msg = JSON.parse(plaintext);
    console.log('Received:', msg);
  };

  sendBtn.onclick = async () => {
    const text = msgInput.value.trim();
    const encrypted = await Crypto.encryptIfEnabled(text);
    channel.send(encrypted);
  };

THAT'S IT. Minimal changes, maximum security.
*/
