import type { Env } from '../types';
import { appStoreConnectAccess, googlePlayAccess } from './store-verification';

type ReviewProjection = {
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
  rawPayload: unknown;
};

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

async function upsertReview(env: Env, projectId: string, review: ReviewProjection) {
  const proposedId = crypto.randomUUID();
  const analysis = analyzeStoreReview(review.rating, `${review.title || ''}\n${review.body || ''}`);
  await env.DB.prepare(`
    INSERT INTO store_reviews (
      id, project_id, provider, provider_review_id, rating, title, body, author_name,
      language, territory, app_version, provider_created_at, provider_updated_at,
      response_id, response_body, response_state, response_updated_at,
      original_body, translated_body, translation_language, sentiment, category, raw_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      raw_payload = excluded.raw_payload, last_seen_at = datetime('now'), updated_at = datetime('now')
  `).bind(
    proposedId, projectId, review.provider, review.providerReviewId, review.rating,
    review.title || null, review.body || null, review.authorName || null,
    review.language || null, review.territory || null, review.appVersion || null,
    review.providerCreatedAt || null, review.providerUpdatedAt || null,
    review.responseId || null, review.responseBody || null, review.responseState || null,
    review.responseUpdatedAt || null, review.originalBody || review.body || null,
    review.translatedBody || null, review.translationLanguage || null,
    analysis.sentiment, analysis.category, JSON.stringify(review.rawPayload),
  ).run();
  const row = await env.DB.prepare(`SELECT id FROM store_reviews WHERE project_id = ? AND provider = ? AND provider_review_id = ?`)
    .bind(projectId, review.provider, review.providerReviewId).first<{ id: string }>();
  if (!row) throw new Error('Unable to persist store review');
  const hash = await sha256Hex(JSON.stringify({ rating: review.rating, title: review.title || '', body: review.body || '' }));
  await env.DB.prepare(`
    INSERT OR IGNORE INTO store_review_revisions (id, review_id, content_sha256, rating, title, body, provider_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), row.id, hash, review.rating, review.title || null, review.body || null, review.providerUpdatedAt || null).run();
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

export async function syncAppleStoreReviews(env: Env, projectId: string) {
  const { token, appId } = await appStoreConnectAccess(env, projectId);
  let next: string | null = `https://api.appstoreconnect.apple.com/v1/apps/${encodeURIComponent(appId)}/customerReviews?include=response&sort=-createdDate&limit=200`;
  let imported = 0;
  const seenPages = new Set<string>();
  while (next) {
    if (seenPages.size >= 100 || seenPages.has(next)) throw reviewError('store_reviews_pagination_invalid', 'Apple review pagination exceeded its safety limit');
    seenPages.add(next);
    const payload = await fetchJson(next, token);
    const responses = new Map<string, Record<string, any>>();
    for (const item of Array.isArray(payload.included) ? payload.included : []) {
      if (item.type !== 'customerReviewResponses') continue;
      const reviewId = String(item.relationships?.review?.data?.id || '');
      if (reviewId) responses.set(reviewId, item);
    }
    for (const item of Array.isArray(payload.data) ? payload.data : []) {
      const attributes = item.attributes || {};
      const response = responses.get(String(item.id));
      await upsertReview(env, projectId, {
        provider: 'apple', providerReviewId: String(item.id), rating: Number(attributes.rating),
        title: attributes.title, body: attributes.body, authorName: attributes.reviewerNickname,
        territory: attributes.territory, providerCreatedAt: attributes.createdDate,
        providerUpdatedAt: attributes.createdDate, responseId: response?.id,
        responseBody: response?.attributes?.responseBody, responseState: response?.attributes?.state,
        responseUpdatedAt: response?.attributes?.lastModifiedDate, rawPayload: { review: item, response },
      });
      imported += 1;
    }
    next = typeof payload.links?.next === 'string' && payload.links.next ? payload.links.next : null;
  }
  return { provider: 'apple' as const, imported };
}

export async function syncGooglePlayReviews(env: Env, projectId: string) {
  const { token, packageName } = await googlePlayAccess(env, projectId);
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
        providerUpdatedAt: isoGoogleTimestamp(user.lastModified), responseBody: developer.text,
        responseState: developer.text ? 'published' : null,
        responseUpdatedAt: isoGoogleTimestamp(developer.lastModified), rawPayload: item,
      });
      imported += 1;
    }
    pageToken = String(payload.tokenPagination?.nextPageToken || '');
  } while (pageToken);
  return { provider: 'google' as const, imported };
}

export async function syncStoreReviews(env: Env, projectId: string) {
  const results = await Promise.allSettled([
    syncAppleStoreReviews(env, projectId),
    syncGooglePlayReviews(env, projectId),
  ]);
  for (const [index, result] of results.entries()) {
    const provider = index === 0 ? 'apple' : 'google';
    await env.DB.prepare(`
      INSERT INTO store_review_sync_state (project_id, provider, last_synced_at, last_error)
      VALUES (?, ?, CASE WHEN ? IS NULL THEN datetime('now') END, ?)
      ON CONFLICT(project_id, provider) DO UPDATE SET
        last_synced_at = CASE WHEN excluded.last_error IS NULL THEN datetime('now') ELSE store_review_sync_state.last_synced_at END,
        last_error = excluded.last_error, updated_at = datetime('now')
    `).bind(projectId, provider, result.status === 'fulfilled' ? null : 'failed', result.status === 'rejected' ? String(result.reason?.message || result.reason) : null).run();
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
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE store_review_response_drafts
        SET status = 'published', provider_response = ?, published_at = datetime('now'),
          next_attempt_at = NULL, claim_token = NULL, claim_expires_at = NULL,
          last_error = NULL, updated_at = datetime('now')
        WHERE id = ? AND claim_token = ?
      `).bind(JSON.stringify(providerResponse), draftId, claimToken),
      env.DB.prepare(`UPDATE store_reviews SET response_body = ?, response_state = 'published', response_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .bind(String(draft.body), draft.review_id),
      env.DB.prepare(`INSERT INTO store_review_audit_events (id, review_id, event_type, actor_type, payload) VALUES (?, ?, 'response.published', 'system', ?)`)
        .bind(crypto.randomUUID(), draft.review_id, JSON.stringify({ draft_id: draftId, provider: draft.provider })),
    ]);
    return { published: true, provider: draft.provider };
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
