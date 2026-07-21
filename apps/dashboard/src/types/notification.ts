export interface NotificationTarget {
  platforms: string[];
  new_users: boolean;
  existing_users: boolean;
}

export interface NotificationCampaign {
  created_at: string;
}

export interface Notification {
  id: string;
  title: string;
  subtitle: string;
  target: NotificationTarget;
  read_count: number;
  auto_display: boolean;
  send_push: boolean;
  archived: boolean;
  updated_at: string;
  html?: string;
  access_url?: string;
}

export interface CreateNotificationPayload {
  title: string;
  subtitle: string;
  platforms: string[];
  auto_display: boolean;
  send_push: boolean;
  for_new_users: boolean;
  for_existing_users: boolean;
  html_message?: string;
}
