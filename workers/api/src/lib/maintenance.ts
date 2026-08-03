import { Env } from '../types';
import { sendMail } from './mail';
import { isFullAccess } from './deployment';
import { enqueueStoreReviewResponseRetries } from './store-reviews';
import { enqueueNegativeReviewRecovery, enqueuePaywallAbandonmentRecovery } from './growth-delivery';

const EVENT_METRICS = {
  views: "SUM(CASE WHEN event = 'view' THEN 1 ELSE 0 END)",
  opens: "SUM(CASE WHEN event = 'open' THEN 1 ELSE 0 END)",
  installs: "SUM(CASE WHEN event = 'install' THEN 1 ELSE 0 END)",
  reinstalls: "SUM(CASE WHEN event = 'reinstall' THEN 1 ELSE 0 END)",
  reactivations: "SUM(CASE WHEN event = 'reactivation' THEN 1 ELSE 0 END)",
  app_opens: "SUM(CASE WHEN event = 'app_open' THEN 1 ELSE 0 END)",
  user_referred: "SUM(CASE WHEN event = 'user_referred' THEN 1 ELSE 0 END)",
  time_spent: "SUM(CASE WHEN event = 'time_spent' THEN COALESCE(engagement_time, 0) ELSE 0 END)",
};

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function recentDates(days: number): string[] {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) dates.push(dateDaysAgo(i));
  return dates;
}

function freeMauCount(env: Env): number {
  const parsed = Number(env.FREE_MAU_COUNT || 5000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
}

function monthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

async function currentMau(db: D1Database, instanceId: number | string, startDate = monthStart()): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(DISTINCT e.device_id) AS total
    FROM events e
    JOIN projects p ON p.id = e.project_id
    WHERE p.instance_id = ?
      AND date(e.created_at) >= date(?)
  `).bind(String(instanceId), startDate).first<{ total: number }>();
  return Number(row?.total || 0);
}

async function activeEnterpriseLimit(db: D1Database, instanceId: number | string): Promise<number | null> {
  const row = await db.prepare(`
    SELECT total_maus, seats
    FROM enterprise_subscriptions
    WHERE instance_id = ?
      AND COALESCE(active, CASE WHEN status = 'active' THEN 1 ELSE 0 END, 1) = 1
      AND (start_date IS NULL OR date(start_date) <= date('now'))
      AND (end_date IS NULL OR date(end_date) >= date('now'))
    ORDER BY datetime(created_at) DESC
    LIMIT 1
  `).bind(String(instanceId)).first<{ total_maus: number | null; seats: number | null }>().catch(() => null);
  const limit = Number(row?.total_maus || row?.seats || 0);
  return limit > 0 ? limit : null;
}

async function hasPaidStripeSubscription(db: D1Database, instanceId: number | string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT id
    FROM stripe_subscriptions
    WHERE instance_id = ?
      AND status IN ('active', 'trialing', 'past_due')
    LIMIT 1
  `).bind(String(instanceId)).first<{ id: string }>().catch(() => null);
  return !!row;
}

async function ownerEmails(db: D1Database, instanceId: number | string): Promise<string[]> {
  const rows = await db.prepare(`
    SELECT DISTINCT u.email
    FROM instance_roles ir
    JOIN users u ON u.id = ir.user_id
    WHERE ir.instance_id = ?
      AND ir.role IN ('owner', 'admin')
      AND u.email IS NOT NULL
  `).bind(String(instanceId)).all<{ email: string }>().catch(() => ({ results: [] }));
  return (rows.results || []).map((row) => row.email).filter(Boolean);
}

async function sendQuotaEmail(env: Env, instance: any, kind: 'warning' | 'exceeded', current: number, limit: number): Promise<boolean> {
  const recipients = await ownerEmails(env.DB, instance.id);
  if (!recipients.length) return false;
  const subject = kind === 'exceeded' ? 'OpenGrow quota exceeded' : 'OpenGrow quota warning';
  const text = kind === 'exceeded'
    ? `Workspace ${instance.uri_scheme} exceeded its monthly active user quota (${current}/${limit}).`
    : `Workspace ${instance.uri_scheme} is close to its monthly active user quota (${current}/${limit}).`;
  let sent = false;
  for (const to of recipients) {
    await sendMail(env, {
      to,
      subject,
      text,
      html: `<p>${text}</p>`,
    });
    sent = true;
  }
  return sent;
}

export async function cleanupExpiredMcp(db: D1Database): Promise<{ authorizationCodes: number; tokens: number; clients: number }> {
  const authorizationCodes = await db.prepare(`
    DELETE FROM mcp_authorization_codes
    WHERE datetime(expires_at) <= datetime('now')
       OR (used_at IS NOT NULL AND datetime(used_at) <= datetime('now', '-1 day'))
  `).run().catch(() => ({ meta: { changes: 0 } } as any));

  const expiredTokens = await db.prepare(`
    UPDATE mcp_tokens
    SET revoked_at = COALESCE(revoked_at, datetime('now')), updated_at = datetime('now')
    WHERE revoked_at IS NULL
      AND expires_at IS NOT NULL
      AND datetime(expires_at) <= datetime('now')
  `).run().catch(() => ({ meta: { changes: 0 } } as any));

  const clients = await db.prepare(`
    DELETE FROM mcp_clients
    WHERE datetime(created_at) <= datetime('now', '-90 days')
      AND id NOT IN (SELECT DISTINCT mcp_client_id FROM mcp_tokens)
      AND id NOT IN (SELECT DISTINCT mcp_client_id FROM mcp_authorization_codes)
  `).run().catch(() => ({ meta: { changes: 0 } } as any));

  return {
    authorizationCodes: authorizationCodes.meta?.changes || 0,
    tokens: expiredTokens.meta?.changes || 0,
    clients: clients.meta?.changes || 0,
  };
}

export async function cleanupOrphanedActions(db: D1Database): Promise<number> {
  const result = await db.prepare(`
    DELETE FROM actions
    WHERE NOT EXISTS (SELECT 1 FROM devices d WHERE d.id = actions.device_id)
       OR NOT EXISTS (SELECT 1 FROM links l WHERE l.id = actions.link_id)
       OR (handled = 1 AND datetime(updated_at) <= datetime('now', '-30 days'))
  `).run().catch(() => ({ meta: { changes: 0 } } as any));
  return result.meta?.changes || 0;
}

export async function mergeDuplicateVisitors(db: D1Database): Promise<number> {
  const groups = await db.prepare(`
    SELECT project_id, device_id, MIN(id) AS keep_id, COUNT(*) AS total
    FROM visitors
    WHERE device_id IS NOT NULL
    GROUP BY project_id, device_id
    HAVING COUNT(*) > 1
    LIMIT 50
  `).all<{ project_id: string; device_id: number; keep_id: string; total: number }>().catch(() => ({ results: [] }));

  let merged = 0;
  for (const group of groups.results || []) {
    const duplicates = await db.prepare(`
      SELECT id FROM visitors
      WHERE project_id = ? AND device_id = ? AND id != ?
    `).bind(group.project_id, group.device_id, group.keep_id).all<{ id: string }>();
    for (const duplicate of duplicates.results || []) {
      await db.prepare('UPDATE notification_messages SET visitor_id = ?, updated_at = datetime("now") WHERE visitor_id = ?')
        .bind(group.keep_id, duplicate.id).run().catch(() => null);
      await db.prepare('UPDATE purchase_events SET visitor_id = ?, updated_at = datetime("now") WHERE visitor_id = ?')
        .bind(group.keep_id, duplicate.id).run().catch(() => null);
      await db.prepare('DELETE FROM visitors WHERE id = ?').bind(duplicate.id).run().catch(() => null);
      merged += 1;
    }
  }
  return merged;
}

export async function updateQuotaStates(env: Env): Promise<{
  checked: number;
  exceeded: number;
  warnings: number;
  emailsSent: number;
  emailsSkipped: number;
}> {
  const instances = await env.DB.prepare('SELECT id, uri_scheme, quota_exceeded, last_quota_warning_sent_at, last_quota_exceeded_sent_at FROM instances')
    .all<any>();
  const result = { checked: 0, exceeded: 0, warnings: 0, emailsSent: 0, emailsSkipped: 0 };

  if (isFullAccess(env)) {
    await env.DB.prepare(`
      UPDATE instances
      SET quota_exceeded = 0,
          last_quota_warning_sent_at = NULL,
          last_quota_exceeded_sent_at = NULL,
          updated_at = datetime('now')
      WHERE COALESCE(quota_exceeded, 0) != 0
         OR last_quota_warning_sent_at IS NOT NULL
         OR last_quota_exceeded_sent_at IS NOT NULL
    `).run();
    result.checked = instances.results?.length || 0;
    return result;
  }

  for (const instance of instances.results || []) {
    result.checked += 1;
    const enterpriseLimit = await activeEnterpriseLimit(env.DB, instance.id);
    const paidStripe = await hasPaidStripeSubscription(env.DB, instance.id);
    const limit = enterpriseLimit || freeMauCount(env);
    const current = await currentMau(env.DB, instance.id);
    const exceeded = !paidStripe && current > limit;
    const warning = !exceeded && !paidStripe && current >= Math.floor(limit * 0.8);

    await env.DB.prepare('UPDATE instances SET quota_exceeded = ?, updated_at = datetime("now") WHERE id = ?')
      .bind(exceeded ? 1 : 0, instance.id).run();
    if (exceeded) result.exceeded += 1;
    if (warning) result.warnings += 1;

    const shouldSendExceeded = exceeded && (!instance.last_quota_exceeded_sent_at || Date.parse(instance.last_quota_exceeded_sent_at) < Date.now() - 7 * 86400_000);
    const shouldSendWarning = warning && (!instance.last_quota_warning_sent_at || Date.parse(instance.last_quota_warning_sent_at) < Date.now() - 7 * 86400_000);
    const kind = shouldSendExceeded ? 'exceeded' : shouldSendWarning ? 'warning' : null;
    if (!kind) continue;

    try {
      if (await sendQuotaEmail(env, instance, kind, current, limit)) {
        result.emailsSent += 1;
        const column = kind === 'exceeded' ? 'last_quota_exceeded_sent_at' : 'last_quota_warning_sent_at';
        await env.DB.prepare(`UPDATE instances SET ${column} = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
          .bind(instance.id).run();
      } else {
        result.emailsSkipped += 1;
      }
    } catch (error: any) {
      result.emailsSkipped += 1;
      console.warn(JSON.stringify({
        event: 'quota_email_skipped',
        instance_id: instance.id,
        kind,
        error: error?.message || String(error),
      }));
    }
  }

  return result;
}

export async function precomputeEnterpriseMau(env: Env): Promise<number> {
  const rows = await env.DB.prepare(`
    SELECT id, instance_id, metadata
    FROM enterprise_subscriptions
    WHERE COALESCE(active, CASE WHEN status = 'active' THEN 1 ELSE 0 END, 1) = 1
  `).all<{ id: string; instance_id: string; metadata: string | null }>().catch(() => ({ results: [] }));

  let updated = 0;
  for (const row of rows.results || []) {
    const metadata = (() => {
      try {
        return row.metadata ? JSON.parse(row.metadata) : {};
      } catch {
        return {};
      }
    })();
    metadata.current_maus = await currentMau(env.DB, row.instance_id);
    metadata.current_maus_computed_at = new Date().toISOString();
    await env.DB.prepare('UPDATE enterprise_subscriptions SET metadata = ?, updated_at = datetime("now") WHERE id = ?')
      .bind(JSON.stringify(metadata), row.id).run();
    updated += 1;
  }
  return updated;
}

export async function cleanupExpiredDownloads(env: Env): Promise<number> {
  if (!env.R2) return 0;
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const listed = await env.R2.list({ cursor, limit: 100 });
    cursor = listed.truncated ? listed.cursor : undefined;
    for (const item of listed.objects) {
      const expiresAt = item.customMetadata?.expiresAt;
      if (!expiresAt || Date.parse(expiresAt) > Date.now()) continue;
      await env.R2.delete(item.key);
      await env.DB.prepare('DELETE FROM downloadable_files WHERE file_key = ?').bind(item.key).run().catch(() => null);
      deleted += 1;
    }
  } while (cursor);
  return deleted;
}

async function backfillVisitorDailyStatistics(db: D1Database, date: string): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO visitor_daily_statistics (
      project_id, visitor_id, date, event_date, platform, invited_by_id,
      views, opens, installs, reinstalls, reactivations, app_opens,
      user_referred, time_spent, events, created_at, updated_at
    )
    SELECT
      e.project_id,
      v.id,
      date(e.created_at),
      date(e.created_at),
      COALESCE(e.platform, 'unknown'),
      v.inviter_id,
      ${EVENT_METRICS.views},
      ${EVENT_METRICS.opens},
      ${EVENT_METRICS.installs},
      ${EVENT_METRICS.reinstalls},
      ${EVENT_METRICS.reactivations},
      ${EVENT_METRICS.app_opens},
      ${EVENT_METRICS.user_referred},
      ${EVENT_METRICS.time_spent},
      COUNT(*),
      datetime('now'),
      datetime('now')
    FROM events e
    JOIN visitors v ON v.device_id = e.device_id AND v.project_id = e.project_id
    WHERE date(e.created_at) = ?
    GROUP BY e.project_id, v.id, date(e.created_at), COALESCE(e.platform, 'unknown'), v.inviter_id
    ON CONFLICT(project_id, visitor_id, event_date, platform)
    DO UPDATE SET
      date = excluded.date,
      invited_by_id = COALESCE(visitor_daily_statistics.invited_by_id, excluded.invited_by_id),
      views = excluded.views,
      opens = excluded.opens,
      installs = excluded.installs,
      reinstalls = excluded.reinstalls,
      reactivations = excluded.reactivations,
      app_opens = excluded.app_opens,
      user_referred = excluded.user_referred,
      time_spent = excluded.time_spent,
      events = excluded.events,
      updated_at = datetime('now')
  `).bind(date).run();
  return result.meta?.changes || 0;
}

async function backfillLinkDailyStatistics(db: D1Database, date: string): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO link_daily_statistics (
      link_id, project_id, event_date, platform,
      views, opens, installs, reinstalls, reactivations, app_opens,
      user_referred, time_spent, revenue, created_at, updated_at
    )
    SELECT
      e.link_id,
      e.project_id,
      date(e.created_at),
      COALESCE(e.platform, 'unknown'),
      ${EVENT_METRICS.views},
      ${EVENT_METRICS.opens},
      ${EVENT_METRICS.installs},
      ${EVENT_METRICS.reinstalls},
      ${EVENT_METRICS.reactivations},
      ${EVENT_METRICS.app_opens},
      ${EVENT_METRICS.user_referred},
      ${EVENT_METRICS.time_spent},
      COALESCE(SUM(CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN COALESCE(pe.usd_price_cents, pe.price_cents, 0) * COALESCE(pe.quantity, 1) ELSE 0 END), 0),
      datetime('now'),
      datetime('now')
    FROM events e
    LEFT JOIN purchase_events pe ON pe.link_id = e.link_id
      AND pe.project_id = e.project_id
      AND date(COALESCE(pe.date, pe.created_at)) = date(e.created_at)
    WHERE e.link_id IS NOT NULL AND date(e.created_at) = ?
    GROUP BY e.link_id, e.project_id, date(e.created_at), COALESCE(e.platform, 'unknown')
    ON CONFLICT(link_id, project_id, event_date, platform)
    DO UPDATE SET
      views = excluded.views,
      opens = excluded.opens,
      installs = excluded.installs,
      reinstalls = excluded.reinstalls,
      reactivations = excluded.reactivations,
      app_opens = excluded.app_opens,
      user_referred = excluded.user_referred,
      time_spent = excluded.time_spent,
      revenue = excluded.revenue,
      updated_at = datetime('now')
  `).bind(date).run();
  return result.meta?.changes || 0;
}

async function backfillProjectDailyActiveUsers(db: D1Database, date: string): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO project_daily_active_users (
      project_id, date, event_date, platform, active_users, new_users, returning_users, created_at, updated_at
    )
    SELECT
      vds.project_id,
      vds.event_date,
      vds.event_date,
      COALESCE(vds.platform, 'unknown'),
      COUNT(DISTINCT vds.visitor_id),
      COUNT(DISTINCT CASE WHEN previous.visitor_id IS NULL THEN vds.visitor_id END),
      COUNT(DISTINCT CASE WHEN previous.visitor_id IS NOT NULL THEN vds.visitor_id END),
      datetime('now'),
      datetime('now')
    FROM visitor_daily_statistics vds
    LEFT JOIN visitor_daily_statistics previous
      ON previous.project_id = vds.project_id
      AND previous.platform = vds.platform
      AND previous.visitor_id = vds.visitor_id
      AND date(previous.event_date) < date(vds.event_date)
    WHERE date(vds.event_date) = ?
    GROUP BY vds.project_id, vds.event_date, COALESCE(vds.platform, 'unknown')
    ON CONFLICT(project_id, event_date, platform)
    DO UPDATE SET
      date = excluded.date,
      active_users = excluded.active_users,
      new_users = excluded.new_users,
      returning_users = excluded.returning_users,
      updated_at = datetime('now')
  `).bind(date).run();
  return result.meta?.changes || 0;
}

async function backfillDailyProjectMetrics(db: D1Database, date: string): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO daily_project_metrics (
      project_id, event_date, platform,
      views, link_views, installs, reinstalls, opens, app_opens,
      new_users, returning_users, organic_users, referred_users, first_time_visitors,
      revenue, units_sold, cancellations, first_time_purchases,
      created_at, updated_at
    )
    SELECT
      events.project_id,
      events.event_date,
      events.platform,
      events.views,
      events.link_views,
      events.installs,
      events.reinstalls,
      events.opens,
      events.app_opens,
      COALESCE(dau.new_users, 0),
      COALESCE(dau.returning_users, 0),
      MAX(events.installs + events.reinstalls - events.link_installs, 0),
      events.referred_users,
      COALESCE(dau.new_users, 0),
      COALESCE(purchases.revenue, 0),
      COALESCE(purchases.units_sold, 0),
      COALESCE(purchases.cancellations, 0),
      COALESCE(purchases.first_time_purchases, 0),
      datetime('now'),
      datetime('now')
    FROM (
      SELECT
        project_id,
        date(created_at) AS event_date,
        COALESCE(platform, 'unknown') AS platform,
        ${EVENT_METRICS.views} AS views,
        SUM(CASE WHEN event = 'view' AND link_id IS NOT NULL THEN 1 ELSE 0 END) AS link_views,
        ${EVENT_METRICS.installs} AS installs,
        ${EVENT_METRICS.reinstalls} AS reinstalls,
        ${EVENT_METRICS.opens} AS opens,
        ${EVENT_METRICS.app_opens} AS app_opens,
        SUM(CASE WHEN event IN ('install', 'reinstall') AND link_id IS NOT NULL THEN 1 ELSE 0 END) AS link_installs,
        ${EVENT_METRICS.user_referred} AS referred_users
      FROM events
      WHERE date(created_at) = ?
      GROUP BY project_id, date(created_at), COALESCE(platform, 'unknown')
    ) events
    LEFT JOIN project_daily_active_users dau
      ON dau.project_id = events.project_id
      AND date(dau.event_date) = events.event_date
      AND dau.platform = events.platform
    LEFT JOIN (
      SELECT
        project_id,
        date(COALESCE(date, created_at)) AS event_date,
        COALESCE(store_source, 'unknown') AS platform,
        SUM(CASE WHEN event_type IN ('buy', 'refund_reversed') THEN COALESCE(usd_price_cents, price_cents, 0) * COALESCE(quantity, 1) ELSE 0 END) AS revenue,
        SUM(CASE WHEN event_type IN ('buy', 'refund_reversed') THEN COALESCE(quantity, 1) ELSE 0 END) AS units_sold,
        SUM(CASE WHEN event_type IN ('cancel', 'refund') THEN 1 ELSE 0 END) AS cancellations,
        SUM(CASE WHEN event_type IN ('buy', 'refund_reversed') THEN 1 ELSE 0 END) AS first_time_purchases
      FROM purchase_events
      WHERE date(COALESCE(date, created_at)) = ?
      GROUP BY project_id, date(COALESCE(date, created_at)), COALESCE(store_source, 'unknown')
    ) purchases
      ON purchases.project_id = events.project_id
      AND purchases.event_date = events.event_date
      AND purchases.platform = events.platform
    ON CONFLICT(project_id, event_date, platform)
    DO UPDATE SET
      views = excluded.views,
      link_views = excluded.link_views,
      installs = excluded.installs,
      reinstalls = excluded.reinstalls,
      opens = excluded.opens,
      app_opens = excluded.app_opens,
      new_users = excluded.new_users,
      returning_users = excluded.returning_users,
      organic_users = excluded.organic_users,
      referred_users = excluded.referred_users,
      first_time_visitors = excluded.first_time_visitors,
      revenue = excluded.revenue,
      units_sold = excluded.units_sold,
      cancellations = excluded.cancellations,
      first_time_purchases = excluded.first_time_purchases,
      updated_at = datetime('now')
  `).bind(date, date).run();
  return result.meta?.changes || 0;
}

export async function runMaintenance(env: Env, days = 3) {
  const summary = {
    dates: recentDates(days),
    expiredDownloadsDeleted: await cleanupExpiredDownloads(env),
    expiredMcp: await cleanupExpiredMcp(env.DB),
    orphanedActionsDeleted: await cleanupOrphanedActions(env.DB),
    duplicateVisitorsMerged: await mergeDuplicateVisitors(env.DB),
    quotaStates: await updateQuotaStates(env),
    enterpriseMauRows: await precomputeEnterpriseMau(env),
    reviewResponsesEnqueued: await enqueueStoreReviewResponseRetries(env),
    paywallAbandonmentProjectionsEnqueued: await enqueuePaywallAbandonmentRecovery(env),
    negativeReviewProjectionsEnqueued: await enqueueNegativeReviewRecovery(env),
    visitorDailyRows: 0,
    linkDailyRows: 0,
    projectActiveUserRows: 0,
    projectMetricRows: 0,
  };

  for (const date of summary.dates) {
    summary.visitorDailyRows += await backfillVisitorDailyStatistics(env.DB, date);
    summary.linkDailyRows += await backfillLinkDailyStatistics(env.DB, date);
    summary.projectActiveUserRows += await backfillProjectDailyActiveUsers(env.DB, date);
    summary.projectMetricRows += await backfillDailyProjectMetrics(env.DB, date);
  }

  return summary;
}
