export interface Purchase {
  product_id: string;
  platforms: string | string[];
  units_sold: number;
  first_time_purchases: number;
  repeat_purchases: number;
  total_revenue_usd_cents: number;
  arpu_usd_cents: number;
  ltv_usd_cents: number;
  cancellations: number;
}

export interface RevenueMetric {
  product_id: string;
  platforms: string | string[];
  units_sold: number;
  first_time_purchases: number;
  repeat_purchases: number;
  total_revenue_usd_cents: number;
  arpu_usd_cents: number;
  ltv_usd_cents: number;
  cancellations: number;
}
