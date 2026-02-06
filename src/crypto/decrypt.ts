/**
 * Message Decryption (XChaCha20-Poly1305)
 * Decrypts an authenticated encrypted message.
 * Silent failure on authentication failure (message dropped).
 */

import * as sodium from 'libsodium-wrappers';
import { deriveKey } from './kdf';
import { EncryptedMessage } from './encrypt';

/**
 * Decrypts a message.
 * Uses the salt from the encrypted message to re-derive the key.
 * 
 * @param encrypted - Encrypted message object { salt, nonce, ciphertext }
 * @param secret - User-provided secret (must match the one used to encrypt)
 * @returns Decrypted plaintext as string, or null if decryption fails
 */
export async function decryptMessage(
  encrypted: EncryptedMessage,
  secret: string | Uint8Array
): Promise<string | null> {
  await sodium.ready;

  try {
    // Decode from base64
    const salt = sodium.from_base64(encrypted.salt);
    const nonce = sodium.from_base64(encrypted.nonce);
    const ciphertext = sodium.from_base64(encrypted.ciphertext);

    // Derive key using the same salt
    const { key } = await deriveKey(secret, salt);

    // Decrypt with AEAD (will throw if authentication fails)
    const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null, // secret key (not used; we use key below)
      ciphertext,
      null, // no additional authenticated data
      nonce,
      key
    );

    // Convert bytes to string
    return sodium.to_string(plaintext);
  } catch (err) {
    // Silent failure: authentication failed or decryption error
    console.warn('[Crypto] Decryption failed (silent drop):', (err as Error).message);
    return null;
  }
}
