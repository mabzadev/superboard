export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

// --- Instance API payloads ---

export interface DismissGetStartedPayload {
  get_started_dismissed?: boolean;
}

export interface ExportUsagePayload {
  start_date: string;
  end_date: string;
}

export interface RevenueCollectionPayload {
  revenue_collection_enabled: boolean;
}

// --- User API payloads ---

export interface EditUserPayload {
  name?: string;
  email?: string;
}

// --- Campaign API payloads ---

export interface CreateCampaignPayload {
  name: string;
}

export interface UpdateCampaignPayload {
  name?: string;
  active?: boolean;
}

// --- Events API payloads ---

export interface EventsSearchPayload {
  start_date: string;
  end_date?: string;
  page?: number;
  per_page?: number;
  sort_by?: string;
  ascending?: boolean;
  term?: string;
  platform?: string;
}

export interface DownloadCSVPayload {
  active: boolean;
  sdk: boolean;
  start_date: string;
  end_date?: string;
}

export interface EventsSortedPayload {
  start_date: string;
  end_date?: string;
  sort_by?: string;
  ascending?: boolean;
  platform?: string;
}

// --- Link API payloads ---

export interface LinksByIdsPayload {
  ids: string[];
}

// --- Domain API payloads ---

export interface SubdomainPayload {
  subdomain?: string;
  generic_title?: string;
  generic_subtitle?: string;
  generic_image_url?: string;
}

export interface GoogleTrackingIdPayload {
  google_tracking_id: string;
}

// --- Notification API payloads ---

export interface CreateNotificationApiPayload {
  title: string;
  subtitle: string;
  project_id: string;
  platforms: string[];
  new_users: boolean;
  existing_users: boolean;
  auto_display: boolean;
  send_push: boolean;
  html?: string;
}

// --- Platform config payloads ---
// These can be either FormData (for file uploads) or typed objects.
// Use `FormData | PlatformConfigPayload` at call sites.

export interface IosConfigPayload {
  bundle_id?: string;
  app_prefix?: string;
  [key: string]: unknown;
}

export interface AndroidConfigPayload {
  identifier?: string;
  sha256s?: string[];
  package_name?: string;
  [key: string]: unknown;
}

export interface AndroidPushConfigPayload {
  firebase_project_id?: string;
  [key: string]: unknown;
}

export interface DesktopConfigPayload {
  fallback_url?: string;
  [key: string]: unknown;
}
