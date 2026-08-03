import type { Env } from '../types';
import { appStoreConnectAccess, googlePlayAccess } from './store-verification';

type ReviewProjection = {
  provider: 'apple' | 'google';
  providerReviewId: string;
  rating: number;
  title?: string | null;
  body?: string | null;
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
  await env.DB.prepare(`
    INSERT INTO store_reviews (
      id, project_id, provider, provider_review_id, rating, title, body, author_name,
      language, territory, app_version, provider_created_at, provider_updated_at,
      response_id, response_body, response_state, response_updated_at, raw_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, provider, provider_review_id) DO UPDATE SET
      rating = excluded.rating, title = excluded.title, body = excluded.body,
      author_name = excluded.author_name, language = excluded.language,
      territory = excluded.territory, app_version = excluded.app_version,
      provider_created_at = COALESCE(excluded.provider_created_at, store_reviews.provider_created_at),
      provider_updated_at = excluded.provider_updated_at,
      response_id = excluded.response_id, response_body = excluded.response_body,
      response_state = excluded.response_state, response_updated_at = excluded.response_updated_at,
      raw_payload = excluded.raw_payload, last_seen_at = datetime('now'), updated_at = datetime('now')
  `).bind(
    proposedId, projectId, review.provider, review.providerReviewId, review.rating,
    review.title || null, review.body || null, review.authorName || null,
    review.language || null, review.territory || null, review.appVersion || null,
    review.providerCreatedAt || null, review.providerUpdatedAt || null,
    review.responseId || null, review.responseBody || null, review.responseState || null,
    review.responseUpdatedAt || null, JSON.stringify(review.rawPayload),
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
  if (!response.ok) throw new Error(`Store reviews API returned HTTP ${response.status}: ${payload.errors?.[0]?.detail || payload.error?.message || 'request failed'}`);
  return payload;
}

export async function syncAppleStoreReviews(env: Env, projectId: string) {
  const { token, appId } = await appStoreConnectAccess(env, projectId);
  let next: string | null = `https://api.appstoreconnect.apple.com/v1/apps/${encodeURIComponent(appId)}/customerReviews?include=response&sort=-createdDate&limit=200`;
  let imported = 0;
  while (next) {
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
  do {
    const url = new URL(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/reviews`);
    url.searchParams.set('maxResults', '100');
    if (pageToken) url.searchParams.set('token', pageToken);
    const payload = await fetchJson(url.toString(), token);
    for (const item of Array.isArray(payload.reviews) ? payload.reviews : []) {
      const user = [...(item.comments || [])].reverse().find((comment: any) => comment.userComment)?.userComment || {};
      const developer = [...(item.comments || [])].reverse().find((comment: any) => comment.developerComment)?.developerComment || {};
      await upsertReview(env, projectId, {
        provider: 'google', providerReviewId: String(item.reviewId), rating: Number(user.starRating),
        body: user.text, authorName: item.authorName, language: user.reviewerLanguage,
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
  if (!draft) throw new Error('Store review response draft not found');
  if (draft.status === 'published') return { duplicate: true };
  if (!['approved', 'publishing', 'failed'].includes(String(draft.status))) throw new Error('Store review response requires administrator approval');
  await env.DB.prepare(`UPDATE store_review_response_drafts SET status = 'publishing', last_error = NULL, updated_at = datetime('now') WHERE id = ?`).bind(draftId).run();
  try {
    const providerResponse = await publishStoreReviewResponse(env, String(draft.project_id), draft, String(draft.body));
    await env.DB.batch([
      env.DB.prepare(`UPDATE store_review_response_drafts SET status = 'published', provider_response = ?, published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .bind(JSON.stringify(providerResponse), draftId),
      env.DB.prepare(`UPDATE store_reviews SET response_body = ?, response_state = 'published', response_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .bind(String(draft.body), draft.review_id),
      env.DB.prepare(`INSERT INTO store_review_audit_events (id, review_id, event_type, actor_type, payload) VALUES (?, ?, 'response.published', 'system', ?)`)
        .bind(crypto.randomUUID(), draft.review_id, JSON.stringify({ draft_id: draftId, provider: draft.provider })),
    ]);
    return { published: true, provider: draft.provider };
  } catch (error) {
    await env.DB.prepare(`UPDATE store_review_response_drafts SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind((error as Error)?.message || String(error), draftId).run();
    throw error;
  }
}
