export interface StripeSubscription {
  current_period_start: number;
  current_period_end: number;
}

export interface Subscription {
  type: "full" | "enterprise" | "stripe" | string;
  unlimited?: boolean;
  current_maus: number;
  total_available?: number | null;
  total_maus: number;
  maus: number;
  stripe_subscription: StripeSubscription;
  quantity_for_current_billing_cycle: number;
  amount_cents: number;
  start_at: string;
  end_at: string;
}

export interface MAU {
  current_quantity: number;
  total_available: number | null;
  unlimited?: boolean;
}
