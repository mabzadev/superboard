export interface Instance {
  id: string;
  name: string;
  updated_at: string;
  created_at: string;
  revenue_collection_enabled: boolean;
  get_started_dismissed: boolean;
  projects: Project[];
  api_key: string;
  hash_id: string;
  uri_scheme: string;
  production: Project;
  test: Project;
}

export interface Project {
  id: string;
  name: string;
  domain: string;
  hash_id?: string;
  bundle_id?: string;
  team_id?: string;
  app_store_id?: string;
  play_store_id?: string;
  package_name?: string;
  sha256_cert_fingerprints?: string;
}

export interface GetStartedSetup {
  android_sdk: boolean;
  ios_sdk: boolean;
  web_sdk: boolean;
  has_created_campaigns: boolean;
  has_created_links: boolean;
  redirect_fallback: boolean;
}

export interface InstanceMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface PlatformAppConfig {
  platform: string;
  bundle_id?: string;
  team_id?: string;
  app_store_id?: string;
  package_name?: string;
  sha256_cert_fingerprints?: string;
  push_enabled?: boolean;
  enabled?: boolean;
  domains?: string[];
  fallback_url?: string;
  configuration?: {
    identifier?: string;
    bundle_id?: string;
    app_prefix?: string;
    sha256s?: string[];
    domains?: string[];
    push_configuration?: {
      firebase_project_id?: string;
      certificate?: string;
      [key: string]: unknown;
    };
    server_api_key?: {
      file?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type InstanceConfig = PlatformAppConfig[];
