import { failure } from './auth';

export async function encryptJson(secret: string, value: Record<string, unknown>): Promise<string> {
  if (!secret) throw failure('encryption_unavailable', 'Secret encryption is not configured', 503);
  const key = await aesKey(secret, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return `v1.${base64Url(iv)}.${base64Url(ciphertext)}`;
}

export async function decryptJson<T>(secret: string, value: string): Promise<T> {
  const [version, ivValue, ciphertextValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !ciphertextValue) throw failure('encrypted_secret_invalid', 'Encrypted secret is invalid', 500);
  const key = await aesKey(secret, ['decrypt']);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlDecode(ivValue) }, key, base64UrlDecode(ciphertextValue),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch { throw failure('encrypted_secret_invalid', 'Encrypted secret cannot be decrypted', 500); }
}

export async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function aesKey(secret: string, usages: Array<'encrypt' | 'decrypt'>) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, usages);
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
