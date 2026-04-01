export interface RedirectPlatformConfig {
  url?: string;
  open_app_if_installed?: boolean;
  enabled?: boolean;
  variation?: string;
  appstore?: boolean;
  fallback_url?: string;
  phone?: RedirectPlatformConfig;
  tablet?: RedirectPlatformConfig;
  all?: RedirectPlatformConfig;
}

export interface RedirectConfig {
  id?: string;
  default_fallback: string;
  show_preview_android: boolean;
  show_preview_ios: boolean;
  show_preview?: boolean;
  ios?: RedirectPlatformConfig;
  android?: RedirectPlatformConfig;
  desktop?: RedirectPlatformConfig;
  created_at?: string;
  updated_at?: string;
}

export interface DomainConfig {
  id: string;
  subdomain: string;
  domain: string;
  google_tracking_id?: string;
  generic_title?: string;
  generic_subtitle?: string;
  generic_image_url?: string;
}

export interface DomainDefaults {
  generic_title: string;
  generic_subtitle: string;
  generic_image_url: string;
}
