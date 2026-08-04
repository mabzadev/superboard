import type { Device, Env, Platform } from './types';
import { audit, refreshRecommendations } from './sync';
import { device, failure, jsonObject, locale, optionalString, platform, requiredString } from './validation';

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

export async function reconcileManagedOfficialMetadataTargets(
  env: Env,
  projectId: number,
  input: Record<string, unknown>,
  actorId = 'official-store-sync',
) {
  if (!Array.isArray(input.targets) || input.targets.length > 4) {
    throw failure('official_metadata_targets_invalid', 'targets must be an array with at most four Store apps');
  }
  const targets = input.targets.map(parseManagedTarget);
  if (new Set(targets.map((target) => target.platform)).size !== targets.length) {
    throw failure('official_metadata_targets_invalid', 'Only one managed Store app is allowed per platform');
  }
  const desiredPlatforms = new Set(targets.map((target) => target.platform));
  const managedRows = await env.DB.prepare(`
    SELECT id, platform FROM growth_apps
    WHERE project_id = ? AND management_source = 'store_connection'
  `).bind(projectId).all<{ id: string; platform: Platform }>();
  for (const row of managedRows.results) {
    if (desiredPlatforms.has(row.platform)) continue;
    await env.DB.prepare(`
      UPDATE growth_apps SET enabled = 0, is_primary = 0, updated_at = datetime('now')
      WHERE id = ? AND project_id = ?
    `).bind(row.id, projectId).run();
  }

  const reconciled: Array<Record<string, unknown>> = [];
  for (const target of targets) {
    const [managed, exact] = await Promise.all([
      env.DB.prepare(`
        SELECT * FROM growth_apps
        WHERE project_id = ? AND platform = ? AND management_source = 'store_connection'
        LIMIT 1
      `).bind(projectId, target.platform).first<Record<string, unknown>>(),
      env.DB.prepare(`
        SELECT * FROM growth_apps
        WHERE project_id = ? AND platform = ? AND app_identifier = ?
          AND country = ? AND language = ? AND device = ?
        LIMIT 1
      `).bind(
        projectId, target.platform, target.appIdentifier,
        target.country, target.language, target.device,
      ).first<Record<string, unknown>>(),
    ]);
    let id = String(managed?.id || exact?.id || crypto.randomUUID());
    if (exact && managed && exact.id !== managed.id) {
      await env.DB.prepare(`
        UPDATE growth_apps
        SET management_source = NULL, enabled = 0, is_primary = 0, updated_at = datetime('now')
        WHERE id = ? AND project_id = ?
      `).bind(String(managed.id), projectId).run();
      id = String(exact.id);
    }
    if (exact) {
      await env.DB.prepare(`
        UPDATE growth_apps
        SET management_source = 'store_connection', enabled = 1, is_primary = 1,
          updated_at = datetime('now')
        WHERE id = ? AND project_id = ?
      `).bind(id, projectId).run();
    } else if (managed) {
      await env.DB.prepare(`
        UPDATE growth_apps
        SET app_identifier = ?, country = ?, language = ?, device = ?,
          enabled = 1, is_primary = 1, updated_at = datetime('now')
        WHERE id = ? AND project_id = ?
      `).bind(
        target.appIdentifier, target.country, target.language, target.device,
        id, projectId,
      ).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO growth_apps (
          id, project_id, platform, app_identifier, country, language, device,
          is_primary, enabled, management_source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 'store_connection')
      `).bind(
        id, projectId, target.platform, target.appIdentifier,
        target.country, target.language, target.device,
      ).run();
    }
    const row = await env.DB.prepare('SELECT * FROM growth_apps WHERE id = ? AND project_id = ?')
      .bind(id, projectId).first<Record<string, unknown>>();
    if (row) reconciled.push(row);
  }
  await audit(env, projectId, 'growth.official_metadata.targets_reconciled', 'project', String(projectId), {
    platforms: targets.map((target) => target.platform),
    target_count: targets.length,
  }, actorId);
  return reconciled;
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

function parseManagedTarget(value: unknown): {
  platform: Platform;
  appIdentifier: string;
  country: string;
  language: string;
  device: Device;
} {
  const input = jsonObject(value, 'target');
  const selectedPlatform = platform(input.platform);
  return {
    platform: selectedPlatform,
    appIdentifier: requiredString(input.app_identifier, 'app_identifier', 255),
    country: locale(input.country, 'country', 'us'),
    language: locale(input.language, 'language', 'en'),
    device: device(input.device, selectedPlatform),
  };
}
