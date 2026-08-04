import type { Env } from '../types';
import { appStoreConnectAccess, googlePlayAccess } from './store-verification';

const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;
const MAX_GROWTH_RESPONSE_BYTES = 256_000;

type Platform = 'apple' | 'google';
type OfficialSource = 'app_store_connect' | 'google_play';

export type OfficialMetadataTarget = {
  id: string;
  project_id: number;
  platform: Platform;
  app_identifier: string;
  country: string;
  language: string;
  device: string;
  official_synced_at: string | null;
};

export type OfficialMetadataSnapshot = {
  entity_id: string;
  app_identifier: string;
  source: OfficialSource;
  title: string | null;
  version: string | null;
  rating: number | null;
  rating_count: number | null;
  metadata: Record<string, unknown>;
};

export async function enqueueOfficialMetadataProjects(env: Env) {
  requireGrowth(env);
  if (!env.EVENT_QUEUE) throw officialError('official_metadata_queue_unavailable', 'Official metadata queue is unavailable', true);
  const projectIds = await productionProjectIds(env);
  for (let index = 0; index < projectIds.length; index += 100) {
    await env.EVENT_QUEUE.sendBatch(projectIds.slice(index, index + 100).map((projectId) => ({
      body: { type: 'growth.official-metadata.sync-project', projectId: String(projectId) },
    })));
  }
  return { enqueued: projectIds.length };
}

export async function syncOfficialMetadataProject(env: Env, rawProjectId: string | number) {
  requireGrowth(env);
  const projectId = positiveProjectId(rawProjectId);
  await reconcileConnectedTargets(env, projectId, await connectedStoreTargets(env, projectId));
  const payload = await growthJson(env, `/internal/official-metadata/targets?project_id=${projectId}`);
  const targets = Array.isArray(payload.data) ? payload.data.map(parseTarget) : [];
  const failures: Array<{ platform: Platform; operation: string; error: string; retryable: boolean }> = [];
  let snapshots = 0;

  for (const platform of ['apple', 'google'] as const) {
    const providerTargets = targets.filter((target) => target.platform === platform);
    if (providerTargets.length === 0) continue;
    try {
      const providerSnapshot = platform === 'apple'
        ? await readAppleOfficialMetadata(env, projectId, providerTargets[0])
        : await readGoogleOfficialMetadata(env, projectId, providerTargets);
      for (const target of providerTargets) {
        const snapshot = typeof providerSnapshot === 'function'
          ? providerSnapshot(target)
          : { ...providerSnapshot, entity_id: target.id, app_identifier: target.app_identifier };
        await persistSnapshot(env, projectId, snapshot);
        snapshots += 1;
      }
    } catch (error) {
      failures.push({
        platform,
        operation: 'official_owned_metadata',
        error: publicErrorMessage(error),
        retryable: Boolean((error as { retryable?: boolean })?.retryable),
      });
    }
  }

  if (failures.some((failure) => failure.retryable)) {
    const error = officialError('official_metadata_sync_incomplete', 'Official Store metadata synchronization is incomplete', true);
    Object.assign(error, { failures, retryDelaySeconds: 300 });
    throw error;
  }
  return { project_id: projectId, targets: targets.length, snapshots, failures };
}

type ConnectedStoreTarget = {
  projectId: number;
  platform: Platform;
  appIdentifier: string;
  country: string;
  language: string;
  device: string;
};

async function productionProjectIds(env: Env) {
  const rows = await env.DB.prepare(`
    SELECT id FROM projects
    WHERE COALESCE(is_test, test, 0) = 0
    ORDER BY id
    LIMIT 1000
  `).all<{ id: number }>();
  return rows.results.map((row) => positiveProjectId(row.id));
}

async function connectedStoreTargets(env: Env, projectId?: number): Promise<ConnectedStoreTarget[]> {
  const selectedProjectId = projectId == null ? null : positiveProjectId(projectId);
  const rows = await env.DB.prepare(`
    SELECT p.id AS project_id, 'apple' AS platform, CAST(ic.app_apple_id AS TEXT) AS app_identifier,
      'us' AS country, 'en' AS language, 'iphone' AS device
    FROM projects p
    JOIN applications a ON a.instance_id = p.instance_id AND a.platform = 'ios'
    JOIN ios_configurations ic ON ic.application_id = a.id
    WHERE COALESCE(p.is_test, p.test, 0) = 0 AND COALESCE(a.enabled, 1) = 1
      AND ic.app_apple_id IS NOT NULL
      AND (? IS NULL OR p.id = ?)
      AND EXISTS (
        SELECT 1 FROM ios_server_api_keys credentials
        WHERE (credentials.instance_id = CAST(a.instance_id AS TEXT) OR credentials.ios_configuration_id = ic.id)
          AND credentials.encrypted_key IS NOT NULL
          AND credentials.key_id IS NOT NULL
          AND credentials.issuer_id IS NOT NULL
      )
    UNION ALL
    SELECT p.id AS project_id, 'google' AS platform, ac.identifier AS app_identifier,
      'us' AS country, 'en' AS language, 'android' AS device
    FROM projects p
    JOIN applications a ON a.instance_id = p.instance_id AND a.platform = 'android'
    JOIN android_configurations ac ON ac.application_id = a.id
    WHERE COALESCE(p.is_test, p.test, 0) = 0 AND COALESCE(a.enabled, 1) = 1
      AND (? IS NULL OR p.id = ?)
      AND EXISTS (
        SELECT 1 FROM android_server_api_keys credentials
        WHERE (credentials.instance_id = CAST(a.instance_id AS TEXT) OR credentials.android_configuration_id = ac.id)
          AND credentials.encrypted_key IS NOT NULL
          AND credentials.client_email IS NOT NULL
      )
    ORDER BY project_id, platform
  `).bind(
    selectedProjectId, selectedProjectId,
    selectedProjectId, selectedProjectId,
  ).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    projectId: positiveProjectId(row.project_id),
    platform: row.platform === 'apple' ? 'apple' : row.platform === 'google' ? 'google' : invalidPlatform(),
    appIdentifier: requiredText(row.app_identifier, 'app_identifier'),
    country: requiredText(row.country, 'country'),
    language: requiredText(row.language, 'language'),
    device: requiredText(row.device, 'device'),
  }));
}

async function reconcileConnectedTargets(env: Env, projectId: number, targets: ConnectedStoreTarget[]) {
  await growthJson(env, `/internal/projects/${projectId}/official-metadata/targets/reconcile`, {
    method: 'POST',
    body: JSON.stringify({
      targets: targets.map((target) => ({
        platform: target.platform,
        app_identifier: target.appIdentifier,
        country: target.country,
        language: target.language,
        device: target.device,
      })),
    }),
  });
}

export async function queueOfficialMetadataSyncIfDue(env: Env, now = new Date()) {
  if (!env.GROWTH || !env.GROWTH_INTERNAL_TOKEN || !env.EVENT_QUEUE) return { queued: false, reason: 'not_configured' };
  const date = now.toISOString().slice(0, 10);
  const key = `growth:official-metadata:scheduled:${date}`;
  if (await env.KV.get(key)) return { queued: false, reason: 'already_queued' };
  await env.EVENT_QUEUE.send({ type: 'growth.official-metadata.sync-all' });
  await env.KV.put(key, date, { expirationTtl: 172_800 });
  return { queued: true };
}

async function readAppleOfficialMetadata(
  env: Env,
  projectId: number,
  target: OfficialMetadataTarget,
): Promise<OfficialMetadataSnapshot> {
  const access = await appStoreConnectAccess(env, projectId);
  if (target.app_identifier !== access.appId) {
    throw officialError(
      'apple_identifier_mismatch',
      'The configured Apple app identifier does not match the connected App Store app',
      false,
    );
  }
  const payload = await providerJson(
    `https://api.appstoreconnect.apple.com/v1/apps/${encodeURIComponent(access.appId)}/appStoreVersions?limit=200`,
    access.token,
    'App Store Connect',
  );
  const versions = Array.isArray(payload.data) ? payload.data as Array<Record<string, unknown>> : [];
  const current = selectAppleVersion(versions, target.device);
  const attributes = object(current?.attributes);
  return {
    entity_id: target.id,
    app_identifier: target.app_identifier,
    source: 'app_store_connect',
    title: access.name,
    version: textOrNull(attributes.versionString),
    rating: null,
    rating_count: null,
    metadata: {
      provider_app_id: access.appId,
      bundle_id: access.bundleId,
      primary_locale: access.primaryLocale,
      version_resource_id: textOrNull(current?.id),
      platform: textOrNull(attributes.platform),
      app_store_state: textOrNull(attributes.appStoreState),
      created_date: textOrNull(attributes.createdDate),
    },
  };
}

async function readGoogleOfficialMetadata(
  env: Env,
  projectId: number,
  targets: OfficialMetadataTarget[],
): Promise<(target: OfficialMetadataTarget) => OfficialMetadataSnapshot> {
  const access = await googlePlayAccess(env, projectId);
  if (targets.some((target) => target.app_identifier !== access.packageName)) {
    throw officialError(
      'google_identifier_mismatch',
      'The configured Google app identifier does not match the connected Play Store app',
      false,
    );
  }
  const packageName = encodeURIComponent(access.packageName);
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/edits`;
  const edit = await providerJson(base, access.token, 'Google Play', { method: 'POST', body: '{}' });
  const editId = textOrNull(edit.id);
  if (!editId) throw officialError('google_edit_invalid', 'Google Play returned an invalid temporary edit', true);
  let listingsPayload: Record<string, unknown>;
  let tracksPayload: Record<string, unknown>;
  let operationError: unknown = null;
  try {
    [listingsPayload, tracksPayload] = await Promise.all([
      providerJson(`${base}/${encodeURIComponent(editId)}/listings`, access.token, 'Google Play'),
      providerJson(`${base}/${encodeURIComponent(editId)}/tracks`, access.token, 'Google Play'),
    ]);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await providerJson(
        `${base}/${encodeURIComponent(editId)}`,
        access.token,
        'Google Play',
        { method: 'DELETE' },
        [404],
      );
    } catch (cleanupError) {
      if (!operationError) throw cleanupError;
      console.error(JSON.stringify({
        event: 'google_official_metadata_edit_cleanup_failed',
        project_id: projectId,
        error: publicErrorMessage(cleanupError),
      }));
    }
  }
  const listings = Array.isArray(listingsPayload!.listings)
    ? listingsPayload!.listings as Array<Record<string, unknown>>
    : [];
  const release = selectGoogleRelease(Array.isArray(tracksPayload!.tracks)
    ? tracksPayload!.tracks as Array<Record<string, unknown>>
    : []);
  return (target) => {
    const listing = selectGoogleListing(listings, target.language, target.country);
    const versionCodes = Array.isArray(release.release.versionCodes)
      ? release.release.versionCodes.map(String).filter(Boolean)
      : [];
    return {
      entity_id: target.id,
      app_identifier: target.app_identifier,
      source: 'google_play',
      title: textOrNull(listing.title),
      version: textOrNull(release.release.name) || highestVersionCode(versionCodes),
      rating: null,
      rating_count: null,
      metadata: {
        package_name: access.packageName,
        listing_language: textOrNull(listing.language),
        short_description: textOrNull(listing.shortDescription),
        full_description: textOrNull(listing.fullDescription),
        track: textOrNull(release.track.track),
        release_status: textOrNull(release.release.status),
        version_codes: versionCodes.slice(0, 100),
      },
    };
  };
}

export function selectAppleVersion(versions: Array<Record<string, unknown>>, device: string) {
  const expectedPlatform = device === 'iphone' || device === 'ipad' ? 'IOS' : '';
  return [...versions]
    .filter((version) => !expectedPlatform || String(object(version.attributes).platform || '').toUpperCase() === expectedPlatform)
    .sort((left, right) => appleVersionScore(right) - appleVersionScore(left))[0] || null;
}

export function selectGoogleListing(
  listings: Array<Record<string, unknown>>,
  language: string,
  country: string,
) {
  const requested = `${language.split('-')[0]}-${country.toUpperCase()}`.toLowerCase();
  return listings.find((listing) => String(listing.language || '').toLowerCase() === requested)
    || listings.find((listing) => String(listing.language || '').toLowerCase() === language.toLowerCase())
    || listings.find((listing) => String(listing.language || '').toLowerCase().startsWith(`${language.split('-')[0].toLowerCase()}-`))
    || listings[0]
    || {};
}

export function selectGoogleRelease(tracks: Array<Record<string, unknown>>) {
  const candidates = tracks.flatMap((track) => {
    const releases = Array.isArray(track.releases) ? track.releases as Array<Record<string, unknown>> : [];
    return releases.map((release) => ({ track, release }));
  }).filter(({ release }) => String(release.status || '').toLowerCase() !== 'draft');
  candidates.sort((left, right) => {
    const leftProduction = String(left.track.track || '').split(':').pop() === 'production' ? 1 : 0;
    const rightProduction = String(right.track.track || '').split(':').pop() === 'production' ? 1 : 0;
    if (leftProduction !== rightProduction) return rightProduction - leftProduction;
    return compareVersionCodes(right.release.versionCodes, left.release.versionCodes);
  });
  return candidates[0] || { track: {}, release: {} };
}

async function persistSnapshot(env: Env, projectId: number, snapshot: OfficialMetadataSnapshot) {
  await growthJson(env, `/internal/projects/${projectId}/official-metadata/snapshots`, {
    method: 'POST',
    body: JSON.stringify(snapshot),
  });
}

async function growthJson(env: Env, path: string, init: RequestInit = {}) {
  requireGrowth(env);
  const headers = new Headers(init.headers);
  headers.set('X-OpenGrow-Internal-Token', env.GROWTH_INTERNAL_TOKEN!);
  headers.set('X-OpenGrow-Actor-Id', 'official-store-sync');
  if (init.body != null) headers.set('Content-Type', 'application/json');
  const response = await env.GROWTH!.fetch(new Request(`https://growth.internal${path}`, { ...init, headers }));
  return readJson(response, 'Growth', MAX_GROWTH_RESPONSE_BYTES);
}

async function providerJson(
  url: string,
  token: string,
  provider: string,
  init: RequestInit = {},
  acceptedStatuses: number[] = [],
) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (init.body != null) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  return readJson(response, provider, MAX_PROVIDER_RESPONSE_BYTES, acceptedStatuses);
}

async function readJson(response: Response, provider: string, limit: number, acceptedStatuses: number[] = []) {
  const announced = Number(response.headers.get('content-length') || 0);
  if (announced > limit) throw officialError('official_metadata_response_too_large', `${provider} returned an oversized response`, true);
  const text = await response.text();
  if (text.length > limit) throw officialError('official_metadata_response_too_large', `${provider} returned an oversized response`, true);
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
      payload = parsed as Record<string, unknown>;
    } catch {
      throw officialError('official_metadata_response_invalid', `${provider} returned invalid JSON`, true);
    }
  }
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    const retryable = response.status === 429 || response.status >= 500;
    throw officialError('official_metadata_request_failed', `${provider} request failed`, retryable);
  }
  return payload;
}

function parseTarget(value: unknown): OfficialMetadataTarget {
  const row = object(value);
  const platform = row.platform;
  if (platform !== 'apple' && platform !== 'google') {
    throw officialError('official_metadata_target_invalid', 'Growth returned an invalid metadata target', false);
  }
  return {
    id: requiredText(row.id, 'id'),
    project_id: positiveProjectId(row.project_id),
    platform,
    app_identifier: requiredText(row.app_identifier, 'app_identifier'),
    country: requiredText(row.country, 'country'),
    language: requiredText(row.language, 'language'),
    device: requiredText(row.device, 'device'),
    official_synced_at: textOrNull(row.official_synced_at),
  };
}

function requireGrowth(env: Env) {
  if (!env.GROWTH || !env.GROWTH_INTERNAL_TOKEN) {
    throw officialError('official_metadata_unavailable', 'Official metadata services are unavailable', true);
  }
}

function requiredText(value: unknown, field: string) {
  const parsed = textOrNull(value);
  if (!parsed) throw officialError('official_metadata_target_invalid', `Growth returned an invalid ${field}`, false);
  return parsed;
}

function positiveProjectId(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw officialError('official_metadata_project_invalid', 'Official metadata project ID is invalid', false);
  }
  return parsed;
}

function invalidPlatform(): never {
  throw officialError('official_metadata_target_invalid', 'Store configuration returned an invalid platform', false);
}

function appleVersionScore(version: Record<string, unknown>) {
  const attributes = object(version.attributes);
  const state = String(attributes.appStoreState || '').toUpperCase();
  const stateScore = ['READY_FOR_SALE', 'PROCESSING_FOR_APP_STORE', 'PENDING_APPLE_RELEASE', 'PENDING_DEVELOPER_RELEASE']
    .includes(state) ? 2 : 1;
  const dateScore = Date.parse(String(attributes.createdDate || '')) || 0;
  return stateScore * 10 ** 15 + dateScore;
}

function compareVersionCodes(left: unknown, right: unknown) {
  const leftCode = highestVersionCode(Array.isArray(left) ? left.map(String) : []);
  const rightCode = highestVersionCode(Array.isArray(right) ? right.map(String) : []);
  try {
    const difference = BigInt(leftCode || '0') - BigInt(rightCode || '0');
    return difference > 0n ? 1 : difference < 0n ? -1 : 0;
  } catch {
    return String(leftCode || '').localeCompare(String(rightCode || ''), 'en', { numeric: true });
  }
}

function highestVersionCode(values: string[]) {
  return [...values].sort((left, right) => compareNumericText(right, left))[0] || null;
}

function compareNumericText(left: string, right: string) {
  try {
    const difference = BigInt(left) - BigInt(right);
    return difference > 0n ? 1 : difference < 0n ? -1 : 0;
  } catch {
    return left.localeCompare(right, 'en', { numeric: true });
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 10_000) : null;
}

function publicErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : 'Official metadata synchronization failed';
}

function officialError(code: string, message: string, retryable: boolean) {
  return Object.assign(new Error(message), { code, retryable, retryDelaySeconds: retryable ? 300 : undefined });
}
