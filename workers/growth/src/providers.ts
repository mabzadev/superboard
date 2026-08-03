import type { Device, Env } from './types';
import { failure } from './validation';

const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;

export async function fetchAppleLookup(appId: string, country: string): Promise<Record<string, unknown>> {
  if (!/^\d{5,20}$/.test(appId)) throw failure('apple_app_id_invalid', 'Apple app identifiers must be numeric');
  const url = new URL('https://itunes.apple.com/lookup');
  url.searchParams.set('id', appId);
  url.searchParams.set('country', country);
  return providerJson(await fetch(url, { headers: { Accept: 'application/json' } }), 'Apple Lookup');
}

export async function fetchAppTweakMetadata(env: Env, params: {
  apps: string[]; country: string; language: string; device: Device;
}): Promise<Record<string, unknown>> {
  return appTweak(env, '/apps/metadata.json', {
    apps: params.apps.join(','), country: params.country, language: params.language, device: params.device,
  });
}

export async function fetchAppTweakKeywordMetrics(env: Env, params: {
  keywords: string[]; country: string; language: string; device: Device;
}): Promise<Record<string, unknown>> {
  return appTweak(env, '/keywords/metrics/current.json', {
    keywords: params.keywords.join(','), metrics: 'volume,search_popularity,difficulty',
    country: params.country, language: params.language, device: params.device,
  });
}

export async function fetchAppTweakAppKeywordMetrics(env: Env, params: {
  app: string; keywords: string[]; country: string; language: string; device: Device;
}): Promise<Record<string, unknown>> {
  return appTweak(env, '/apps/keywords-rankings/current.json', {
    apps: params.app, keywords: params.keywords.join(','), metrics: 'rank,installs,relevancy,kei,chance',
    country: params.country, language: params.language, device: params.device,
  });
}

async function appTweak(env: Env, path: string, query: Record<string, string>): Promise<Record<string, unknown>> {
  if (!env.APPTWEAK_API_KEY) throw failure('apptweak_not_configured', 'Advanced store intelligence is not configured', 503);
  const base = new URL(env.APPTWEAK_API_BASE_URL);
  if (base.protocol !== 'https:' || base.hostname !== 'public-api.apptweak.com') {
    throw failure('apptweak_endpoint_invalid', 'Advanced store intelligence endpoint is invalid', 503);
  }
  const url = new URL(`${base.toString().replace(/\/$/, '')}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Apptweak-Key': env.APPTWEAK_API_KEY },
  });
  return providerJson(response, 'AppTweak');
}

async function providerJson(response: Response, provider: string): Promise<Record<string, unknown>> {
  const announced = Number(response.headers.get('content-length') || 0);
  if (announced > MAX_PROVIDER_RESPONSE_BYTES) throw failure('provider_response_too_large', `${provider} returned an oversized response`, 502, true);
  const text = await response.text();
  if (text.length > MAX_PROVIDER_RESPONSE_BYTES) throw failure('provider_response_too_large', `${provider} returned an oversized response`, 502, true);
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    const error = failure('provider_request_failed', `${provider} request failed`, retryable ? 503 : 422, retryable);
    Object.assign(error, { retryDelaySeconds: retryAfter(response) });
    throw error;
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed;
  } catch {
    throw failure('provider_response_invalid', `${provider} returned invalid JSON`, 502, true);
  }
}

function retryAfter(response: Response): number {
  const raw = response.headers.get('retry-after');
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(3600, Math.ceil(seconds));
  const date = Date.parse(raw || '');
  if (Number.isFinite(date)) return Math.max(30, Math.min(3600, Math.ceil((date - Date.now()) / 1000)));
  return 60;
}

export function findMetric(payload: unknown, anchors: string[], metric: string): number | null {
  const normalizedAnchors = anchors.map(normalizeKey).filter(Boolean);
  const candidates: unknown[] = [];
  walk(payload, [], (path, key, value) => {
    if (normalizeKey(key) !== normalizeKey(metric)) return;
    const normalizedPath = path.map(normalizeKey);
    if (normalizedAnchors.every((anchor) => normalizedPath.some((segment) => segment.includes(anchor)))) candidates.push(value);
  });
  for (const candidate of candidates) {
    const parsed = metricNumber(candidate);
    if (parsed != null) return parsed;
  }
  return null;
}

export function findText(payload: unknown, names: string[]): string | null {
  let found: string | null = null;
  walk(payload, [], (_path, key, value) => {
    if (found != null || !names.map(normalizeKey).includes(normalizeKey(key))) return;
    const primitive = metricPrimitive(value);
    if (typeof primitive === 'string' && primitive.trim()) found = primitive.trim().slice(0, 1000);
  });
  return found;
}

export function findNumber(payload: unknown, names: string[]): number | null {
  let found: number | null = null;
  walk(payload, [], (_path, key, value) => {
    if (found != null || !names.map(normalizeKey).includes(normalizeKey(key))) return;
    found = metricNumber(value);
  });
  return found;
}

export function scopeByKey(payload: unknown, key: string): unknown {
  const target = normalizeKey(key);
  let found: unknown;
  walk(payload, [], (_path, candidate, value) => {
    if (found === undefined && normalizeKey(candidate) === target && value && typeof value === 'object') found = value;
  });
  return found ?? payload;
}

function metricNumber(value: unknown): number | null {
  const primitive = metricPrimitive(value);
  const parsed = typeof primitive === 'number' ? primitive : typeof primitive === 'string' ? Number(primitive) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function metricPrimitive(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return record.value ?? record.effective_value ?? record.response ?? null;
}

function walk(value: unknown, path: string[], visit: (path: string[], key: string, value: unknown) => void, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    visit(path, key, child);
    walk(child, [...path, key], visit, depth + 1);
  }
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
