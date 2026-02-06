/**
 * Encryption Module (index)
 * Provides toggle and utilities for optional message encryption.
 * 
 * Usage:
 * 1. User enters secret in UI
 * 2. setEncryptionSecret(secret)
 * 3. setEncryptionEnabled(true)
 * 4. All messages automatically encrypted/decrypted
 */

import { encryptMessage, EncryptedMessage } from './encrypt';
import { decryptMessage } from './decrypt';

/**
 * Encryption state
 */
let encryptionEnabled = false;
let encryptionSecret: string | null = null;

/**
 * Enable/disable encryption
 */
export function setEncryptionEnabled(enabled: boolean): void {
  encryptionEnabled = enabled;
  console.log(`[Crypto] Encryption ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Check if encryption is enabled
 */
export function isEncryptionEnabled(): boolean {
  return encryptionEnabled;
}

/**
 * Set the encryption secret
 */
export function setEncryptionSecret(secret: string): void {
  encryptionSecret = secret;
  console.log('[Crypto] Secret set');
}

/**
 * Get the encryption secret (for validation)
 */
export function getEncryptionSecret(): string | null {
  return encryptionSecret;
}

/**
 * Encrypt a message if encryption is enabled
 * Otherwise returns plaintext as-is in a wrapper
 */
export async function encryptIfEnabled(
  plaintext: string | Uint8Array
): Promise<string> {
  if (!encryptionEnabled || !encryptionSecret) {
    return typeof plaintext === 'string' ? plaintext : new TextDecoder().decode(plaintext);
  }

  const encrypted = await encryptMessage(plaintext, encryptionSecret);
  return JSON.stringify({
    __encrypted: true,
    payload: encrypted,
  });
}

/**
 * Decrypt a message if encryption is enabled
 * Otherwise treats it as plaintext
 * 
 * Returns null if decryption fails (message dropped)
 */
export async function decryptIfEnabled(message: string): Promise<string | null> {
  if (!encryptionEnabled || !encryptionSecret) {
    return message;
  }

  // Try to parse as encrypted JSON
  try {
    const parsed = JSON.parse(message);
    if (parsed.__encrypted === true && parsed.payload) {
      // Decrypt
      return await decryptMessage(parsed.payload as EncryptedMessage, encryptionSecret);
    }
  } catch {
    // Not encrypted JSON, treat as plaintext
    return message;
  }

  return message;
}

/**
 * Clear encryption state (on disconnect)
 */
export function clearEncryptionState(): void {
  encryptionSecret = null;
  encryptionEnabled = false;
  console.log('[Crypto] State cleared');
}
