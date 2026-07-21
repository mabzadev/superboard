export interface MetricValues {
  link_views: number;
  link_driven_installs: number;
  organic_users: number;
  installs: number;
  app_opens: number;
  new_users: number;
  returning_users: number;
  returning_rate: number;
  referred_users: number;
  revenue: number;
  arpu: number;
  arppu: number;
  units_sold: number;
  cancellations: number;
  first_time_purchases: number;
  [key: string]: number;
}

export interface MetricsOverview {
  current: MetricValues;
  previous: MetricValues;
}

export type LinksViews = Record<string, number>;

export interface ChartDataPoint {
  name: string;
  users: number;
}
