/**
 * Key Derivation Function (Argon2id)
 * Derives a 32-byte encryption key from a user-provided secret and random salt.
 * 
 * Parameters:
 * - memory: 64 MB (65536 KiB)
 * - iterations: 3
 * - parallelism: 4
 * - output: 32 bytes (256-bit key for XChaCha20-Poly1305)
 */

import * as sodium from 'libsodium-wrappers';

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
 * Derives a 32-byte key from a secret and salt using Argon2id.
 * @param secret - User-provided secret (string or bytes)
 * @param salt - 16-byte random salt (or undefined to generate)
 * @returns { key: Uint8Array, salt: Uint8Array }
 */
export async function deriveKey(
  secret: string | Uint8Array,
  salt?: Uint8Array
): Promise<{ key: Uint8Array; salt: Uint8Array }> {
  await sodium.ready;

  // Generate random salt if not provided
  const finalSalt: Uint8Array = salt || getRandomBytes(sodium.crypto_pwhash_SALTBYTES);

  // Convert secret to bytes if it's a string
  const secretBytes =
    typeof secret === 'string' ? sodium.from_string(secret) : secret;

  // Argon2id parameters
  const MEMORY_LIMIT = 65536; // 64 MB in KiB
  const OPSLIMIT = 3; // iterations
  const PARALLELISM = 4;
  const KEY_LENGTH = 32; // 256-bit key

  // Derive key
  const key = sodium.crypto_pwhash(
    KEY_LENGTH,
    secretBytes,
    finalSalt,
    OPSLIMIT,
    MEMORY_LIMIT,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );

  return { key, salt: finalSalt };
}
