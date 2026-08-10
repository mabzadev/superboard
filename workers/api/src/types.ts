/// <reference path="./generated-env.d.ts" />

export interface BillingEnv {
  DB: D1Database;
  KV: KVNamespace;
  R2?: R2Bucket;
  BILLING_QUEUE?: Queue;
  ENVIRONMENT: string;
  IAP_ALLOW_UNSIGNED_FIXTURES?: string;
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;
  STORE_CREDENTIALS_ENCRYPTION_KEY?: string;
  STORE_CREDENTIALS_ENCRYPTION_KEYS?: string;
  STORE_CREDENTIALS_ACTIVE_KEY_VERSION?: string;
  PURCHASES_SIGNING_KEYSET?: string;
  OPENGROW_ENTITLEMENT_WEBHOOK_SECRET?: string;
  APPLE_ROOT_CERTIFICATES_B64?: string;
  /** Generated Worker bindings are strings; target validation constrains this to api or billing. */
  CREDENTIAL_KEY_SCOPE?: string;
  AUTH_GATEWAY_ISSUER: string;
  AUTH_GATEWAY_AUDIENCE: string;
  AUTH_GATEWAY_JWKS_URL: string;
}

/**
 * Secrets and optional rollout variables are not emitted by `wrangler types`.
 * Bindings and regular vars come from `src/generated-env.d.ts`.
 */
interface ApiSecretEnv {
  OPENGROW_TARGET?: string;
  PLATFORM_WORKERS_JSON?: string;
  OPENGROW_RELEASE?: string;
  PUBLIC_ROUTING_MODE?: "active" | "staged";
  MODULE_INTERNAL_TOKEN?: string;
  MODULE_INTERNAL_TOKEN_PREVIOUS?: string;
  EMAIL_INTERNAL_TOKEN?: string;
  /** @deprecated Transitional compatibility only; new targets use EMAIL_SERVICE. */
  EMAIL?: SendEmail;
  OPENGROW_CUTOVER_TOKEN?: string;
  JWT_SECRET: string;
  BILLING_QUEUE_NAME?: string;
  BILLING_DLQ_NAME?: string;
  SENT_QUOTAS_WEBHOOK_KEY?: string;
  PUSH_PROCESS_KEY?: string;
  IAP_PROCESS_KEY?: string;
  GOOGLE_PUBSUB_VERIFICATION_TOKEN?: string;
  MESSAGING_INTERNAL_TOKEN?: string;
  /** @deprecated Legacy Messaging is absent when features.messaging=false. */
  MESSAGING?: Fetcher;
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
  EMAIL_SERVICE?: Fetcher;
  IDENTITY_SERVICE?: Fetcher;
  FILES_SERVICE?: Fetcher;
  CUSTOM_WORKER?: Fetcher;
  CUSTOM_WORKER_TOKEN?: string;
  OBSERVABILITY?: Fetcher;
  OBSERVABILITY_INTERNAL_TOKEN?: string;
  FILES_DOMAIN?: string;
  MCP_DOMAIN?: string;
  REACT_HOST_ACCEPT_INVITE_PATH?: string;
  REACT_HOST_CHANGE_PASSWORD_PATH?: string;
}

export type Env = ApiWorkerGeneratedEnv & BillingEnv & ApiSecretEnv;

export interface AppVariables {
  userId: number;
  instanceId: number;
  projectId?: number;
  sdkAuthMode?: "mobile" | "server" | "legacy";
  sdkPlatform?: string;
  sdkIdentifier?: string;
}
