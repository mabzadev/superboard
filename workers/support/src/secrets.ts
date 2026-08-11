export async function encryptSecret(encryptionKey: string, secret: string): Promise<string> {
  if (!encryptionKey) throw failure('webhook_encryption_unavailable', 'Webhook secret encryption is not configured', 503);
  const key = await aesKey(encryptionKey, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ secret }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return `v1.${base64Url(iv)}.${base64Url(ciphertext)}`;
}

export async function decryptSecret(encryptionKey: string, encrypted: string): Promise<string> {
  if (!encryptionKey) throw failure('webhook_encryption_unavailable', 'Webhook secret encryption is not configured', 503);
  const [version, ivValue, ciphertextValue] = encrypted.split('.');
  if (version !== 'v1' || !ivValue || !ciphertextValue) {
    throw failure('webhook_secret_invalid', 'Stored webhook secret is invalid', 500);
  }
  try {
    const key = await aesKey(encryptionKey, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlDecode(ivValue) },
      key,
      base64UrlDecode(ciphertextValue),
    );
    const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as { secret?: unknown };
    if (typeof decoded.secret !== 'string' || !decoded.secret) throw new Error('secret missing');
    return decoded.secret;
  } catch (error) {
    if ((error as { code?: string }).code) throw error;
    throw failure('webhook_secret_invalid', 'Stored webhook secret cannot be decrypted', 500);
  }
}

async function aesKey(encryptionKey: string, usages: Array<'encrypt' | 'decrypt'>) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptionKey));
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

function failure(code: string, message: string, status: number) {
  return Object.assign(new Error(message), { code, status });
}
