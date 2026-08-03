export interface BillingEnv {
  DB: D1Database;
  KV: KVNamespace;
  R2?: R2Bucket;
  BILLING_QUEUE?: Queue;
  ENVIRONMENT: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_STANDARD_PRICE_ID?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PORTAL_RETURN_URL?: string;
  STRIPE_SUCCESS_URL?: string;
  STRIPE_CANCEL_URL?: string;
  IAP_ALLOW_UNSIGNED_FIXTURES?: string;
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;
  STORE_CREDENTIALS_ENCRYPTION_KEY?: string;
  STORE_CREDENTIALS_ENCRYPTION_KEYS?: string;
  STORE_CREDENTIALS_ACTIVE_KEY_VERSION?: string;
  PURCHASES_SIGNING_SECRET?: string;
  PURCHASES_SIGNING_KEYSET?: string;
  OPENGROW_VOCOSTAR_WEBHOOK_SECRET?: string;
  APPLE_ROOT_CERTIFICATES_B64?: string;
  CREDENTIAL_KEY_SCOPE?: 'api' | 'billing';
}

export interface Env extends BillingEnv {
  EVENT_QUEUE?: Queue;
  PUSH_QUEUE?: Queue;
  MAINTENANCE_QUEUE?: Queue;
  MESSAGING?: Fetcher;
  BILLING?: Fetcher;
  EMAIL?: SendEmail;
  SHORTLINK_DOMAIN: string;
  API_DOMAIN: string;
  SDK_DOMAIN: string;
  CORS_ORIGIN: string;
  DASHBOARD_CLIENT_ID?: string;
  OPENGROW_ACCESS_MODE?: 'full' | 'metered';
  REGISTRATION_MODE?: 'allowlist' | 'public';
  REGISTRATION_REALM?: string;
  SSO_ENABLED?: string;
  JWT_SECRET: string;
  BILLING_EXECUTION_MODE?: 'local' | 'service';
  SENT_QUOTAS_WEBHOOK_KEY?: string;
  PUSH_PROCESS_KEY?: string;
  IAP_PROCESS_KEY?: string;
  GOOGLE_PUBSUB_VERIFICATION_TOKEN?: string;
  MESSAGING_INTERNAL_TOKEN?: string;
  BILLING_CREDENTIALS_REWRAP_KEY?: string;
  APP_URL?: string;
  MCP_CONSENT_URL?: string;
  SERVER_HOST?: string;
  SERVER_HOST_PROTOCOL?: string;
  SSO_AUTHENTICATION_ENDPOINT?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  FREE_MAU_COUNT?: string;
  REACT_HOST?: string;
  REACT_HOST_DASHBOARD_PATH?: string;
  REACT_HOST_PROTOCOL?: string;
  ADMIN_API_KEY?: string;
  MAINTENANCE_PROCESS_KEY?: string;
  DIAGNOSTICS_API_KEY?: string;
  MAIL_PROVIDER?: string;
  MAIL_FROM?: string;
  MAIL_WEBHOOK_URL?: string;
  MAIL_WEBHOOK_TOKEN?: string;
  RESEND_API_KEY?: string;
  POSTMARK_SERVER_TOKEN?: string;
  POSTMARK_MESSAGE_STREAM?: string;
  SENDGRID_API_KEY?: string;
  REACT_HOST_ACCEPT_INVITE_PATH?: string;
  REACT_HOST_CHANGE_PASSWORD_PATH?: string;
}

export interface AppVariables {
  userId: number;
  instanceId: number;
  projectId?: number;
  sdkAuthMode?: 'mobile' | 'server' | 'legacy';
  sdkPlatform?: string;
  sdkIdentifier?: string;
}
