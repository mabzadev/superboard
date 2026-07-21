export interface Campaign {
  id: string;
  name: string;
  active: boolean;
  total_views: number;
  total_opens: number;
  total_installs: number;
  total_reinstalls: number;
  total_reactivations: number;
  total_app_opens: number;
  total_user_referred: number;
  total_revenue: number;
  created_at: string;
  updated_at: string;
}
