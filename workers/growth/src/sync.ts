import {
  fetchAppleLookup,
  fetchAppTweakAppKeywordMetrics,
  fetchAppTweakKeywordMetrics,
  fetchAppTweakMetadata,
  findMetric,
  findNumber,
  findText,
  scopeByKey,
} from './providers';
import type { Device, Env, Platform } from './types';

type StoreEntity = {
  id: string;
  project_id: number;
  platform: Platform;
  app_identifier: string;
  country: string;
  language: string;
  device: Device;
};

type Keyword = {
  id: string;
  project_id: number;
  app_id: string;
  app_identifier: string;
  keyword: string;
  country: string;
  language: string;
  device: Device;
};

export async function syncProject(env: Env, projectId: number) {
  const [apps, competitors, keywords] = await Promise.all([
    env.DB.prepare('SELECT * FROM growth_apps WHERE project_id = ? AND enabled = 1 ORDER BY id').bind(projectId).all<StoreEntity>(),
    env.DB.prepare('SELECT * FROM growth_competitors WHERE project_id = ? AND enabled = 1 ORDER BY id').bind(projectId).all<StoreEntity>(),
    env.DB.prepare(`
      SELECT k.*, a.app_identifier, a.device
      FROM growth_keywords k JOIN growth_apps a ON a.id = k.app_id
      WHERE k.project_id = ? AND k.enabled = 1 AND a.enabled = 1 ORDER BY k.id
    `).bind(projectId).all<Keyword>(),
  ]);
  const failures: Array<{ operation: string; error: string; retryable: boolean }> = [];
  let appSnapshots = 0;
  let keywordSnapshots = 0;

  for (const entity of [...apps.results, ...competitors.results]) {
    if (entity.platform !== 'apple') continue;
    try {
      const payload = await fetchAppleLookup(entity.app_identifier, entity.country);
      await persistAppSnapshot(env, entity, apps.results.includes(entity) ? 'app' : 'competitor', 'apple_lookup', payload);
      appSnapshots += 1;
    } catch (error) {
      failures.push(providerFailure(`apple_lookup:${entity.id}`, error));
    }
  }

  if (env.APPTWEAK_API_KEY) {
    const entities = [
      ...apps.results.map((entity) => ({ ...entity, entity_type: 'app' as const })),
      ...competitors.results.map((entity) => ({ ...entity, entity_type: 'competitor' as const })),
    ];
    for (const group of grouped(entities, (entity) => `${entity.country}:${entity.language}:${entity.device}`)) {
      for (const batch of chunks(group, 5)) {
        try {
          const first = batch[0];
          const payload = await fetchAppTweakMetadata(env, {
            apps: batch.map((item) => item.app_identifier),
            country: first.country, language: first.language, device: first.device,
          });
          for (const entity of batch) {
            await persistAppSnapshot(env, entity, entity.entity_type, 'apptweak', payload);
            appSnapshots += 1;
          }
        } catch (error) {
          failures.push(providerFailure(`apptweak_metadata:${batch.map((item) => item.id).join(',')}`, error));
        }
      }
    }

    for (const group of grouped(keywords.results, (keyword) => `${keyword.app_id}:${keyword.country}:${keyword.language}:${keyword.device}`)) {
      for (const batch of chunks(group, 5)) {
        try {
          const first = batch[0];
          const words = batch.map((item) => item.keyword);
          const [keywordPayload, appPayload] = await Promise.all([
            fetchAppTweakKeywordMetrics(env, {
              keywords: words, country: first.country, language: first.language, device: first.device,
            }),
            fetchAppTweakAppKeywordMetrics(env, {
              app: first.app_identifier, keywords: words,
              country: first.country, language: first.language, device: first.device,
            }),
          ]);
          for (const keyword of batch) {
            await persistKeywordSnapshot(env, keyword, keywordPayload, appPayload);
            keywordSnapshots += 1;
          }
        } catch (error) {
          failures.push(providerFailure(`apptweak_keywords:${batch.map((item) => item.id).join(',')}`, error));
        }
      }
    }
  }

  await refreshRecommendations(env, projectId);
  await audit(env, projectId, 'growth.sync.completed', 'project', String(projectId), {
    app_snapshots: appSnapshots,
    keyword_snapshots: keywordSnapshots,
    failures,
    advanced_provider_configured: Boolean(env.APPTWEAK_API_KEY),
  });
  return {
    app_snapshots: appSnapshots,
    keyword_snapshots: keywordSnapshots,
    advanced_provider_configured: Boolean(env.APPTWEAK_API_KEY),
    failures,
  };
}

export async function enqueueAllProjects(env: Env) {
  const rows = await env.DB.prepare(`
    SELECT DISTINCT project_id FROM growth_apps WHERE enabled = 1
    UNION SELECT DISTINCT project_id FROM growth_competitors WHERE enabled = 1
  `).all<{ project_id: number }>();
  await Promise.all(rows.results.map((row) => env.GROWTH_QUEUE.send({ type: 'growth.project.sync', projectId: row.project_id })));
  return { enqueued: rows.results.length };
}

async function persistAppSnapshot(
  env: Env,
  entity: StoreEntity,
  entityType: 'app' | 'competitor',
  source: 'apple_lookup' | 'apptweak',
  payload: Record<string, unknown>,
) {
  const scoped = source === 'apple_lookup'
    ? ((Array.isArray(payload.results) ? payload.results[0] : payload) || payload)
    : scopeByKey(payload, entity.app_identifier);
  const observedDate = new Date().toISOString().slice(0, 10);
  const title = findText(scoped, ['trackName', 'title', 'name']);
  const version = findText(scoped, ['version', 'currentVersionReleaseDate']);
  const rating = findNumber(scoped, ['averageUserRating', 'rating', 'score']);
  const ratingCount = findNumber(scoped, ['userRatingCount', 'ratings_count', 'rating_count', 'reviews_count']);
  await env.DB.prepare(`
    INSERT INTO growth_app_snapshots (
      id, project_id, entity_type, entity_id, source, observed_date,
      title, version, rating, rating_count, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, entity_id, source, observed_date) DO UPDATE SET
      title = excluded.title, version = excluded.version, rating = excluded.rating,
      rating_count = excluded.rating_count, metadata_json = excluded.metadata_json
  `).bind(
    crypto.randomUUID(), entity.project_id, entityType, entity.id, source, observedDate,
    title, version, rating, ratingCount == null ? null : Math.round(ratingCount), JSON.stringify(payload),
  ).run();
  if (title) {
    const table = entityType === 'app' ? 'growth_apps' : 'growth_competitors';
    await env.DB.prepare(`UPDATE ${table} SET display_name = ?, updated_at = datetime('now') WHERE id = ?`).bind(title, entity.id).run();
  }
}

async function persistKeywordSnapshot(
  env: Env,
  keyword: Keyword,
  keywordPayload: Record<string, unknown>,
  appPayload: Record<string, unknown>,
) {
  const observedDate = new Date().toISOString().slice(0, 10);
  const anchors = [keyword.keyword];
  const appAnchors = [keyword.app_identifier, keyword.keyword];
  const metrics = {
    rank: findMetric(appPayload, appAnchors, 'rank'),
    volume: findMetric(keywordPayload, anchors, 'volume'),
    search_popularity: findMetric(keywordPayload, anchors, 'search_popularity'),
    difficulty: findMetric(keywordPayload, anchors, 'difficulty'),
    installs: findMetric(appPayload, appAnchors, 'installs'),
    relevancy: findMetric(appPayload, appAnchors, 'relevancy'),
    chance: findMetric(appPayload, appAnchors, 'chance'),
    kei: findMetric(appPayload, appAnchors, 'kei'),
  };
  await env.DB.prepare(`
    INSERT INTO growth_keyword_snapshots (
      id, project_id, keyword_id, source, observed_date, rank, volume,
      search_popularity, difficulty, installs, relevancy, chance, kei, raw_json
    ) VALUES (?, ?, ?, 'apptweak', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(keyword_id, source, observed_date) DO UPDATE SET
      rank = excluded.rank, volume = excluded.volume, search_popularity = excluded.search_popularity,
      difficulty = excluded.difficulty, installs = excluded.installs, relevancy = excluded.relevancy,
      chance = excluded.chance, kei = excluded.kei, raw_json = excluded.raw_json
  `).bind(
    crypto.randomUUID(), keyword.project_id, keyword.id, observedDate,
    metrics.rank, metrics.volume, metrics.search_popularity, metrics.difficulty,
    metrics.installs, metrics.relevancy, metrics.chance, metrics.kei,
    JSON.stringify({ keyword_metrics: keywordPayload, app_keyword_metrics: appPayload }),
  ).run();
}

async function refreshRecommendations(env: Env, projectId: number) {
  const weakKeywords = await env.DB.prepare(`
    SELECT k.id, k.keyword, s.rank, s.volume, s.difficulty
    FROM growth_keywords k JOIN growth_keyword_snapshots s ON s.keyword_id = k.id
    WHERE k.project_id = ? AND s.observed_date = (
      SELECT MAX(s2.observed_date) FROM growth_keyword_snapshots s2 WHERE s2.keyword_id = k.id
    ) AND s.rank > 20
    ORDER BY COALESCE(s.volume, 0) DESC LIMIT 20
  `).bind(projectId).all<Record<string, unknown>>();
  for (const row of weakKeywords.results) {
    const rank = Number(row.rank);
    await upsertRecommendation(env, projectId, `keyword:${row.id}:rank`, 'keyword_opportunity', rank > 100 ? 'high' : 'medium',
      `Improve ranking for “${String(row.keyword).slice(0, 80)}”`,
      `The latest observed rank is ${rank}. Review metadata relevance and competitor positioning.`, row);
  }

  const lowRatings = await env.DB.prepare(`
    SELECT s.entity_type, s.entity_id, s.title, s.rating, s.rating_count
    FROM growth_app_snapshots s
    WHERE s.project_id = ? AND s.entity_type = 'app' AND s.rating < 4
      AND s.observed_date = (
        SELECT MAX(s2.observed_date) FROM growth_app_snapshots s2
        WHERE s2.entity_type = s.entity_type AND s2.entity_id = s.entity_id
      )
  `).bind(projectId).all<Record<string, unknown>>();
  for (const row of lowRatings.results) {
    await upsertRecommendation(env, projectId, `app:${row.entity_id}:rating`, 'rating_risk', 'high',
      `Address the rating decline for ${String(row.title || 'the app').slice(0, 80)}`,
      `The latest observed rating is ${Number(row.rating).toFixed(2)}. Prioritize unanswered negative reviews and recurring issues.`, row);
  }
}

async function upsertRecommendation(
  env: Env, projectId: number, key: string, kind: string, priority: string,
  title: string, summary: string, evidence: unknown,
) {
  await env.DB.prepare(`
    INSERT INTO growth_recommendations (
      id, project_id, recommendation_key, kind, priority, title, summary, evidence_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, recommendation_key) DO UPDATE SET
      kind = excluded.kind, priority = excluded.priority, title = excluded.title,
      summary = excluded.summary, evidence_json = excluded.evidence_json, updated_at = datetime('now')
  `).bind(crypto.randomUUID(), projectId, key, kind, priority, title, summary, JSON.stringify(evidence)).run();
}

export async function audit(
  env: Env, projectId: number, eventType: string, resourceType: string,
  resourceId: string, payload: unknown, actorId: string | null = null,
) {
  await env.DB.prepare(`
    INSERT INTO growth_audit_events (id, project_id, event_type, actor_id, resource_type, resource_id, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), projectId, eventType, actorId, resourceType, resourceId, JSON.stringify(payload)).run();
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function grouped<T>(items: T[], key: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) || []), item]);
  return [...groups.values()];
}

function providerFailure(operation: string, error: unknown) {
  return {
    operation,
    error: error instanceof Error ? error.message : String(error),
    retryable: Boolean((error as { retryable?: boolean })?.retryable),
  };
}
