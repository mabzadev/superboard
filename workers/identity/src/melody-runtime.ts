import { BaseKVKey } from './melody/configs/adapter'
import type { Bindings as MelodyBindings } from './melody/configs/type'
import type { IdentityEnv } from './types'

type IntegratedIdentityEnv = IdentityEnv & {
  ASSETS: Fetcher;
  MELODY_AUTH_SECRETS: string;
  MELODY_ENVIRONMENT: string;
}

type MelodyAuthSecrets = {
  jwtPrivateKeyPem: string;
  jwtPublicKeyPem: string;
  sessionSecret: string;
  samlPrivateKeyPem?: string;
  samlCertificatePem?: string;
}

type StoredValue = {
  value: string;
  encoding: 'text' | 'base64';
  metadata_json: string | null;
}

const MAX_KV_VALUE_BYTES = 25 * 1024 * 1024

export function melodyBindings (
  env: IntegratedIdentityEnv,
  overrides: { internalAdmin?: boolean; projectId?: number } = {},
): MelodyBindings {
  const secrets = parseSecrets(env.MELODY_AUTH_SECRETS)
  const reserved = new Map<string, string>([
    [BaseKVKey.JwtPrivateSecret, secrets.jwtPrivateKeyPem],
    [BaseKVKey.JwtPublicSecret, secrets.jwtPublicKeyPem],
    [BaseKVKey.SessionSecret, secrets.sessionSecret],
    ...(secrets.samlPrivateKeyPem
      ? [[BaseKVKey.SamlSpKey, secrets.samlPrivateKeyPem] as const]
      : []),
    ...(secrets.samlCertificatePem
      ? [[BaseKVKey.SamlSpCert, secrets.samlCertificatePem] as const]
      : []),
  ])

  return {
    ...env,
    ENVIRONMENT: env.MELODY_ENVIRONMENT || 'prod',
    KV: createD1StrongKv(env.DB, reserved),
    MELODY_INTERNAL_ADMIN: overrides.internalAdmin === true,
    MELODY_PROJECT_ID: overrides.projectId,
  } as unknown as MelodyBindings
}

export function integratedIdentityEnv (
  env: IdentityEnv,
): IntegratedIdentityEnv {
  return env as IntegratedIdentityEnv
}

function parseSecrets (raw: string): MelodyAuthSecrets {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('melody_auth_secrets_invalid_json')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('melody_auth_secrets_invalid')
  }
  const payload = value as Record<string, unknown>
  const jwtPrivateKeyPem = requiredPem(
    payload.jwtPrivateKeyPem,
    'PRIVATE KEY',
  )
  const jwtPublicKeyPem = requiredPem(
    payload.jwtPublicKeyPem,
    'PUBLIC KEY',
  )
  const sessionSecret = typeof payload.sessionSecret === 'string'
    ? payload.sessionSecret
    : ''
  if (sessionSecret.length < 32 || sessionSecret.length > 512) {
    throw new Error('melody_session_secret_invalid')
  }
  return {
    jwtPrivateKeyPem,
    jwtPublicKeyPem,
    sessionSecret,
    samlPrivateKeyPem: optionalPem(payload.samlPrivateKeyPem),
    samlCertificatePem: optionalCertificate(payload.samlCertificatePem),
  }
}

function requiredPem (value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !value.includes(`-----BEGIN ${label}-----`) ||
    !value.includes(`-----END ${label}-----`)
  ) {
    throw new Error(`melody_${label.toLowerCase().replaceAll(' ', '_')}_invalid`)
  }
  return value
}

function optionalPem (value: unknown): string | undefined {
  if (value == null || value === '') return undefined
  return requiredPem(
    value,
    'PRIVATE KEY',
  )
}

function optionalCertificate (value: unknown): string | undefined {
  if (value == null || value === '') return undefined
  return requiredPem(
    value,
    'CERTIFICATE',
  )
}

/**
 * A KVNamespace-compatible facade backed by D1. Melody uses KV for security
 * state; D1 avoids cross-colo propagation races for single-use codes, refresh
 * rotation, MFA attempt counters and SAML replay protection.
 */
function createD1StrongKv (
  db: D1Database,
  reserved: ReadonlyMap<string, string>,
): KVNamespace {
  const get = async (
    key: string,
    options?: string | { type?: string; cacheTtl?: number },
  ): Promise<unknown> => {
    const type = typeof options === 'string' ? options : options?.type ?? 'text'
    const reservedValue = reserved.get(key)
    if (reservedValue != null) return decodeValue(
      reservedValue,
      'text',
      type,
    )
    const row = await db.prepare(
      `SELECT value,encoding,metadata_json FROM melody_runtime_kv
       WHERE key=? AND (expires_at IS NULL OR expires_at>?)`,
    ).bind(
      key,
      nowSeconds(),
    ).first<StoredValue>()
    if (!row) return null
    return decodeValue(
      row.value,
      row.encoding,
      type,
    )
  }

  const namespace = {
    get,
    async getWithMetadata (
      key: string,
      options?: string | { type?: string; cacheTtl?: number },
    ) {
      const type = typeof options === 'string' ? options : options?.type ?? 'text'
      const reservedValue = reserved.get(key)
      if (reservedValue != null) {
        return {
          value: decodeValue(
            reservedValue,
            'text',
            type,
          ),
          metadata: null,
          cacheStatus: null,
        }
      }
      const row = await db.prepare(
        `SELECT value,encoding,metadata_json FROM melody_runtime_kv
         WHERE key=? AND (expires_at IS NULL OR expires_at>?)`,
      ).bind(
        key,
        nowSeconds(),
      ).first<StoredValue>()
      return {
        value: row
          ? decodeValue(
              row.value,
              row.encoding,
              type,
            )
          : null,
        metadata: row?.metadata_json ? JSON.parse(row.metadata_json) : null,
        cacheStatus: null,
      }
    },
    async put (
      key: string,
      value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
      options: KVNamespacePutOptions = {},
    ) {
      if (reserved.has(key)) throw new Error('melody_reserved_key_read_only')
      const normalized = await normalizeValue(value)
      const byteLength = new TextEncoder().encode(normalized.value).byteLength
      if (byteLength > MAX_KV_VALUE_BYTES) throw new Error('melody_kv_value_too_large')
      const expiresAt = options.expiration != null
        ? Math.floor(options.expiration)
        : options.expirationTtl != null
          ? nowSeconds() + Math.floor(options.expirationTtl)
          : null
      await db.prepare(
        `INSERT INTO melody_runtime_kv
           (key,value,encoding,metadata_json,expires_at)
         VALUES (?,?,?,?,?)
         ON CONFLICT(key) DO UPDATE SET
           value=excluded.value,
           encoding=excluded.encoding,
           metadata_json=excluded.metadata_json,
           expires_at=excluded.expires_at,
           updated_at=CURRENT_TIMESTAMP`,
      ).bind(
        key,
        normalized.value,
        normalized.encoding,
        options.metadata == null ? null : JSON.stringify(options.metadata),
        expiresAt,
      ).run()
    },
    async delete (key: string) {
      if (reserved.has(key)) throw new Error('melody_reserved_key_read_only')
      await db.prepare('DELETE FROM melody_runtime_kv WHERE key=?').bind(key).run()
    },
    async list (options: KVNamespaceListOptions = {}) {
      const prefix = options.prefix ?? ''
      const limit = Math.min(
        1_000,
        Math.max(
          1,
          Math.floor(options.limit ?? 1_000),
        ),
      )
      const after = decodeCursor(options.cursor)
      const rows = await db.prepare(
        `SELECT key,metadata_json FROM melody_runtime_kv
         WHERE substr(key,1,?)=? AND key>?
           AND (expires_at IS NULL OR expires_at>?)
         ORDER BY key ASC LIMIT ?`,
      ).bind(
        prefix.length,
        prefix,
        after,
        nowSeconds(),
        limit + 1,
      ).all<{ key: string; metadata_json: string | null }>()
      const page = rows.results.slice(
        0,
        limit,
      )
      const complete = rows.results.length <= limit
      const keys = page.map((row) => ({
        name: row.key,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
      }))
      return {
        keys,
        list_complete: complete,
        ...(complete || page.length === 0
          ? {}
          : { cursor: encodeCursor(page.at(-1)?.key ?? '') }),
        cacheStatus: null,
      }
    },
  }
  return namespace as unknown as KVNamespace
}

async function normalizeValue (
  value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
): Promise<{ value: string; encoding: 'text' | 'base64' }> {
  if (typeof value === 'string') return {
    value,
    encoding: 'text',
  }
  let bytes: Uint8Array
  if (value instanceof ReadableStream) {
    bytes = new Uint8Array(await new Response(value).arrayBuffer())
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    )
  } else {
    bytes = new Uint8Array(value)
  }
  return {
    value: bytesToBase64(bytes),
    encoding: 'base64',
  }
}

function decodeValue (
  value: string,
  encoding: 'text' | 'base64',
  type: string,
): unknown {
  const bytes = encoding === 'base64'
    ? base64ToBytes(value)
    : new TextEncoder().encode(value)
  if (type === 'arrayBuffer') {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy.buffer
  }
  if (type === 'stream') return new Blob([Uint8Array.from(bytes)]).stream()
  const text = encoding === 'text' ? value : new TextDecoder().decode(bytes)
  if (type === 'json') return JSON.parse(text)
  return text
}

function bytesToBase64 (bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(
      offset,
      offset + chunkSize,
    ))
  }
  return btoa(binary)
}

function base64ToBytes (value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function nowSeconds (): number {
  return Math.floor(Date.now() / 1_000)
}

function encodeCursor (value: string): string {
  return bytesToBase64(new TextEncoder().encode(value))
}

function decodeCursor (value: string | null | undefined): string {
  if (!value) return ''
  try {
    return new TextDecoder().decode(base64ToBytes(value))
  } catch {
    throw new Error('melody_kv_cursor_invalid')
  }
}
