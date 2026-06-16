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

export type CustomDomainStatus =
  | "provisioning"
  | "pending"
  | "active"
  | "suspended"
  | "failed";
export type CustomDomainSource = "saas" | "enterprise";
export type CustomDomainPurpose = "primary" | "migration";

export interface CustomDomain {
  hostname: string;
  purpose: CustomDomainPurpose;
  status: CustomDomainStatus;
  ssl_status: string | null;
  // Wider than the backend contract on purpose: actual responses vary between
  // a list of strings, a single string, or an object keyed by field. Normalize
  // at the render site.
  verification_errors: string[] | string | Record<string, unknown> | null;
  source: CustomDomainSource;
  cname_target: string;
  ssl_validation_txt_records?: Array<{
    name: string;
    value: string;
  }> | null;
  ssl_validation_txt_name?: string | null;
  ssl_validation_txt_value?: string | null;
  ownership_verification_txt_name?: string | null;
  ownership_verification_txt_value?: string | null;
  ssl_method?: string | null;
  txt_record_name?: string | null;
  txt_record_value?: string | null;
  txt_record?: string | null;
}

// Legacy singular envelope kept for the deprecated singular endpoint shim.
export interface CustomDomainResponse {
  custom_domain: CustomDomain | null;
}

export interface CustomDomainsListResponse {
  custom_domains: CustomDomain[];
}

export interface CustomDomainPreflight {
  hostname: string;
  cname_matches: boolean;
  cname_expected?: string | null;
  cname_actual?: string | null;
  dns_error?: string | null;
  checked_at?: string | null;
}

export type CustomDomainPreflightResponse =
  | CustomDomainPreflight
  | { preflight?: CustomDomainPreflight | null };
