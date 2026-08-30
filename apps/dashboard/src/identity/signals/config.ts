import { signal } from "@preact/signals-core";
import { config as dashboardConfig } from "@/lib/config";

export type IdentityConfig = Record<string, unknown> & {
  AUTH_SERVER_URL: string;
  SUPPORTED_LOCALES: string[];
  ENABLE_NAMES: boolean;
  ENABLE_USER_APP_CONSENT: boolean;
  ENABLE_EMAIL_VERIFICATION: boolean;
  ENABLE_PASSWORD_SIGN_IN: boolean;
  ENABLE_PASSWORD_RESET: boolean;
  ENABLE_RECOVERY_CODE: boolean;
  ALLOW_PASSKEY_ENROLLMENT: boolean;
  ENABLE_ORG: boolean;
  ENABLE_ORG_GROUP: boolean;
  ENABLE_USER_ATTRIBUTE: boolean;
  ENABLE_SAML_SSO_AS_SP: boolean;
  ENABLE_APP_BANNER: boolean;
  ENABLE_EMAIL_LOG: boolean;
  ENABLE_SMS_LOG: boolean;
  ENABLE_SIGN_IN_LOG: boolean;
};

export const defaultIdentityConfig: IdentityConfig = {
  AUTH_SERVER_URL: dashboardConfig.authUrl,
  SUPPORTED_LOCALES: ["en", "fr"],
  ENABLE_NAMES: true,
  ENABLE_USER_APP_CONSENT: true,
  ENABLE_EMAIL_VERIFICATION: true,
  ENABLE_PASSWORD_SIGN_IN: true,
  ENABLE_PASSWORD_RESET: true,
  ENABLE_RECOVERY_CODE: true,
  ALLOW_PASSKEY_ENROLLMENT: true,
  ENABLE_ORG: true,
  ENABLE_ORG_GROUP: true,
  ENABLE_USER_ATTRIBUTE: true,
  ENABLE_SAML_SSO_AS_SP: true,
  ENABLE_APP_BANNER: true,
  ENABLE_EMAIL_LOG: true,
  ENABLE_SMS_LOG: true,
  ENABLE_SIGN_IN_LOG: true,
};

const config = signal<IdentityConfig>(defaultIdentityConfig);

export default config;
