export interface RedirectURL {
  url?: string;
  open_app_if_installed?: boolean;
}

export interface Link {
  id: string;
  name: string;
  path: string;
  active: boolean;
  ads_platform: string;
  tags: string[];
  title?: string;
  subtitle?: string;
  image?: string;
  data?: Record<string, string>;
  ios_custom_redirect?: RedirectURL;
  android_custom_redirect?: RedirectURL;
  desktop_custom_redirect?: RedirectURL;
  show_preview_ios?: boolean;
  show_preview_android?: boolean;
  tracking_campaign?: string;
  tracking_medium?: string;
  tracking_source?: string;
  campaign_id?: string;
  total_views: number;
  total_opens: number;
  total_installs: number;
  total_reinstalls: number;
  total_reactivations: number;
  total_time_spent: number;
  total_revenue: number;
  access_path?: string;
  updated_at: string;
  created_at: string;
}

export interface DashboardLink {
  id: string;
  ads_platform: string;
  name: string;
  views: number;
  opens: number;
  tags: string[];
  installs: number;
  reinstalls: number;
  reactivations: number;
  time_spent: number;
  revenue_cents: number;
}
