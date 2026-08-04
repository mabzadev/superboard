import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { AppVariables, Env } from '../types';
import { getOrCreateProject, parseProjectExternalId } from '../lib/db';
import { errorEnvelope, purchasesError } from '../lib/purchases-v2';
import { storeReviewContentHash, storeReviewResponseLimit } from '../lib/store-reviews';

const reviews = new Hono<{ Bindings: Env; Variables: AppVariables }>();
reviews.use('*', authMiddleware);

async function projectFor(c: any) {
  const parsed = parseProjectExternalId(c.req.param('projectId'));
  const access = (await c.env.DB.prepare('SELECT role FROM instance_roles WHERE user_id = ? AND instance_id = ? LIMIT 1')
    .bind(c.get('userId'), parsed.instanceId)
    .first()) as { role: string } | null;
  if (!access) throw purchasesError('project_not_found', 'Project not found', 404);
  const project = await getOrCreateProject(c.env.DB, parsed.instanceId, parsed.kind);
  return { ...project, id: String(project.id), role: access.role };
}

function requireAdmin(project: { role: string }) {
  if (!['owner', 'admin'].includes(project.role)) throw purchasesError('insufficient_role', 'Owner or admin access is required', 403);
}

function fail(c: any, error: unknown) {
  return c.json(errorEnvelope(error, c.req.header('cf-ray') || crypto.randomUUID()), (error as any)?.status || 422);
}

type ReviewListCursor = { orderedAt: string; id: string };

export function parseReviewListCursor(value: unknown): ReviewListCursor | null {
  if (!value) return null;
  try {
    const decoded = atob(String(value));
    const separator = decoded.lastIndexOf('|');
    const orderedAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (separator < 1 || orderedAt.length > 64 || !id || id.length > 255 || !Number.isFinite(Date.parse(orderedAt))) throw new Error('invalid');
    return { orderedAt, id };
  } catch {
    throw purchasesError('invalid_cursor', 'Review cursor is invalid', 422);
  }
}

export function nextReviewListCursor(rows: Array<Record<string, any>>, hasMore: boolean) {
  if (!hasMore || !rows.length) return null;
  const row = rows[rows.length - 1];
  return btoa(`${row.ordered_at}|${row.id}`);
}

function parseReviewLimit(value: unknown) {
  const parsed = Number(value || 50);
  if (!Number.isInteger(parsed) || parsed < 1) throw purchasesError('invalid_limit', 'Review page size must be a positive integer', 422);
  return Math.min(100, parsed);
}

function selectedFilter(value: unknown, allowed: string[], code: string, label: string) {
  const selected = String(value || '')
    .trim()
    .toLowerCase();
  if (selected && !allowed.includes(selected)) throw purchasesError(code, `${label} filter is invalid`, 422);
  return selected;
}

function auditPayload(value: unknown) {
  try {
    return JSON.parse(String(value || '{}'));
  } catch {
    return {};
  }
}

reviews.get('/:projectId/reviews', async (c) => {
  try {
    const project = await projectFor(c);
    const provider = selectedFilter(c.req.query('provider'), ['apple', 'google'], 'invalid_provider', 'Provider');
    const sentiment = selectedFilter(c.req.query('sentiment'), ['positive', 'mixed', 'negative'], 'invalid_sentiment', 'Sentiment');
    const category = selectedFilter(
      c.req.query('category'),
      ['billing', 'bug', 'performance', 'feature_request', 'account_support', 'general'],
      'invalid_category',
      'Category',
    );
    const ratingValue = String(c.req.query('rating') || '');
    const rating = ratingValue ? Number(ratingValue) : 0;
    if (ratingValue && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      throw purchasesError('invalid_rating', 'Rating filter must be an integer from 1 to 5', 422);
    }
    const search = String(c.req.query('search') || '').trim();
    if (search.length > 100) throw purchasesError('invalid_search', 'Review search must contain at most 100 characters', 422);
    const unanswered = c.req.query('unanswered') === 'true' ? 1 : 0;
    const limit = parseReviewLimit(c.req.query('limit'));
    const cursor = parseReviewListCursor(c.req.query('cursor'));
    const rows = await c.env.DB.prepare(
      `
      SELECT r.*, COALESCE(r.provider_created_at, r.created_at) AS ordered_at,
        (SELECT COUNT(*) FROM store_review_revisions rr WHERE rr.review_id = r.id) AS revision_count,
        (SELECT id FROM store_review_response_drafts d WHERE d.review_id = r.id ORDER BY d.created_at DESC LIMIT 1) AS latest_draft_id,
        (SELECT body FROM store_review_response_drafts d WHERE d.review_id = r.id ORDER BY d.created_at DESC LIMIT 1) AS latest_draft_body,
        (SELECT status FROM store_review_response_drafts d WHERE d.review_id = r.id ORDER BY d.created_at DESC LIMIT 1) AS latest_draft_status
      FROM store_reviews r
      WHERE r.project_id = ? AND (? = '' OR r.provider = ?)
        AND (? = 0 OR r.response_body IS NULL)
        AND (? = '' OR r.sentiment = ?)
        AND (? = '' OR r.category = ?)
        AND (? = 0 OR r.rating = ?)
        AND (? = '' OR instr(lower(COALESCE(r.title, '') || ' ' || COALESCE(r.body, '') || ' ' || COALESCE(r.author_name, '')), lower(?)) > 0)
        AND (? IS NULL OR COALESCE(r.provider_created_at, r.created_at) < ?
          OR (COALESCE(r.provider_created_at, r.created_at) = ? AND r.id < ?))
      ORDER BY COALESCE(r.provider_created_at, r.created_at) DESC, r.id DESC LIMIT ?
    `,
    )
      .bind(
        project.id,
        provider,
        provider,
        unanswered,
        sentiment,
        sentiment,
        category,
        category,
        rating,
        rating,
        search,
        search,
        cursor?.orderedAt || null,
        cursor?.orderedAt || null,
        cursor?.orderedAt || null,
        cursor?.id || null,
        limit + 1,
      )
      .all<Record<string, any>>();
    const sync = await c.env.DB.prepare('SELECT * FROM store_review_sync_state WHERE project_id = ? ORDER BY provider').bind(project.id).all();
    const allRows = rows.results || [];
    const hasMore = allRows.length > limit;
    const page = allRows.slice(0, limit);
    const data = page.map((row: Record<string, any>) => ({
      ...row,
      response_character_limit: storeReviewResponseLimit(String(row.provider)),
    }));
    return c.json({
      data,
      sync: sync.results,
      next_cursor: nextReviewListCursor(page, hasMore),
    });
  } catch (error) {
    return fail(c, error);
  }
});

reviews.get('/:projectId/reviews/:reviewId/history', async (c) => {
  try {
    const project = await projectFor(c);
    const review = await c.env.DB.prepare(
      `
      SELECT r.*,
        (SELECT COUNT(*) FROM store_review_revisions rr WHERE rr.review_id = r.id) AS revision_count,
        (SELECT id FROM store_review_response_drafts d WHERE d.review_id = r.id ORDER BY d.created_at DESC LIMIT 1) AS latest_draft_id,
        (SELECT body FROM store_review_response_drafts d WHERE d.review_id = r.id ORDER BY d.created_at DESC LIMIT 1) AS latest_draft_body,
        (SELECT status FROM store_review_response_drafts d WHERE d.review_id = r.id ORDER BY d.created_at DESC LIMIT 1) AS latest_draft_status
      FROM store_reviews r WHERE r.id = ? AND r.project_id = ? LIMIT 1
    `,
    )
      .bind(c.req.param('reviewId'), project.id)
      .first<Record<string, any>>();
    if (!review) throw purchasesError('review_not_found', 'Store review not found', 404);
    const [revisions, drafts, audit] = await Promise.all([
      c.env.DB.prepare(
        `
        SELECT id, rating, title, body, provider_updated_at, captured_at
        FROM store_review_revisions WHERE review_id = ? ORDER BY captured_at DESC, id DESC LIMIT 250
      `,
      )
        .bind(review.id)
        .all<Record<string, any>>(),
      c.env.DB.prepare(
        `
        SELECT id, body, status, created_by, approved_by, approved_at, published_at,
          last_error, attempts, publish_requested_at, created_at, updated_at
        FROM store_review_response_drafts WHERE review_id = ? ORDER BY created_at DESC, id DESC LIMIT 250
      `,
      )
        .bind(review.id)
        .all<Record<string, any>>(),
      c.env.DB.prepare(
        `
        SELECT id, event_type, actor_type, actor_id, payload, occurred_at
        FROM store_review_audit_events WHERE review_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 250
      `,
      )
        .bind(review.id)
        .all<Record<string, any>>(),
    ]);
    return c.json({
      review: {
        ...review,
        response_character_limit: storeReviewResponseLimit(String(review.provider)),
      },
      revisions: revisions.results || [],
      drafts: drafts.results || [],
      audit: (audit.results || []).map((event) => ({
        ...event,
        payload: auditPayload(event.payload),
      })),
    });
  } catch (error) {
    return fail(c, error);
  }
});

reviews.patch('/:projectId/reviews/:reviewId/translation', async (c) => {
  try {
    const project = await projectFor(c);
    requireAdmin(project);
    const body = await c.req.json().catch(() => ({}));
    const translatedBody = typeof body.translated_body === 'string' ? body.translated_body.trim() : '';
    const language = typeof body.translation_language === 'string' ? body.translation_language.trim().toLowerCase() : '';
    if (!translatedBody || translatedBody.length > 10_000) {
      throw purchasesError('invalid_translation', 'Translated review text is required and must contain at most 10,000 characters', 422);
    }
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(language)) {
      throw purchasesError('invalid_translation_language', 'Translation language must be a valid language tag', 422);
    }
    const review = await c.env.DB.prepare(
      `
      SELECT rating, title, body FROM store_reviews WHERE id = ? AND project_id = ? LIMIT 1
    `,
    )
      .bind(c.req.param('reviewId'), project.id)
      .first<{
        rating: number;
        title?: string | null;
        body?: string | null;
      }>();
    if (!review) throw purchasesError('review_not_found', 'Store review not found', 404);
    const sourceHash = await storeReviewContentHash(review);
    const result = await c.env.DB.prepare(
      `
      UPDATE store_reviews
      SET translated_body = ?, translation_language = ?, translation_source = 'operator',
        translation_source_sha256 = ?, updated_at = datetime('now')
      WHERE id = ? AND project_id = ?
    `,
    )
      .bind(translatedBody, language, sourceHash, c.req.param('reviewId'), project.id)
      .run();
    if (!result.meta.changes) throw purchasesError('review_not_found', 'Store review not found', 404);
    await c.env.DB.prepare(
      `
      INSERT INTO store_review_audit_events (id, review_id, event_type, actor_type, actor_id, payload)
      VALUES (?, ?, 'translation.updated', 'admin', ?, ?)
    `,
    )
      .bind(crypto.randomUUID(), c.req.param('reviewId'), String(c.get('userId')), JSON.stringify({ translation_language: language }))
      .run();
    return c.json({
      translated_body: translatedBody,
      translation_language: language,
    });
  } catch (error) {
    return fail(c, error);
  }
});

reviews.post('/:projectId/sync', async (c) => {
  try {
    const project = await projectFor(c);
    requireAdmin(project);
    if (!c.env.EVENT_QUEUE) throw purchasesError('queue_unavailable', 'Review synchronization queue is unavailable', 503);
    await c.env.EVENT_QUEUE.send({
      type: 'reputation.reviews.sync',
      projectId: project.id,
    });
    return c.json({ queued: true }, 202);
  } catch (error) {
    return fail(c, error);
  }
});

reviews.post('/:projectId/reviews/:reviewId/drafts', async (c) => {
  try {
    const project = await projectFor(c);
    requireAdmin(project);
    const body = await c.req.json().catch(() => ({}));
    const responseBody = String(body.body || '').trim();
    const review = await c.env.DB.prepare('SELECT id, provider FROM store_reviews WHERE id = ? AND project_id = ?')
      .bind(c.req.param('reviewId'), project.id)
      .first<{ id: string; provider: 'apple' | 'google' }>();
    if (!review) throw purchasesError('review_not_found', 'Store review not found', 404);
    const responseLimit = storeReviewResponseLimit(review.provider);
    if (!responseBody || responseBody.length > responseLimit) {
      throw purchasesError('invalid_response_body', `Response body is required and must be at most ${responseLimit} characters`);
    }
    const id = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO store_review_response_drafts (id, review_id, body, created_by) VALUES (?, ?, ?, ?)`).bind(
        id,
        review.id,
        responseBody,
        String(c.get('userId')),
      ),
      c.env.DB.prepare(
        `INSERT INTO store_review_audit_events (id, review_id, event_type, actor_type, actor_id, payload) VALUES (?, ?, 'response.drafted', 'admin', ?, ?)`,
      ).bind(crypto.randomUUID(), review.id, String(c.get('userId')), JSON.stringify({ draft_id: id })),
    ]);
    return c.json({ id, status: 'draft' }, 201);
  } catch (error) {
    return fail(c, error);
  }
});

reviews.patch('/:projectId/reviews/:reviewId/drafts/:draftId', async (c) => {
  try {
    const project = await projectFor(c);
    requireAdmin(project);
    const body = await c.req.json().catch(() => ({}));
    const responseBody = String(body.body || '').trim();
    const draft = await c.env.DB.prepare(
      `
      SELECT d.id, r.provider
      FROM store_review_response_drafts d JOIN store_reviews r ON r.id = d.review_id
      WHERE d.id = ? AND r.id = ? AND r.project_id = ? AND d.status IN ('draft','failed')
    `,
    )
      .bind(c.req.param('draftId'), c.req.param('reviewId'), project.id)
      .first<{ id: string; provider: 'apple' | 'google' }>();
    if (!draft) throw purchasesError('draft_not_editable', 'Response draft was not found or cannot be edited', 409);
    const responseLimit = storeReviewResponseLimit(draft.provider);
    if (!responseBody || responseBody.length > responseLimit) {
      throw purchasesError('invalid_response_body', `Response body is required and must be at most ${responseLimit} characters`);
    }
    await c.env.DB.batch([
      c.env.DB.prepare(
        `
        UPDATE store_review_response_drafts
        SET body = ?, status = 'draft', approved_by = NULL, approved_at = NULL,
          attempts = 0, next_attempt_at = NULL, claim_token = NULL, claim_expires_at = NULL,
          publish_requested_at = NULL, provider_response = NULL, last_error = NULL,
          updated_at = datetime('now')
        WHERE id = ?
      `,
      ).bind(responseBody, draft.id),
      c.env.DB.prepare(
        `
        INSERT INTO store_review_audit_events (id, review_id, event_type, actor_type, actor_id, payload)
        VALUES (?, ?, 'response.updated', 'admin', ?, ?)
      `,
      ).bind(crypto.randomUUID(), c.req.param('reviewId'), String(c.get('userId')), JSON.stringify({ draft_id: draft.id })),
    ]);
    return c.json({ id: draft.id, status: 'draft' });
  } catch (error) {
    return fail(c, error);
  }
});

reviews.post('/:projectId/reviews/:reviewId/drafts/:draftId/approve', async (c) => {
  try {
    const project = await projectFor(c);
    requireAdmin(project);
    const result = await c.env.DB.prepare(
      `
      UPDATE store_review_response_drafts SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND review_id IN (SELECT id FROM store_reviews WHERE id = ? AND project_id = ?) AND status = 'draft'
    `,
    )
      .bind(String(c.get('userId')), c.req.param('draftId'), c.req.param('reviewId'), project.id)
      .run();
    if (!result.meta.changes) throw purchasesError('draft_not_approvable', 'Response draft was not found or is no longer approvable', 409);
    await c.env.DB.prepare(
      `INSERT INTO store_review_audit_events (id, review_id, event_type, actor_type, actor_id, payload) VALUES (?, ?, 'response.approved', 'admin', ?, ?)`,
    )
      .bind(crypto.randomUUID(), c.req.param('reviewId'), String(c.get('userId')), JSON.stringify({ draft_id: c.req.param('draftId') }))
      .run();
    return c.json({ status: 'approved' });
  } catch (error) {
    return fail(c, error);
  }
});

reviews.post('/:projectId/reviews/:reviewId/drafts/:draftId/publish', async (c) => {
  try {
    const project = await projectFor(c);
    requireAdmin(project);
    const draft = await c.env.DB.prepare(
      `
      SELECT d.id FROM store_review_response_drafts d JOIN store_reviews r ON r.id = d.review_id
      WHERE d.id = ? AND r.id = ? AND r.project_id = ? AND d.status IN ('approved','failed')
    `,
    )
      .bind(c.req.param('draftId'), c.req.param('reviewId'), project.id)
      .first<{ id: string }>();
    if (!draft) throw purchasesError('draft_not_publishable', 'Only an approved response can be published', 409);
    if (!c.env.EVENT_QUEUE) throw purchasesError('queue_unavailable', 'Review response queue is unavailable', 503);
    await c.env.DB.prepare(
      `
      UPDATE store_review_response_drafts
      SET publish_requested_at = COALESCE(publish_requested_at, datetime('now')), updated_at = datetime('now')
      WHERE id = ? AND status IN ('approved','failed')
    `,
    )
      .bind(draft.id)
      .run();
    try {
      await c.env.EVENT_QUEUE.send({
        type: 'reputation.review-response.publish',
        draftId: draft.id,
      });
      return c.json({ queued: true, retry_scheduled: false }, 202);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'store_review_response_queue_failed',
          draft_id: draft.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return c.json({ queued: false, retry_scheduled: true }, 202);
    }
  } catch (error) {
    return fail(c, error);
  }
});

export default reviews;
