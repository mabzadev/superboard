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

export const AUTOMATION_ACTIONS = ['chat', 'push', 'in_app'] as const;
