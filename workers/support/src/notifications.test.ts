import { describe, expect, it, vi } from 'vitest';
import {
  buildSupportNotificationEvent,
  deliverSupportNotification,
} from './notifications';
import type { Env } from './types';

const row = {
  id: 'notification-1',
  project_id: 42,
  notification_type: 'conversation_assigned',
  title: 'Conversation assigned',
  body: 'A conversation was assigned to you.',
  conversation_id: 'conversation-1',
  created_at: '2026-08-13T12:00:00.000Z',
  deleted_at: null,
  snoozed_until: null,
  recipient_user_id: 'auth-user-1',
  push_enabled: 0,
  browser_enabled: 1,
  muted: 0,
};

describe('Support notification delegation', () => {
  it('derives channels from preferences and suppresses muted events', async () => {
    await expect(buildSupportNotificationEvent(row)).resolves.toMatchObject({
      project_id: 42,
      recipient_user_id: 'auth-user-1',
      channels: { push: false, browser: true },
    });
    await expect(buildSupportNotificationEvent({
      ...row,
      push_enabled: 1,
      muted: 1,
    })).resolves.toMatchObject({
      channels: { push: false, browser: false },
    });
  });

  it('sends only the closed contract over an authenticated service binding', async () => {
    let deliveredRequest: Request | undefined;
    const updates: unknown[][] = [];
    const db = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first() {
                if (query.includes('FROM support_agent_notifications notification')) return row;
                throw new Error(`Unexpected first query: ${query}`);
              },
              async run() {
                if (query.includes('UPDATE support_notification_delivery_outbox')) {
                  updates.push(values);
                  return { success: true, meta: { changes: 1 } };
                }
                throw new Error(`Unexpected run query: ${query}`);
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const fetch = vi.fn(async (request: Request) => {
      deliveredRequest = request;
      const event = await request.clone().json() as Record<string, unknown>;
      return new Response(JSON.stringify({
        data: {
          event_id: event.event_id,
          duplicate: false,
          browser_messages: 1,
          push_queued: 0,
        },
      }), { headers: { 'content-type': 'application/json' } });
    });
    const env = {
      DB: db,
      API_SERVICE: { fetch },
      INTERNAL_API_TOKEN: 'internal-token',
    } as unknown as Env;

    const receipt = await deliverSupportNotification(env, {
      type: 'support.notification.deliver.v1',
      projectId: 42,
      notificationId: 'notification-1',
    });
    expect(receipt.data).toMatchObject({ browser_messages: 1, push_queued: 0 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(deliveredRequest?.url).toBe(
      'https://api.internal/internal/v1/push/support-notifications',
    );
    expect(deliveredRequest?.headers.get('x-internal-token')).toBe('internal-token');
    const event = await deliveredRequest?.clone().json() as Record<string, unknown>;
    expect(event).toMatchObject({
      schema_version: 1,
      channels: { push: false, browser: true },
    });
    expect(event).not.toHaveProperty('payload');
    expect(event).not.toHaveProperty('payload_json');
    expect(event).not.toHaveProperty('credentials');
    expect(event).not.toHaveProperty('secret');
    expect(updates).toEqual([['notification-1', 42]]);
  });
});
