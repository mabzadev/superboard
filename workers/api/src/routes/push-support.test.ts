import { describe, expect, it, vi } from 'vitest';
import type { SupportNotificationEvent } from '@superboard/contracts/support-notifications';
import { createFakeD1, type FakeD1Call } from '../test/fake-d1';
import type { Env } from '../types';
import { internalPush } from './push';

const token = 'support-to-api-internal-token';
const baseEvent: SupportNotificationEvent = {
  schema_version: 1,
  event_id: 'support:event-1',
  project_id: 42,
  recipient_user_id: 'auth-user-1',
  notification_type: 'conversation_assigned',
  title: 'Conversation assigned',
  body: 'A conversation was assigned to you.',
  conversation_id: 'conversation-1',
  occurred_at: '2026-08-13T12:00:00.000Z',
  channels: { push: false, browser: true },
};

type ReceiptState = {
  digest: string;
  status: 'processing' | 'completed';
  browser: number;
  push: number;
};

function notificationDb() {
  const receipts = new Map<string, ReceiptState>();
  let notificationId: number | null = null;
  let pushRows = 0;
  let browserMessages = 0;
  const db = createFakeD1(({ op, sql, args }: FakeD1Call) => {
    if (op === 'run' && sql.startsWith('INSERT INTO support_notification_ingress')) {
      const eventId = String(args[0]);
      if (receipts.has(eventId)) return { success: true, meta: { changes: 0 } };
      receipts.set(eventId, {
        digest: String(args[1]),
        status: 'processing',
        browser: 0,
        push: 0,
      });
      return true;
    }
    if (op === 'first' && sql.includes('FROM support_notification_ingress')) {
      const row = receipts.get(String(args[0]));
      return row && {
        payload_sha256: row.digest,
        notification_id: notificationId,
        status: row.status,
        browser_messages: row.browser,
        push_queued: row.push,
      };
    }
    if (op === 'run' && sql.startsWith('INSERT INTO notifications')) {
      notificationId ??= 77;
      return true;
    }
    if (op === 'first' && sql.includes('FROM notifications WHERE support_event_id')) {
      return notificationId === null ? null : { id: notificationId };
    }
    if (op === 'first' && sql.includes('FROM notifications') && sql.includes('send_push')) {
      return notificationId === null
        ? null
        : { id: notificationId, title: baseEvent.title, subtitle: baseEvent.body, send_push: 1 };
    }
    if (op === 'all' && sql.includes('FROM notification_messages nm')) {
      return [{ device_id: 8, push_token: 'push-token', platform: 'ios' }];
    }
    if (op === 'first' && sql.includes('JOIN ios_configurations')) return { id: 'rpush-app-1' };
    if (op === 'run' && sql.startsWith('INSERT INTO rpush_notifications')) {
      pushRows = 1;
      return true;
    }
    if (op === 'run' && sql.startsWith('INSERT INTO notification_targets')) return true;
    if (op === 'run' && sql.startsWith('INSERT INTO notification_messages')) {
      browserMessages = Number(args[3]) === 1 ? 2 : 0;
      return true;
    }
    if (op === 'first' && sql.includes("device.platform IN ('web', 'desktop')")) {
      return { count: browserMessages };
    }
    if (op === 'first' && sql.includes('FROM rpush_notifications WHERE data')) {
      return { count: pushRows };
    }
    if (op === 'run' && sql.startsWith('UPDATE support_notification_ingress')) {
      const eventId = String(args.at(-2));
      const row = receipts.get(eventId);
      if (!row) throw new Error('missing fake receipt');
      row.status = 'completed';
      row.browser = Number(args[1] || 0);
      row.push = Number(args[2] || 0);
      return true;
    }
    return undefined;
  });
  return { db, receipts };
}

function env(db: D1Database, send = vi.fn(async () => undefined)) {
  return {
    DB: db,
    MODULE_INTERNAL_TOKEN: token,
    PUSH_QUEUE: { send },
  } as unknown as Env;
}

async function request(event: SupportNotificationEvent, environment: Env, auth = token) {
  return internalPush.request('/support-notifications', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { 'x-internal-token': auth } : {}),
    },
    body: JSON.stringify(event),
  }, environment);
}

describe('Support notification internal ingress', () => {
  it('rejects unauthenticated callers before reading D1', async () => {
    const db = createFakeD1(() => undefined);
    const response = await request(baseEvent, env(db), '');
    expect(response.status).toBe(403);
    expect(db.calls).toHaveLength(0);
  });

  it('materializes browser only, never signals push, and replays idempotently', async () => {
    const { db } = notificationDb();
    const send = vi.fn(async () => undefined);
    const environment = env(db, send);

    const first = await request(baseEvent, environment);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      data: {
        event_id: baseEvent.event_id,
        duplicate: false,
        browser_messages: 2,
        push_queued: 0,
      },
    });
    expect(send).not.toHaveBeenCalled();
    expect(db.calls.some((call) =>
      call.op === 'run' && call.sql.startsWith('INSERT INTO rpush_notifications'),
    )).toBe(false);

    const replay = await request(baseEvent, environment);
    await expect(replay.json()).resolves.toMatchObject({
      data: { duplicate: true, browser_messages: 2, push_queued: 0 },
    });
    expect(db.calls.filter((call) =>
      call.op === 'run' && call.sql.startsWith('INSERT INTO notifications'),
    )).toHaveLength(1);
  });

  it('accepts fully suppressed preferences without creating a notification', async () => {
    const { db } = notificationDb();
    const suppressed = {
      ...baseEvent,
      event_id: 'support:event-suppressed',
      channels: { push: false, browser: false },
    };
    const response = await request(suppressed, env(db));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { browser_messages: 0, push_queued: 0 },
    });
    expect(db.calls.some((call) => call.sql.includes('INSERT INTO notifications'))).toBe(false);
  });

  it('targets mobile only and signals the existing push processor', async () => {
    const { db } = notificationDb();
    const send = vi.fn(async () => undefined);
    const pushOnly = {
      ...baseEvent,
      event_id: 'support:event-push',
      channels: { push: true, browser: false },
    };
    const response = await request(pushOnly, env(db, send));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { browser_messages: 0, push_queued: 1 },
    });
    expect(send).toHaveBeenCalledWith(
      { type: 'push.process', limit: 25 },
      { contentType: 'json' },
    );
    const audienceInsert = db.calls.find((call) =>
      call.op === 'run' && call.sql.startsWith('INSERT INTO notification_messages'),
    );
    expect(audienceInsert?.args.slice(3, 5)).toEqual([0, 1]);
  });

  it('rejects reuse of an event id with a different payload', async () => {
    const { db } = notificationDb();
    const environment = env(db);
    expect((await request(baseEvent, environment)).status).toBe(200);
    const conflict = await request({ ...baseEvent, title: 'Different title' }, environment);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: 'support_notification_idempotency_conflict', retryable: false },
    });
  });
});
