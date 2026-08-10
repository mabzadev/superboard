import { describe, expect, it, vi } from 'vitest';
import { mapConversationItem, mapRefundItem } from './inbox-admin';

describe('unified Inbox projection', () => {
  it('keeps source identifiers and actions as references', () => {
    const item = mapConversationItem({
      id: 'conversation-1', subject: 'Help', last_message_preview: 'Hello',
      status: 'open', priority: 'high', external_user_id: 'customer-1', updated_at: '2026-08-03T10:00:00.000Z',
    });
    expect(item).toMatchObject({
      id: 'conversation:conversation-1', source_type: 'conversation', source_id: 'conversation-1',
      destination: '/inbox?type=conversation&id=conversation-1', priority: 'high',
    });
    expect(item.capabilities).toContain('reply');
  });

  it('prioritizes imminent refund deadlines without mutating the case', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T10:00:00.000Z'));
    const source = {
      id: 'case-1', provider: 'google', case_type: 'refund', status: 'evidence_required',
      deadline_at: '2026-08-04T08:00:00.000Z', updated_at: '2026-08-03T10:00:00.000Z', actions_requiring_approval: 0,
    };
    const item = mapRefundItem(source);
    expect(item).toMatchObject({ source_type: 'refund_case', source_id: 'case-1', priority: 'urgent', status: 'open' });
    expect(item.source).toBe(source);
    expect(item.capabilities).not.toContain('grant_entitlement');
    vi.useRealTimers();
  });
});
