export interface Env {
  DB: D1Database;
  GROWTH_QUEUE: Queue;
  ENVIRONMENT: string;
  GROWTH_INTERNAL_TOKEN: string;
  APPTWEAK_API_KEY?: string;
  APPTWEAK_API_BASE_URL: string;
}

export type Platform = 'apple' | 'google';
export type Device = 'iphone' | 'ipad' | 'android';

export type GrowthQueueJob =
  | { type: 'growth.project.sync'; projectId: number }
  | { type: 'growth.all.sync' };

export const AUTOMATION_TRIGGERS = [
  'paywall_abandoned',
  'payment_failed',
  'entitlement_expired',
  'refund_granted',
  'refund_reversed',
  'renewal_succeeded',
  'review_negative',
  'churn_risk',
] as const;

export const AUTOMATION_ACTIONS = ['chat', 'push', 'in_app', 'inbox'] as const;

export const AUTOMATION_TRIGGER_ACTIONS: Record<(typeof AUTOMATION_TRIGGERS)[number], readonly (typeof AUTOMATION_ACTIONS)[number][]> = {
  paywall_abandoned: ['chat', 'push', 'in_app'],
  payment_failed: ['chat', 'push', 'in_app'],
  entitlement_expired: ['chat', 'push', 'in_app'],
  refund_granted: ['chat', 'push', 'in_app'],
  refund_reversed: ['chat', 'push', 'in_app'],
  renewal_succeeded: ['chat', 'push', 'in_app'],
  review_negative: ['inbox'],
  churn_risk: ['chat', 'push', 'in_app'],
};
