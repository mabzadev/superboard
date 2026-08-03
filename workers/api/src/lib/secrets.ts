import type { BillingEnv } from '../types';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(material: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export function credentialKeyMaterial(env: BillingEnv): string {
  const keyring = credentialKeyring(env);
  const version = env.STORE_CREDENTIALS_ACTIVE_KEY_VERSION || Object.keys(keyring).sort().at(-1);
  if (version && keyring[version]) return keyring[version];
  const legacy = env.STORE_CREDENTIALS_ENCRYPTION_KEY;
  if (!legacy) throw new Error('Store credential encryption key is not configured');
  return legacy;
}

function credentialKeyring(env: BillingEnv): Record<string, string> {
  if (!env.STORE_CREDENTIALS_ENCRYPTION_KEYS) return {};
  try {
    const parsed = JSON.parse(env.STORE_CREDENTIALS_ENCRYPTION_KEYS);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0));
  } catch {
    throw new Error('STORE_CREDENTIALS_ENCRYPTION_KEYS is invalid JSON');
  }
}

export async function encryptCredential(env: BillingEnv, secret: string): Promise<string> {
  const keyring = credentialKeyring(env);
  const version = env.STORE_CREDENTIALS_ACTIVE_KEY_VERSION || Object.keys(keyring).sort().at(-1) || 'v1';
  const key = keyring[version] || credentialKeyMaterial(env);
  const encrypted = await encryptSecret(secret, key);
  return `${version}.${encrypted.slice(3)}`;
}

export async function decryptCredential(env: BillingEnv, ciphertext: string): Promise<string> {
  const separator = ciphertext.indexOf('.');
  const version = separator > 0 ? ciphertext.slice(0, separator) : '';
  const keyring = credentialKeyring(env);
  if (version && keyring[version]) {
    return decryptSecret(`v1.${ciphertext.slice(separator + 1)}`, keyring[version]);
  }
  return decryptSecret(ciphertext, credentialKeyMaterial(env));
}

export function scopedStoreCredential(row: {
  configuration_encrypted?: string | null;
  billing_configuration_encrypted?: string | null;
}, env: BillingEnv): string | null {
  return env.CREDENTIAL_KEY_SCOPE === 'billing'
    ? row.billing_configuration_encrypted || null
    : row.configuration_encrypted || null;
}

export async function encryptSecret(secret: string, keyMaterial: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(keyMaterial);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(secret),
  ));
  const combined = new Uint8Array(iv.length + encrypted.length);
  combined.set(iv, 0);
  combined.set(encrypted, iv.length);
  return `v1.${bytesToBase64(combined)}`;
}

export async function decryptSecret(ciphertext: string, keyMaterial: string): Promise<string> {
  const encoded = ciphertext.startsWith('v1.') ? ciphertext.slice(3) : ciphertext;
  const combined = base64ToBytes(encoded);
  if (combined.byteLength <= 12) throw new Error('Encrypted credential is invalid');
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);
  const key = await encryptionKey(keyMaterial);
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
  return new TextDecoder().decode(clear);
}

export async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  return crypto.subtle.timingSafeEqual(leftDigest, rightDigest);
}

export async function hmacSha256(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  return bytesToBase64(signature);
}
