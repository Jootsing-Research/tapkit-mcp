const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function randomToken(prefix: string, byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return `${prefix}${base64UrlEncode(bytes)}`;
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function createPkceChallenge(verifier: string): Promise<string> {
  return hashToken(verifier);
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

function parseEncryptionKey(value: string): Uint8Array {
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Uint8Array.from(value.match(/.{2}/g)!.map(byte => Number.parseInt(byte, 16)));
  }
  const bytes = base64ToBytes(value);
  if (bytes.length !== 32) {
    throw new Error('OAUTH_ENCRYPTION_KEY must encode exactly 32 bytes');
  }
  return bytes;
}

async function importEncryptionKey(value: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(parseEncryptionKey(value)),
    { name: 'AES-GCM' },
    false,
    [usage]
  );
}

export async function encryptSecret(plaintext: string, keyValue: string): Promise<string> {
  const key = await importEncryptionKey(keyValue, 'encrypt');
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(encoder.encode(plaintext))
  );
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(ciphertext: string, keyValue: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext] = ciphertext.split('.');
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) {
    throw new Error('Unsupported encrypted secret format');
  }
  const iv = base64ToBytes(encodedIv);
  const encryptedBytes = base64ToBytes(encodedCiphertext);
  if (iv.byteLength !== 12 || encryptedBytes.byteLength < 16) {
    throw new Error('Invalid encrypted secret envelope');
  }
  const key = await importEncryptionKey(keyValue, 'decrypt');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(encryptedBytes)
  );
  return decoder.decode(plaintext);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
