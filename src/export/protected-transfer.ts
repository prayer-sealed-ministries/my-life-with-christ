/** Companion .lwc v1, using its existing interoperable Web Crypto envelope. */
export const PROTECTED_TRANSFER_FORMAT = 'lwc-companion-protected';
export const MAX_PROTECTED_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_PROTECTED_PLAINTEXT_BYTES = 11 * 1024 * 1024;
const AAD = new TextEncoder().encode('lwc-companion-protected:1:PBKDF2-SHA256:600000:AES-256-GCM');

export class ProtectedTransferPasswordRequired extends Error {
  constructor() {
    super('This protected transfer needs its password. Nothing has been imported.');
    this.name = 'ProtectedTransferPasswordRequired';
  }
}

export function isProtectedTransfer(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) &&
    (raw as Record<string, unknown>).format === PROTECTED_TRANSFER_FORMAT;
}

function decodeBase64(raw: unknown, maxBytes: number): Uint8Array<ArrayBuffer> {
  // Bound allocations before atob. Canonical padding also rejects ambiguous
  // encodings; no file-supplied iteration count can reach the KDF below.
  if (typeof raw !== 'string' || raw.length > 4 * Math.ceil(maxBytes / 3) ||
      raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) {
    throw new Error('This protected file is malformed or too large. Nothing was imported.');
  }
  let decoded: string;
  try { decoded = atob(raw); } catch {
    throw new Error('This protected file is malformed. Nothing was imported.');
  }
  if (decoded.length > maxBytes || btoa(decoded) !== raw) {
    throw new Error('This protected file is malformed or too large. Nothing was imported.');
  }
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

/** Authenticate first; return plaintext only after authentication succeeds. */
export async function unlockProtectedTransfer(raw: Record<string, unknown>, password?: string): Promise<string> {
  if (raw.format !== PROTECTED_TRANSFER_FORMAT || raw.version !== 1 ||
      raw.kdf !== 'PBKDF2-SHA256' || raw.iterations !== 600000 || raw.cipher !== 'AES-256-GCM') {
    throw new Error('This protected file version or encryption method is not supported. Keep the original file.');
  }
  const salt = decodeBase64(raw.salt, 16);
  const iv = decodeBase64(raw.iv, 12);
  const data = decodeBase64(raw.data, MAX_PROTECTED_PLAINTEXT_BYTES + 16);
  if (salt.length !== 16 || iv.length !== 12 || data.length < 16) {
    throw new Error('This protected file is malformed. Nothing was imported.');
  }
  if (password === undefined) throw new ProtectedTransferPasswordRequired();
  if (!globalThis.crypto?.subtle) {
    throw new Error('Protected files cannot be unlocked here. Use an updated app or a secure browser and keep the original file.');
  }
  const passwordBytes = new TextEncoder().encode(password);
  let plain: ArrayBuffer;
  try {
    const material = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 },
      material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, key, data);
  } catch {
    // Do not expose platform errors, passwords, or decrypted journal contents.
    throw new Error('Could not unlock this file. Check the password and that the file is complete. Nothing was imported.');
  } finally {
    passwordBytes.fill(0);
  }
  const bytes = new Uint8Array(plain);
  try {
    if (bytes.length > MAX_PROTECTED_PLAINTEXT_BYTES) throw new Error('too large');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('This protected file does not contain readable journal data. Nothing was imported.');
  } finally {
    bytes.fill(0);
  }
}
