import { failure } from './auth';

export const MAX_JSON_BYTES = 256 * 1024;

export async function readJsonObject(request: Request, maxBytes = MAX_JSON_BYTES): Promise<Record<string, unknown>> {
  const announced = Number(request.headers.get('content-length') || 0);
  if (announced > maxBytes) throw failure('request_too_large', `Request body is limited to ${maxBytes} bytes`, 413);
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('request too large');
        throw failure('request_too_large', `Request body is limited to ${maxBytes} bytes`, 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw failure('json_invalid', 'Request body must contain valid JSON', 400); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw failure('json_invalid', 'Request body must be a JSON object', 400);
  return parsed as Record<string, unknown>;
}

export function text(value: unknown, field: string, max = 255): string {
  const parsed = typeof value === 'string' ? value.trim() : '';
  if (!parsed || parsed.length > max) throw failure(`${field}_invalid`, `${field} is required and limited to ${max} characters`);
  return parsed;
}

export function optionalText(value: unknown, field: string, max = 255): string | null {
  if (value == null || value === '') return null;
  const parsed = String(value).trim();
  if (parsed.length > max) throw failure(`${field}_invalid`, `${field} is limited to ${max} characters`);
  return parsed || null;
}

export function email(value: unknown, field = 'email'): string {
  const parsed = text(value, field, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed)) throw failure(`${field}_invalid`, `${field} must be a valid email address`);
  return parsed;
}

export function identifier(value: unknown, field = 'identifier'): string {
  const parsed = text(value, field, 128).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(parsed)) throw failure(`${field}_invalid`, `${field} must contain lowercase letters, numbers, underscores or hyphens`);
  return parsed;
}

export function jsonObject(value: unknown, field: string, maxBytes = 32_000): Record<string, unknown> {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure(`${field}_invalid`, `${field} must be an object`);
  const serialized = JSON.stringify(value);
  if (serialized.length > maxBytes) throw failure(`${field}_invalid`, `${field} is too large`);
  return JSON.parse(serialized) as Record<string, unknown>;
}

export function stringArray(value: unknown, field: string, maxItems = 100): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw failure(`${field}_invalid`, `${field} must be an array`);
  const values = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (values.length > maxItems || values.some((item) => item.length > 255)) throw failure(`${field}_invalid`, `${field} contains invalid values`);
  return values;
}

export function booleanValue(value: unknown, fallback = false) {
  return value == null ? fallback : value === true;
}

export function isoTimestamp(value: unknown, field: string, optional = true): string | null {
  if (optional && (value == null || value === '')) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw failure(`${field}_invalid`, `${field} must be an ISO-8601 timestamp`);
  return date.toISOString();
}

export function positiveInt(value: unknown, field: string, fallback?: number) {
  const parsed = value == null && fallback !== undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw failure(`${field}_invalid`, `${field} must be a positive integer`);
  return parsed;
}

export function parseStoredJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
