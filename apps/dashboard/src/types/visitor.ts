export interface Visitor {
  id: string;
  uuid: string;
  sdk_identifier: string;
  platform: string;
  country_code?: string | null;
  total_views: number;
  total_opens: number;
  total_app_opens: number;
  total_installs: number;
  total_reinstalls: number;
  total_reactivations: number;
  total_user_referred: number;
  total_time_spent: number;
  total_revenue: number;
  updated_at: string;
  inviter?: string;
}

export interface AggregatedVisitor {
  id: string;
  uuid: string;
  sdk_identifier: string;
  view_count: number;
  open_count: number;
  install_count: number;
  reinstall_count: number;
  reactivations: number;
  user_referred_count: number;
  time_spent: number;
  total_revenue: number;
  updated_at: string;
  inviter: string;
  platform: string;
  country_code?: string | null;
  invited_views: number;
  invited_app_opens: number;
  invited_installs: number;
  invited_reinstalls: number;
  invited_reactivations: number;
  invited_user_referred: number;
  invited_time_spent: number;
}

export interface InvitedUser {
  id: string;
  uuid: string;
  sdk_identifier: string;
}

export interface VisitorDetailMetrics {
  id: string;
  uuid: string;
  sdk_identifier: string;
  platform: string;
  country_code?: string | null;
  sdk_attributes?: Record<string, string>;
  invited?: InvitedUser[];
  created_at: string;
  updated_at: string;
  total_views: number;
  total_opens: number;
  total_app_opens: number;
  total_installs: number;
  total_reinstalls: number;
  total_reactivations: number;
  total_user_referred: number;
  total_time_spent: number;
  total_revenue: number;
  number_of_generated_links?: number;
}

export interface AggregatedVisitorMetrics extends AggregatedVisitor {
  number_of_generated_links?: number;
}
