import { describe, expect, it, vi } from 'vitest';
import { mapConversationItem, mapRefundItem, mapReviewItem } from './inbox-admin';

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

  it('prioritizes low-rating unanswered reviews', () => {
    expect(mapReviewItem({
      id: 'review-1', rating: 1, body: 'Broken', provider_created_at: '2026-08-03T10:00:00.000Z',
    })).toMatchObject({ source_type: 'store_review', status: 'open', priority: 'urgent' });
    expect(mapReviewItem({
      id: 'review-2', rating: 4, body: 'Good', draft_status: 'approved', provider_created_at: '2026-08-03T10:00:00.000Z',
    }).status).toBe('pending');
    const automated = mapReviewItem({
      id: 'review-3', rating: 2, body: 'Needs work', automation_alert_id: 'alert-1',
      automation_alert_priority: 'urgent', provider_created_at: '2026-08-03T10:00:00.000Z',
    });
    expect(automated.priority).toBe('urgent');
    expect(automated.capabilities).toContain('automation_alert');
  });

  it('prioritizes imminent refund deadlines without mutating the case', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T10:00:00.000Z'));
    const source = {
      id: 'case-1', provider: 'stripe', case_type: 'dispute', status: 'evidence_required',
      deadline_at: '2026-08-04T08:00:00.000Z', updated_at: '2026-08-03T10:00:00.000Z', actions_requiring_approval: 0,
    };
    const item = mapRefundItem(source);
    expect(item).toMatchObject({ source_type: 'refund_case', source_id: 'case-1', priority: 'urgent', status: 'open' });
    expect(item.source).toBe(source);
    expect(item.capabilities).not.toContain('grant_entitlement');
    vi.useRealTimers();
  });
});
