/**
 * Message Encryption (XChaCha20-Poly1305)
 * Encrypts a plaintext message with authenticated encryption.
 * 
 * Output format (JSON):
 * {
 *   salt: string (base64),
 *   nonce: string (base64),
 *   ciphertext: string (base64)
 * }
 */

import sodium from 'libsodium-wrappers-sumo';
import { deriveKey } from './kdf';

export interface EncryptedMessage {
  salt: string;
  nonce: string;
  ciphertext: string;
}

/**
 * Generate random bytes (works in Node.js and browser)
 */
function getRandomBytes(length: number): Uint8Array {
  const buffer = new Uint8Array(length);
  if (typeof window !== 'undefined' && window.crypto) {
    // Browser environment
    window.crypto.getRandomValues(buffer);
  } else if (typeof global !== 'undefined' && global.crypto) {
    // Node.js 15+ with crypto support
    global.crypto.getRandomValues(buffer);
  } else {
    // Fallback: Node.js with require
    try {
      const nodeCrypto = require('crypto');
      return nodeCrypto.randomBytes(length);
    } catch {
      throw new Error('No crypto API available for random byte generation');
    }
  }
  return buffer;
}

/**
 * Encrypts a plaintext message.
 * Derives key on each call (salt included in output for receiver to use).
 * 
 * @param plaintext - Message to encrypt (string or bytes)
 * @param secret - User-provided secret (string or bytes)
 * @returns { salt, nonce, ciphertext } all base64-encoded
 */
export async function encryptMessage(
  plaintext: string | Uint8Array,
  secret: string | Uint8Array
): Promise<EncryptedMessage> {
  await sodium.ready;

  // Convert plaintext to bytes
  const plaintextBytes =
    typeof plaintext === 'string' ? sodium.from_string(plaintext) : plaintext;

  // Derive key (generates fresh salt)
  const { key, salt } = await deriveKey(secret);

  // Generate random nonce (24 bytes for XChaCha20)
  const nonce = getRandomBytes(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);

  // Encrypt with AEAD
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintextBytes,
    null, // no additional authenticated data
    null, // secret key (not used; we use key below)
    nonce,
    key
  );

  // Return all components base64-encoded
  return {
    salt: sodium.to_base64(salt),
    nonce: sodium.to_base64(nonce),
    ciphertext: sodium.to_base64(ciphertext),
  };
}
