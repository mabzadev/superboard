export async function encryptSecret(encryptionKey: string, secret: string): Promise<string> {
  if (!encryptionKey) throw failure('webhook_encryption_unavailable', 'Webhook secret encryption is not configured', 503);
  const key = await aesKey(encryptionKey, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ secret }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: arrayBuffer(iv) }, key, arrayBuffer(plaintext),
  ));
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
      { name: 'AES-GCM', iv: arrayBuffer(base64UrlDecode(ivValue)) },
      key,
      arrayBuffer(base64UrlDecode(ciphertextValue)),
    );
    const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as { secret?: unknown };
    if (typeof decoded.secret !== 'string' || !decoded.secret) throw new Error('secret missing');
    return decoded.secret;
  } catch (error) {
    if ((error as { code?: string }).code) throw error;
    throw failure('webhook_secret_invalid', 'Stored webhook secret cannot be decrypted', 500);
  }
}

export async function encryptCredentialPayload(
  encryptionKey: string,
  payload: Record<string, unknown>,
): Promise<string> {
  if (!encryptionKey) {
    throw failure('credential_encryption_unavailable', 'Credential encryption is not configured', 503);
  }
  const serialized = JSON.stringify(payload);
  if (serialized.length > 64_000) {
    throw failure('credential_payload_too_large', 'Credential payload is limited to 64 KB', 422);
  }
  const key = await aesKey(encryptionKey, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ payload: JSON.parse(serialized) }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: arrayBuffer(iv) }, key, arrayBuffer(plaintext),
  ));
  return `v2.${base64Url(iv)}.${base64Url(ciphertext)}`;
}

export async function decryptCredentialPayload(
  encryptionKeys: Array<string | undefined>,
  encrypted: string,
): Promise<{ payload: Record<string, unknown>; usedKeyIndex: number }> {
  const candidates = encryptionKeys.filter((candidate): candidate is string => Boolean(candidate));
  if (candidates.length === 0) {
    throw failure('credential_encryption_unavailable', 'Credential encryption is not configured', 503);
  }
  const [version, ivValue, ciphertextValue] = encrypted.split('.');
  if (version !== 'v2' || !ivValue || !ciphertextValue) {
    throw failure('credential_payload_invalid', 'Stored credential payload is invalid', 500);
  }
  for (let index = 0; index < candidates.length; index += 1) {
    try {
      const key = await aesKey(candidates[index], ['decrypt']);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: arrayBuffer(base64UrlDecode(ivValue)) },
        key,
        arrayBuffer(base64UrlDecode(ciphertextValue)),
      );
      const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as { payload?: unknown };
      if (!decoded.payload || typeof decoded.payload !== 'object' || Array.isArray(decoded.payload)) {
        throw new Error('payload missing');
      }
      return { payload: decoded.payload as Record<string, unknown>, usedKeyIndex: index };
    } catch {
      // Key rotation is deliberately silent; no secret/key diagnostics escape.
    }
  }
  throw failure('credential_payload_invalid', 'Stored credential payload cannot be decrypted', 500);
}

async function aesKey(encryptionKey: string, usages: Array<'encrypt' | 'decrypt'>) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer(new TextEncoder().encode(encryptionKey)));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, usages);
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
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
