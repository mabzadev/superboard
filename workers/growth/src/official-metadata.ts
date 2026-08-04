import type { Env, Platform } from './types';
import { audit, refreshRecommendations } from './sync';
import { failure, jsonObject, optionalString, requiredString } from './validation';

export type OfficialMetadataSource = 'app_store_connect' | 'google_play';

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

export async function listOfficialMetadataProjects(env: Env) {
  const rows = await env.DB.prepare(`
    SELECT DISTINCT project_id
    FROM growth_apps
    WHERE enabled = 1
    ORDER BY project_id
    LIMIT 1000
  `).all<{ project_id: number }>();
  return rows.results;
}

export async function listOfficialMetadataTargets(env: Env, projectId: number) {
  const rows = await env.DB.prepare(`
    SELECT a.id, a.project_id, a.platform, a.app_identifier, a.country, a.language, a.device,
      MAX(s.created_at) AS official_synced_at
    FROM growth_apps a
    LEFT JOIN growth_app_snapshots s
      ON s.entity_type = 'app' AND s.entity_id = a.id
      AND s.source = CASE a.platform WHEN 'apple' THEN 'app_store_connect' ELSE 'google_play' END
    WHERE a.project_id = ? AND a.enabled = 1
    GROUP BY a.id, a.project_id, a.platform, a.app_identifier, a.country, a.language, a.device
    ORDER BY a.platform, a.id
    LIMIT 250
  `).bind(projectId).all<OfficialMetadataTarget>();
  return rows.results;
}

export async function persistOfficialMetadataSnapshot(
  env: Env,
  projectId: number,
  input: Record<string, unknown>,
  actorId = 'official-store-sync',
) {
  const entityId = requiredString(input.entity_id, 'entity_id', 64);
  const appIdentifier = requiredString(input.app_identifier, 'app_identifier', 255);
  const source = officialSource(input.source);
  const target = await env.DB.prepare(`
    SELECT id, platform, app_identifier
    FROM growth_apps
    WHERE id = ? AND project_id = ? AND enabled = 1
  `).bind(entityId, projectId).first<{ id: string; platform: Platform; app_identifier: string }>();
  if (!target) throw failure('official_metadata_target_not_found', 'Official metadata target not found', 404);
  if (target.app_identifier !== appIdentifier) {
    throw failure('official_metadata_identifier_mismatch', 'Official metadata does not match the configured app identifier', 409);
  }
  const expectedSource: OfficialMetadataSource = target.platform === 'apple' ? 'app_store_connect' : 'google_play';
  if (source !== expectedSource) {
    throw failure('official_metadata_source_mismatch', 'Official metadata source does not match the configured platform', 409);
  }

  const title = optionalString(input.title, 'title', 255);
  const version = optionalString(input.version, 'version', 120);
  const rating = optionalRating(input.rating);
  const ratingCount = optionalCount(input.rating_count, 'rating_count');
  const metadata = jsonObject(input.metadata, 'metadata');
  const observedDate = new Date().toISOString().slice(0, 10);
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO growth_app_snapshots (
      id, project_id, entity_type, entity_id, source, observed_date,
      title, version, rating, rating_count, metadata_json
    ) VALUES (?, ?, 'app', ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, entity_id, source, observed_date) DO UPDATE SET
      title = excluded.title,
      version = excluded.version,
      rating = excluded.rating,
      rating_count = excluded.rating_count,
      metadata_json = excluded.metadata_json,
      created_at = datetime('now')
  `).bind(
    id, projectId, entityId, source, observedDate, title, version,
    rating, ratingCount, JSON.stringify(metadata),
  ).run();
  if (title) {
    await env.DB.prepare(`
      UPDATE growth_apps SET display_name = ?, updated_at = datetime('now')
      WHERE id = ? AND project_id = ?
    `).bind(title, entityId, projectId).run();
  }
  await audit(env, projectId, 'growth.official_metadata.synced', 'app', entityId, {
    source,
    app_identifier: appIdentifier,
    observed_date: observedDate,
    title,
    version,
  }, actorId);
  if (rating != null) await refreshRecommendations(env, projectId);
  return { id, entity_id: entityId, source, observed_date: observedDate };
}

function officialSource(value: unknown): OfficialMetadataSource {
  if (value !== 'app_store_connect' && value !== 'google_play') {
    throw failure('official_metadata_source_invalid', 'source must be app_store_connect or google_play');
  }
  return value;
}

function optionalRating(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5) {
    throw failure('rating_invalid', 'rating must be between 0 and 5');
  }
  return parsed;
}

function optionalCount(value: unknown, field: string): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw failure(`${field}_invalid`, `${field} must be a non-negative integer`);
  }
  return parsed;
}
