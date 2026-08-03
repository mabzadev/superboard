import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { AppVariables, Env } from '../types';
import { getOrCreateProject, parseProjectExternalId } from '../lib/db';
import { errorEnvelope, purchasesError } from '../lib/purchases-v2';
import { storeReviewResponseLimit } from '../lib/store-reviews';

const reviews = new Hono<{ Bindings: Env; Variables: AppVariables }>();
reviews.use('*', authMiddleware);

async function projectFor(c: any) {
  const parsed = parseProjectExternalId(c.req.param('projectId'));
  const access = await c.env.DB.prepare('SELECT role FROM instance_roles WHERE user_id = ? AND instance_id = ? LIMIT 1')
    .bind(c.get('userId'), parsed.instanceId).first() as { role: string } | null;
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

reviews.get('/:projectId/reviews', async (c) => {
  try {
    const project = await projectFor(c);
    const provider = String(c.req.query('provider') || '');
    const unanswered = c.req.query('unanswered') === 'true' ? 1 : 0;
    const rows = await c.env.DB.prepare(`
      SELECT r.*,
        (SELECT COUNT(*) FROM store_review_revisions rr WHERE rr.review_id = r.id) AS revision_count,
        (SELECT id FROM store_review_response_drafts d WHERE d.review_id = r.id ORDER BY d.created_at DESC LIMIT 1) AS latest_draft_id,
        (SELECT body FROM store_review_response_drafts d WHERE d.review_id = r.id ORDER BY d.created_at DESC LIMIT 1) AS latest_draft_body,
        (SELECT status FROM store_review_response_drafts d WHERE d.review_id = r.id ORDER BY d.created_at DESC LIMIT 1) AS latest_draft_status
      FROM store_reviews r
      WHERE r.project_id = ? AND (? = '' OR r.provider = ?)
        AND (? = 0 OR r.response_body IS NULL)
      ORDER BY r.provider_created_at DESC, r.updated_at DESC LIMIT 250
    `).bind(project.id, provider, provider, unanswered).all();
    const sync = await c.env.DB.prepare('SELECT * FROM store_review_sync_state WHERE project_id = ? ORDER BY provider').bind(project.id).all();
    const data = (rows.results || []).map((row: Record<string, any>) => ({
      ...row,
      response_character_limit: storeReviewResponseLimit(String(row.provider)),
    }));
    return c.json({ data, sync: sync.results });
  } catch (error) { return fail(c, error); }
});

reviews.post('/:projectId/sync', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    if (!c.env.EVENT_QUEUE) throw purchasesError('queue_unavailable', 'Review synchronization queue is unavailable', 503);
    await c.env.EVENT_QUEUE.send({ type: 'reputation.reviews.sync', projectId: project.id });
    return c.json({ queued: true }, 202);
  } catch (error) { return fail(c, error); }
});

reviews.post('/:projectId/reviews/:reviewId/drafts', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const body = await c.req.json().catch(() => ({}));
    const responseBody = String(body.body || '').trim();
    const review = await c.env.DB.prepare('SELECT id, provider FROM store_reviews WHERE id = ? AND project_id = ?')
      .bind(c.req.param('reviewId'), project.id).first<{ id: string; provider: 'apple' | 'google' }>();
    if (!review) throw purchasesError('review_not_found', 'Store review not found', 404);
    const responseLimit = storeReviewResponseLimit(review.provider);
    if (!responseBody || responseBody.length > responseLimit) {
      throw purchasesError('invalid_response_body', `Response body is required and must be at most ${responseLimit} characters`);
    }
    const id = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO store_review_response_drafts (id, review_id, body, created_by) VALUES (?, ?, ?, ?)`)
        .bind(id, review.id, responseBody, String(c.get('userId'))),
      c.env.DB.prepare(`INSERT INTO store_review_audit_events (id, review_id, event_type, actor_type, actor_id, payload) VALUES (?, ?, 'response.drafted', 'admin', ?, ?)`)
        .bind(crypto.randomUUID(), review.id, String(c.get('userId')), JSON.stringify({ draft_id: id })),
    ]);
    return c.json({ id, status: 'draft' }, 201);
  } catch (error) { return fail(c, error); }
});

reviews.patch('/:projectId/reviews/:reviewId/drafts/:draftId', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const body = await c.req.json().catch(() => ({}));
    const responseBody = String(body.body || '').trim();
    const draft = await c.env.DB.prepare(`
      SELECT d.id, r.provider
      FROM store_review_response_drafts d JOIN store_reviews r ON r.id = d.review_id
      WHERE d.id = ? AND r.id = ? AND r.project_id = ? AND d.status IN ('draft','failed')
    `).bind(c.req.param('draftId'), c.req.param('reviewId'), project.id)
      .first<{ id: string; provider: 'apple' | 'google' }>();
    if (!draft) throw purchasesError('draft_not_editable', 'Response draft was not found or cannot be edited', 409);
    const responseLimit = storeReviewResponseLimit(draft.provider);
    if (!responseBody || responseBody.length > responseLimit) {
      throw purchasesError('invalid_response_body', `Response body is required and must be at most ${responseLimit} characters`);
    }
    await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE store_review_response_drafts
        SET body = ?, status = 'draft', approved_by = NULL, approved_at = NULL,
          attempts = 0, next_attempt_at = NULL, claim_token = NULL, claim_expires_at = NULL,
          publish_requested_at = NULL, provider_response = NULL, last_error = NULL,
          updated_at = datetime('now')
        WHERE id = ?
      `).bind(responseBody, draft.id),
      c.env.DB.prepare(`
        INSERT INTO store_review_audit_events (id, review_id, event_type, actor_type, actor_id, payload)
        VALUES (?, ?, 'response.updated', 'admin', ?, ?)
      `).bind(crypto.randomUUID(), c.req.param('reviewId'), String(c.get('userId')), JSON.stringify({ draft_id: draft.id })),
    ]);
    return c.json({ id: draft.id, status: 'draft' });
  } catch (error) { return fail(c, error); }
});

reviews.post('/:projectId/reviews/:reviewId/drafts/:draftId/approve', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const result = await c.env.DB.prepare(`
      UPDATE store_review_response_drafts SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND review_id IN (SELECT id FROM store_reviews WHERE id = ? AND project_id = ?) AND status = 'draft'
    `).bind(String(c.get('userId')), c.req.param('draftId'), c.req.param('reviewId'), project.id).run();
    if (!result.meta.changes) throw purchasesError('draft_not_approvable', 'Response draft was not found or is no longer approvable', 409);
    await c.env.DB.prepare(`INSERT INTO store_review_audit_events (id, review_id, event_type, actor_type, actor_id, payload) VALUES (?, ?, 'response.approved', 'admin', ?, ?)`)
      .bind(crypto.randomUUID(), c.req.param('reviewId'), String(c.get('userId')), JSON.stringify({ draft_id: c.req.param('draftId') })).run();
    return c.json({ status: 'approved' });
  } catch (error) { return fail(c, error); }
});

reviews.post('/:projectId/reviews/:reviewId/drafts/:draftId/publish', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const draft = await c.env.DB.prepare(`
      SELECT d.id FROM store_review_response_drafts d JOIN store_reviews r ON r.id = d.review_id
      WHERE d.id = ? AND r.id = ? AND r.project_id = ? AND d.status IN ('approved','failed')
    `).bind(c.req.param('draftId'), c.req.param('reviewId'), project.id).first<{ id: string }>();
    if (!draft) throw purchasesError('draft_not_publishable', 'Only an approved response can be published', 409);
    if (!c.env.EVENT_QUEUE) throw purchasesError('queue_unavailable', 'Review response queue is unavailable', 503);
    await c.env.DB.prepare(`
      UPDATE store_review_response_drafts
      SET publish_requested_at = COALESCE(publish_requested_at, datetime('now')), updated_at = datetime('now')
      WHERE id = ? AND status IN ('approved','failed')
    `).bind(draft.id).run();
    try {
      await c.env.EVENT_QUEUE.send({ type: 'reputation.review-response.publish', draftId: draft.id });
      return c.json({ queued: true, retry_scheduled: false }, 202);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'store_review_response_queue_failed', draft_id: draft.id,
        error: error instanceof Error ? error.message : String(error),
      }));
      return c.json({ queued: false, retry_scheduled: true }, 202);
    }
  } catch (error) { return fail(c, error); }
});

export default reviews;
