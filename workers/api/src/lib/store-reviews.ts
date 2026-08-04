import type { Env } from '../types';
import { appStoreConnectAccess, googlePlayAccess } from './store-verification';

export type ReviewProjection = {
  provider: 'apple' | 'google';
  providerReviewId: string;
  rating: number;
  title?: string | null;
  body?: string | null;
  originalBody?: string | null;
  translatedBody?: string | null;
  translationLanguage?: string | null;
  authorName?: string | null;
  language?: string | null;
  territory?: string | null;
  appVersion?: string | null;
  providerCreatedAt?: string | null;
  providerUpdatedAt?: string | null;
  responseId?: string | null;
  responseBody?: string | null;
  responseState?: string | null;
  responseUpdatedAt?: string | null;
  observedAt?: string | null;
  rawPayload: unknown;
};

type ReviewSyncCursor = {
  version: 1;
  watermark: string | null;
  full_synced_at: string | null;
};

const APPLE_FULL_RECONCILIATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function reviewError(code: string, message: string, retryable = false, retryDelaySeconds?: number) {
  return Object.assign(new Error(message), { code, retryable, retryDelaySeconds });
}

export function analyzeStoreReview(rating: number, value: string) {
  const text = value.toLocaleLowerCase('en');
  const category = /refund|charge|charged|billing|subscription|payment|price/.test(text)
    ? 'billing'
    : /crash|bug|broken|error|freeze|stuck|fail/.test(text)
      ? 'bug'
      : /slow|lag|battery|performance|loading/.test(text)
        ? 'performance'
        : /feature|please add|would like|wish|request/.test(text)
          ? 'feature_request'
          : /login|account|password|sign in|support/.test(text)
            ? 'account_support'
            : 'general';
  return {
    sentiment: rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'mixed',
    category,
  };
}

export function storeReviewResponseLimit(provider: string) {
  return provider === 'google' ? 350 : 3500;
}

async function sha256Hex(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isoGoogleTimestamp(value: any): string | null {
  const seconds = Number(value?.seconds || 0);
  return seconds > 0 ? new Date(seconds * 1000 + Number(value?.nanos || 0) / 1_000_000).toISOString() : null;
}

export function parseReviewSyncCursor(value: string | null | undefined): ReviewSyncCursor {
  try {
    const parsed = JSON.parse(value || '') as Partial<ReviewSyncCursor>;
    return {
      version: 1,
      watermark: normalizedIso(parsed.watermark),
      full_synced_at: normalizedIso(parsed.full_synced_at),
    };
  } catch {
    return { version: 1, watermark: null, full_synced_at: null };
  }
}

function normalizedIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function latestIso(current: string | null, candidate: unknown): string | null {
  const normalized = normalizedIso(candidate);
  if (!normalized) return current;
  return !current || Date.parse(normalized) > Date.parse(current) ? normalized : current;
}

async function reviewProjectionMetadata(review: ReviewProjection) {
  const observedAt = normalizedIso(review.observedAt) || new Date().toISOString();
  const providerUpdatedAt = normalizedIso(review.providerUpdatedAt)
    || normalizedIso(review.providerCreatedAt)
    || '1970-01-01T00:00:00.000Z';
  const snapshotHash = await sha256Hex(JSON.stringify({
    rating: review.rating,
    title: review.title || '',
    body: review.body || '',
    author_name: review.authorName || '',
    language: review.language || '',
    territory: review.territory || '',
    app_version: review.appVersion || '',
    response_id: review.responseId || '',
    response_body: review.responseBody || '',
    response_state: review.responseState || '',
    response_updated_at: normalizedIso(review.responseUpdatedAt) || '',
  }));
  return {
    observedAt,
    projectionVersion: `${observedAt}|${providerUpdatedAt}|${snapshotHash}`,
  };
}

export async function storeReviewProjectionVersion(review: ReviewProjection) {
  return (await reviewProjectionMetadata(review)).projectionVersion;
}

function appleReviewPage(url: string, appId: string): string {
  const parsed = new URL(url);
  const expectedPath = `/v1/apps/${encodeURIComponent(appId)}/customerReviews`;
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.appstoreconnect.apple.com' || parsed.pathname !== expectedPath) {
    throw reviewError('store_reviews_pagination_invalid', 'Apple review pagination returned an invalid URL');
  }
  return parsed.toString();
}

export async function upsertReview(env: Env, projectId: string, review: ReviewProjection) {
  const proposedId = crypto.randomUUID();
  const analysis = analyzeStoreReview(review.rating, `${review.title || ''}\n${review.body || ''}`);
  const contentHash = await sha256Hex(JSON.stringify({ rating: review.rating, title: review.title || '', body: review.body || '' }));
  const projection = await reviewProjectionMetadata(review);
  await env.DB.prepare(`
    INSERT INTO store_reviews (
      id, project_id, provider, provider_review_id, rating, title, body, author_name,
      language, territory, app_version, provider_created_at, provider_updated_at,
      response_id, response_body, response_state, response_updated_at,
      original_body, translated_body, translation_language, sentiment, category, raw_payload,
      provider_observed_at, projection_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, provider, provider_review_id) DO UPDATE SET
      rating = excluded.rating, title = excluded.title, body = excluded.body,
      author_name = excluded.author_name, language = excluded.language,
      territory = excluded.territory, app_version = excluded.app_version,
      provider_created_at = COALESCE(excluded.provider_created_at, store_reviews.provider_created_at),
      provider_updated_at = excluded.provider_updated_at,
      response_id = excluded.response_id, response_body = excluded.response_body,
      response_state = excluded.response_state, response_updated_at = excluded.response_updated_at,
      original_body = excluded.original_body, translated_body = excluded.translated_body,
      translation_language = excluded.translation_language, sentiment = excluded.sentiment,
      category = excluded.category,
      raw_payload = excluded.raw_payload, provider_observed_at = excluded.provider_observed_at,
      projection_version = excluded.projection_version,
      last_seen_at = datetime('now'), updated_at = datetime('now')
    WHERE excluded.projection_version >= COALESCE(store_reviews.projection_version, '')
  `).bind(
    proposedId, projectId, review.provider, review.providerReviewId, review.rating,
    review.title || null, review.body || null, review.authorName || null,
    review.language || null, review.territory || null, review.appVersion || null,
    review.providerCreatedAt || null, review.providerUpdatedAt || null,
    review.responseId || null, review.responseBody || null, review.responseState || null,
    review.responseUpdatedAt || null, review.originalBody || review.body || null,
    review.translatedBody || null, review.translationLanguage || null,
    analysis.sentiment, analysis.category, JSON.stringify(review.rawPayload),
    projection.observedAt, projection.projectionVersion,
  ).run();
  const row = await env.DB.prepare(`
    SELECT id, projection_version FROM store_reviews
    WHERE project_id = ? AND provider = ? AND provider_review_id = ?
  `).bind(projectId, review.provider, review.providerReviewId)
    .first<{ id: string; projection_version?: string | null }>();
  if (!row) throw new Error('Unable to persist store review');
  const projectionAccepted = !row.projection_version || row.projection_version === projection.projectionVersion;
  const revisionId = crypto.randomUUID();
  const revision = await env.DB.prepare(`
    INSERT OR IGNORE INTO store_review_revisions (id, review_id, content_sha256, rating, title, body, provider_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(revisionId, row.id, contentHash, review.rating, review.title || null, review.body || null, review.providerUpdatedAt || null).run();
  if (projectionAccepted && review.rating <= 2 && Number(revision.meta.changes || 0) > 0
    && env.EVENT_QUEUE && env.GROWTH && env.GROWTH_INTERNAL_TOKEN) {
    await env.EVENT_QUEUE.send({
      type: 'growth.review-negative.evaluate', projectId: String(projectId), revisionId,
    });
  }
  if (projectionAccepted && review.responseBody) {
    await env.DB.prepare(`
      UPDATE inbox_automation_alerts
      SET status = 'closed', closed_at = COALESCE(closed_at, datetime('now')), updated_at = datetime('now')
      WHERE project_id = ? AND source_type = 'store_review' AND source_id = ? AND status = 'open'
    `).bind(String(projectId), row.id).run();
  }
}

async function fetchJson(url: string, token: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.headers || {}) },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after') || 0);
    throw reviewError(
      'store_reviews_provider_failed',
      `Store reviews API returned HTTP ${response.status}: ${payload.errors?.[0]?.detail || payload.error?.message || 'request failed'}`,
      response.status === 429 || response.status >= 500,
      retryAfter > 0 ? Math.min(3600, retryAfter) : undefined,
    );
  }
  return payload;
}

export async function syncAppleStoreReviews(
  env: Env,
  projectId: string,
  storedCursor?: string | null,
  now = new Date(),
) {
  const { token, appId } = await appStoreConnectAccess(env, projectId);
  const cursor = parseReviewSyncCursor(storedCursor);
  const fullSync = !cursor.watermark || !cursor.full_synced_at
    || now.getTime() - Date.parse(cursor.full_synced_at) >= APPLE_FULL_RECONCILIATION_INTERVAL_MS;
  let watermark = cursor.watermark;
  let next: string | null = appleReviewPage(
    `https://api.appstoreconnect.apple.com/v1/apps/${encodeURIComponent(appId)}/customerReviews?include=response&sort=-createdDate&limit=200`,
    appId,
  );
  let imported = 0;
  const seenPages = new Set<string>();
  while (next) {
    if (seenPages.size >= 100 || seenPages.has(next)) throw reviewError('store_reviews_pagination_invalid', 'Apple review pagination exceeded its safety limit');
    seenPages.add(next);
    const payload = await fetchJson(next, token);
    const observedAt = new Date().toISOString();
    const responses = new Map<string, Record<string, any>>();
    for (const item of Array.isArray(payload.included) ? payload.included : []) {
      if (item.type !== 'customerReviewResponses') continue;
      const reviewId = String(item.relationships?.review?.data?.id || '');
      if (reviewId) responses.set(reviewId, item);
    }
    let reachedWatermark = false;
    for (const item of Array.isArray(payload.data) ? payload.data : []) {
      const attributes = item.attributes || {};
      const response = responses.get(String(item.id));
      const createdAt = normalizedIso(attributes.createdDate);
      if (!fullSync && cursor.watermark && createdAt && Date.parse(createdAt) <= Date.parse(cursor.watermark)) {
        reachedWatermark = true;
      }
      await upsertReview(env, projectId, {
        provider: 'apple', providerReviewId: String(item.id), rating: Number(attributes.rating),
        title: attributes.title, body: attributes.body, authorName: attributes.reviewerNickname,
        territory: attributes.territory, providerCreatedAt: attributes.createdDate,
        providerUpdatedAt: latestIso(createdAt, response?.attributes?.lastModifiedDate), responseId: response?.id,
        responseBody: response?.attributes?.responseBody, responseState: response?.attributes?.state,
        responseUpdatedAt: response?.attributes?.lastModifiedDate, observedAt, rawPayload: { review: item, response },
      });
      watermark = latestIso(watermark, attributes.createdDate);
      imported += 1;
    }
    next = !fullSync && reachedWatermark
      ? null
      : typeof payload.links?.next === 'string' && payload.links.next
        ? appleReviewPage(payload.links.next, appId)
        : null;
  }
  return {
    provider: 'apple' as const,
    imported,
    cursor: JSON.stringify({
      version: 1,
      watermark,
      full_synced_at: fullSync ? now.toISOString() : cursor.full_synced_at,
    } satisfies ReviewSyncCursor),
    full_sync: fullSync,
  };
}

export async function syncGooglePlayReviews(env: Env, projectId: string, storedCursor?: string | null) {
  const { token, packageName } = await googlePlayAccess(env, projectId);
  const cursor = parseReviewSyncCursor(storedCursor);
  let watermark = cursor.watermark;
  let pageToken = '';
  let imported = 0;
  const seenPageTokens = new Set<string>();
  do {
    if (seenPageTokens.size >= 100 || seenPageTokens.has(pageToken)) throw reviewError('store_reviews_pagination_invalid', 'Google review pagination exceeded its safety limit');
    seenPageTokens.add(pageToken);
    const url = new URL(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/reviews`);
    url.searchParams.set('maxResults', '100');
    url.searchParams.set('translationLanguage', 'en');
    if (pageToken) url.searchParams.set('token', pageToken);
    const payload = await fetchJson(url.toString(), token);
    const observedAt = new Date().toISOString();
    for (const item of Array.isArray(payload.reviews) ? payload.reviews : []) {
      const user = [...(item.comments || [])].reverse().find((comment: any) => comment.userComment)?.userComment || {};
      const developer = [...(item.comments || [])].reverse().find((comment: any) => comment.developerComment)?.developerComment || {};
      await upsertReview(env, projectId, {
        provider: 'google', providerReviewId: String(item.reviewId), rating: Number(user.starRating),
        body: user.originalText || user.text, originalBody: user.originalText || user.text,
        translatedBody: user.originalText ? user.text : null,
        translationLanguage: user.originalText ? 'en' : null,
        authorName: item.authorName, language: user.reviewerLanguage,
        appVersion: user.appVersionName, providerCreatedAt: isoGoogleTimestamp(user.lastModified),
        providerUpdatedAt: latestIso(isoGoogleTimestamp(user.lastModified), isoGoogleTimestamp(developer.lastModified)), responseBody: developer.text,
        responseState: developer.text ? 'published' : null,
        responseUpdatedAt: isoGoogleTimestamp(developer.lastModified), observedAt, rawPayload: item,
      });
      watermark = latestIso(watermark, isoGoogleTimestamp(user.lastModified));
      imported += 1;
    }
    pageToken = String(payload.tokenPagination?.nextPageToken || '');
  } while (pageToken);
  return {
    provider: 'google' as const,
    imported,
    cursor: JSON.stringify({ version: 1, watermark, full_synced_at: null } satisfies ReviewSyncCursor),
  };
}

export async function syncStoreReviews(env: Env, projectId: string) {
  const syncState = await env.DB.prepare(`
    SELECT provider, cursor, watermark, full_synced_at
    FROM store_review_sync_state WHERE project_id = ?
  `).bind(projectId).all<{
    provider: 'apple' | 'google';
    cursor: string | null;
    watermark: string | null;
    full_synced_at: string | null;
  }>();
  const cursors = new Map((syncState.results || []).map((row) => {
    const legacy = parseReviewSyncCursor(row.cursor);
    return [row.provider, JSON.stringify({
      version: 1,
      watermark: latestIso(legacy.watermark, row.watermark),
      full_synced_at: latestIso(legacy.full_synced_at, row.full_synced_at),
    } satisfies ReviewSyncCursor)];
  }));
  const results = await Promise.allSettled([
    syncAppleStoreReviews(env, projectId, cursors.get('apple')),
    syncGooglePlayReviews(env, projectId, cursors.get('google')),
  ]);
  for (const [index, result] of results.entries()) {
    const provider = index === 0 ? 'apple' : 'google';
    const nextCursor = parseReviewSyncCursor(result.status === 'fulfilled'
      ? result.value.cursor
      : cursors.get(provider));
    const error = result.status === 'rejected' ? String(result.reason?.message || result.reason) : null;
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO store_review_sync_state (
          project_id, provider, cursor, watermark, full_synced_at, last_synced_at, last_error
        ) VALUES (?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN datetime('now') END, ?)
        ON CONFLICT(project_id, provider) DO UPDATE SET
          cursor = CASE WHEN excluded.last_error IS NULL THEN excluded.cursor ELSE store_review_sync_state.cursor END,
          watermark = CASE
            WHEN excluded.last_error IS NOT NULL THEN store_review_sync_state.watermark
            WHEN store_review_sync_state.watermark IS NULL THEN excluded.watermark
            WHEN excluded.watermark IS NULL THEN store_review_sync_state.watermark
            WHEN datetime(excluded.watermark) >= datetime(store_review_sync_state.watermark) THEN excluded.watermark
            ELSE store_review_sync_state.watermark END,
          full_synced_at = CASE
            WHEN excluded.last_error IS NOT NULL THEN store_review_sync_state.full_synced_at
            WHEN store_review_sync_state.full_synced_at IS NULL THEN excluded.full_synced_at
            WHEN excluded.full_synced_at IS NULL THEN store_review_sync_state.full_synced_at
            WHEN datetime(excluded.full_synced_at) >= datetime(store_review_sync_state.full_synced_at) THEN excluded.full_synced_at
            ELSE store_review_sync_state.full_synced_at END,
          last_synced_at = CASE WHEN excluded.last_error IS NULL THEN datetime('now') ELSE store_review_sync_state.last_synced_at END,
          last_error = excluded.last_error, updated_at = datetime('now')
      `).bind(
        projectId,
        provider,
        JSON.stringify(nextCursor),
        nextCursor.watermark,
        nextCursor.full_synced_at,
        error,
        error,
      ),
      env.DB.prepare(`
        UPDATE store_review_sync_state
        SET cursor = json_object(
          'version', 1,
          'watermark', watermark,
          'full_synced_at', full_synced_at
        )
        WHERE project_id = ? AND provider = ?
      `).bind(projectId, provider),
    ]);
  }
  return results.map((result, index) => result.status === 'fulfilled'
    ? { ok: true, ...result.value }
    : { ok: false, provider: index === 0 ? 'apple' : 'google', error: String(result.reason?.message || result.reason) });
}

export async function publishStoreReviewResponse(env: Env, projectId: string, review: Record<string, any>, body: string) {
  const limit = storeReviewResponseLimit(String(review.provider));
  if (!body || body.length > limit) {
    throw reviewError('store_review_response_invalid', `${review.provider === 'google' ? 'Google Play' : 'App Store'} responses must contain at most ${limit} characters`);
  }
  if (review.provider === 'apple') {
    const { token } = await appStoreConnectAccess(env, projectId);
    return fetchJson('https://api.appstoreconnect.apple.com/v1/customerReviewResponses', token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { type: 'customerReviewResponses', attributes: { responseBody: body }, relationships: { review: { data: { type: 'customerReviews', id: review.provider_review_id } } } } }),
    });
  }
  const { token, packageName } = await googlePlayAccess(env, projectId);
  return fetchJson(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/reviews/${encodeURIComponent(review.provider_review_id)}:reply`, token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replyText: body }),
  });
}

function publishedResponseProjection(provider: string, providerResponse: Record<string, any>, fallbackBody: string) {
  if (provider === 'google') {
    const result = providerResponse.result && typeof providerResponse.result === 'object'
      ? providerResponse.result as Record<string, any>
      : {};
    return {
      responseId: null,
      body: String(result.replyText || fallbackBody),
      state: 'published',
      updatedAt: isoGoogleTimestamp(result.lastEdited),
    };
  }
  const data = providerResponse.data && typeof providerResponse.data === 'object'
    ? providerResponse.data as Record<string, any>
    : {};
  const attributes = data.attributes && typeof data.attributes === 'object'
    ? data.attributes as Record<string, any>
    : {};
  return {
    responseId: typeof data.id === 'string' ? data.id : null,
    body: String(attributes.responseBody || fallbackBody),
    state: String(attributes.state || 'submitted').toLowerCase(),
    updatedAt: normalizedIso(attributes.lastModifiedDate),
  };
}

export async function publishApprovedReviewDraft(env: Env, draftId: string) {
  const draft = await env.DB.prepare(`
    SELECT d.*, r.project_id, r.provider, r.provider_review_id
    FROM store_review_response_drafts d JOIN store_reviews r ON r.id = d.review_id
    WHERE d.id = ? LIMIT 1
  `).bind(draftId).first<Record<string, any>>();
  if (!draft) throw reviewError('store_review_draft_not_found', 'Store review response draft not found');
  if (draft.status === 'published') return { duplicate: true };
  if (!['approved', 'publishing', 'failed'].includes(String(draft.status))) {
    throw reviewError('store_review_response_not_approved', 'Store review response requires administrator approval');
  }
  if (!draft.publish_requested_at) throw reviewError('store_review_publish_not_requested', 'Store review response publication was not requested');
  const claimToken = crypto.randomUUID();
  const claimed = await env.DB.prepare(`
    UPDATE store_review_response_drafts
    SET status = 'publishing', attempts = attempts + 1, claim_token = ?,
      claim_expires_at = datetime('now', '+10 minutes'), last_error = NULL, updated_at = datetime('now')
    WHERE id = ? AND attempts = ? AND status IN ('approved','publishing','failed')
      AND publish_requested_at IS NOT NULL
      AND (claim_token IS NULL OR claim_expires_at IS NULL OR datetime(claim_expires_at) <= datetime('now'))
  `).bind(claimToken, draftId, Number(draft.attempts || 0)).run();
  if (!claimed.meta.changes) return { published: false, claimed: false };
  try {
    const providerResponse = await publishStoreReviewResponse(env, String(draft.project_id), draft, String(draft.body));
    const serializedResponse = JSON.stringify(providerResponse);
    const response = publishedResponseProjection(String(draft.provider), providerResponse, String(draft.body));
    const completion = await env.DB.batch([
      env.DB.prepare(`
        UPDATE store_review_response_drafts
        SET status = 'published', provider_response = ?, published_at = datetime('now'),
          next_attempt_at = NULL, claim_token = ?, claim_expires_at = NULL,
          last_error = NULL, updated_at = datetime('now')
        WHERE id = ? AND claim_token = ?
      `).bind(serializedResponse, claimToken, draftId, claimToken),
      env.DB.prepare(`
        UPDATE store_reviews
        SET response_id = COALESCE(?, response_id), response_body = ?, response_state = ?,
          response_updated_at = COALESCE(?, datetime('now')), updated_at = datetime('now')
        WHERE id = ? AND EXISTS (
          SELECT 1 FROM store_review_response_drafts
          WHERE id = ? AND status = 'published' AND provider_response = ? AND claim_token = ?
        )
      `).bind(
        response.responseId,
        response.body,
        response.state,
        response.updatedAt,
        draft.review_id,
        draftId,
        serializedResponse,
        claimToken,
      ),
      env.DB.prepare(`
        UPDATE inbox_automation_alerts
        SET status = 'closed', closed_at = COALESCE(closed_at, datetime('now')), updated_at = datetime('now')
        WHERE project_id = ? AND source_type = 'store_review' AND source_id = ? AND status = 'open'
          AND EXISTS (
            SELECT 1 FROM store_review_response_drafts
            WHERE id = ? AND status = 'published' AND provider_response = ? AND claim_token = ?
          )
      `).bind(String(draft.project_id), draft.review_id, draftId, serializedResponse, claimToken),
      env.DB.prepare(`
        INSERT INTO store_review_audit_events (id, review_id, event_type, actor_type, payload)
        SELECT ?, ?, 'response.published', 'system', ?
        WHERE EXISTS (
          SELECT 1 FROM store_review_response_drafts
          WHERE id = ? AND status = 'published' AND provider_response = ? AND claim_token = ?
        )
      `).bind(
        crypto.randomUUID(),
        draft.review_id,
        JSON.stringify({ draft_id: draftId, provider: draft.provider, response_state: response.state }),
        draftId,
        serializedResponse,
        claimToken,
      ),
    ]);
    if (!Number((completion[0] as D1Result | undefined)?.meta?.changes || 0)) {
      await env.DB.prepare(`
        INSERT INTO store_review_audit_events (id, review_id, event_type, actor_type, payload)
        VALUES (?, ?, 'response.result_after_lease_loss', 'system', ?)
      `).bind(
        crypto.randomUUID(),
        draft.review_id,
        JSON.stringify({ draft_id: draftId, provider: draft.provider, provider_response: providerResponse }),
      ).run();
      return { published: false, claim_lost: true, provider: draft.provider };
    }
    return { published: true, provider: draft.provider, response_state: response.state };
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    const attempts = Number(draft.attempts || 0) + 1;
    const tagged = error as { retryable?: boolean; retryDelaySeconds?: number };
    const hasRetryability = Boolean(error && typeof error === 'object' && 'retryable' in error);
    const retryable = (hasRetryability ? tagged.retryable === true : true) && attempts < 8;
    const retryDelaySeconds = Math.max(30, Math.min(3600, Number(tagged.retryDelaySeconds || 30 * (2 ** Math.min(7, attempts)))));
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE store_review_response_drafts
        SET status = 'failed', last_error = ?, next_attempt_at = CASE WHEN ? THEN datetime('now', '+' || ? || ' seconds') ELSE NULL END,
          claim_token = NULL, claim_expires_at = NULL, updated_at = datetime('now')
        WHERE id = ? AND claim_token = ?
      `).bind(message.slice(0, 1000), retryable ? 1 : 0, retryDelaySeconds, draftId, claimToken),
      env.DB.prepare(`
        INSERT INTO store_review_audit_events (id, review_id, event_type, actor_type, payload)
        VALUES (?, ?, 'response.failed', 'system', ?)
      `).bind(crypto.randomUUID(), draft.review_id, JSON.stringify({ draft_id: draftId, retryable, error: message.slice(0, 1000) })),
    ]);
    const output = error instanceof Error ? error : new Error(message);
    throw Object.assign(output, { retryable, retryDelaySeconds });
  }
}

export async function enqueueStoreReviewResponseRetries(env: Env) {
  if (!env.EVENT_QUEUE) return 0;
  const rows = await env.DB.prepare(`
    SELECT id FROM store_review_response_drafts
    WHERE publish_requested_at IS NOT NULL AND attempts < 8
      AND (status = 'approved'
        OR (status = 'publishing' AND (claim_token IS NULL OR claim_expires_at IS NULL OR datetime(claim_expires_at) <= datetime('now')))
        OR (status = 'failed' AND next_attempt_at IS NOT NULL AND datetime(next_attempt_at) <= datetime('now')
          AND (claim_token IS NULL OR claim_expires_at IS NULL OR datetime(claim_expires_at) <= datetime('now'))))
    ORDER BY updated_at LIMIT 100
  `).all<{ id: string }>();
  for (const row of rows.results || []) {
    await env.EVENT_QUEUE.send({ type: 'reputation.review-response.publish', draftId: row.id });
  }
  return rows.results?.length || 0;
}
