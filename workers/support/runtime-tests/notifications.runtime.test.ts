import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { claimSupportNotificationDeliveries } from '../src/notifications';

describe('Support notification delivery outbox', () => {
  it('captures every notification transactionally and queues its bounded identity', async () => {
    const membershipId = crypto.randomUUID();
    const authUserId = `agent-${crypto.randomUUID()}`;
    const notificationId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO support_memberships
        (id, project_id, auth_user_id, display_name, role, active)
      VALUES (?, 12, ?, 'Notification Agent', 'agent', 1)
    `).bind(membershipId, authUserId).run();
    await env.DB.prepare(`
      INSERT INTO support_agent_notifications
        (id, project_id, agent_id, notification_type, title, body)
      VALUES (?, 12, ?, 'conversation_assigned', 'Assigned', 'A conversation was assigned.')
    `).bind(notificationId, authUserId).run();

    await expect(env.DB.prepare(`
      SELECT status, attempts FROM support_notification_delivery_outbox
      WHERE notification_id = ?
    `).bind(notificationId).first()).resolves.toMatchObject({
      status: 'pending',
      attempts: 0,
    });

    expect(await claimSupportNotificationDeliveries(env)).toBeGreaterThanOrEqual(1);
    await expect(env.DB.prepare(`
      SELECT status, attempts FROM support_notification_delivery_outbox
      WHERE notification_id = ?
    `).bind(notificationId).first()).resolves.toMatchObject({
      status: 'queued',
      attempts: 1,
    });
  });
});
