import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { exportJWK, generateKeyPair } from "jose";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { d1RuntimeBindings } from "../../scripts/cloudflare-vitest-d1.mjs";
// @ts-expect-error The Node-side generator is an ESM script with its own tests.
import { generateMelodyAuthSecrets, serializeMelodyAuthSecrets } from "../../scripts/superboard-generate-melody-auth-secrets.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [
    cloudflareTest(async () => {
      const pair = await generateKeyPair("ES256", { extractable: true });
      const key = await exportJWK(pair.privateKey);
      key.kid = "runtime-identity-key";
      const migrations = await readD1Migrations(
        fileURLToPath(new URL("./migrations", import.meta.url)),
      );
      const melodyAuthSecrets = await generateMelodyAuthSecrets();
      return {
        wrangler: {
          configPath: fileURLToPath(
            new URL("./wrangler.jsonc", import.meta.url),
          ),
        },
        miniflare: {
          bindings: {
            IDENTITY_KEYSET: JSON.stringify({
              active_kid: key.kid,
              keys: [key],
            }),
            INTERNAL_API_TOKEN: "identity-runtime-internal-token",
            EMAIL_INTERNAL_TOKEN: "email-runtime-token",
            FILES_INTERNAL_TOKEN: "files-runtime-token",
            MELODY_AUTH_SECRETS: serializeMelodyAuthSecrets(melodyAuthSecrets),
            MELODY_ENVIRONMENT: "prod",
            IDENTITY_REALM: "test:local",
            AUTH_SERVER_URL: "https://auth.example.test",
            COMPANY_LOGO_URL: "https://board.example.test/superboard-mark.svg",
            COMPANY_EMAIL_LOGO_URL:
              "https://board.example.test/superboard-email-logo.png",
            EMAIL_SENDER_NAME: "SuperBoard",
            SMTP_SENDER_ADDRESS: "identity@example.test",
            EMAIL_PROVIDER_NAME: "superboard",
            DEV_EMAIL_RECEIVER: "",
            DEV_SMS_RECEIVER: "",
            TERMS_LINK: "",
            PRIVACY_POLICY_LINK: "",
            SUPPORTED_LOCALES: ["en", "fr"],
            ENABLE_LOCALE_SELECTOR: true,
            ENABLE_SIGN_UP: true,
            ENABLE_PASSWORD_SIGN_IN: true,
            ENABLE_PASSWORD_RESET: true,
            ENABLE_NAMES: true,
            NAMES_IS_REQUIRED: false,
            ENABLE_USER_APP_CONSENT: true,
            ENABLE_EMAIL_VERIFICATION: true,
            REPLACE_EMAIL_VERIFICATION_WITH_WELCOME_EMAIL: false,
            ENABLE_ORG: true,
            ALLOW_USER_SWITCH_ORG_ON_SIGN_IN: true,
            ENABLE_USER_ATTRIBUTE: true,
            BLOCKED_POLICIES: ["__none__"],
            ENABLE_PASSWORDLESS_SIGN_IN: false,
            USE_PASSWORDLESS_AS_MAGIC_LINK: true,
            EMBEDDED_AUTH_ORIGINS: ["https://board.example.test"],
            ENABLE_SAML_SSO_AS_SP: true,
            ENABLE_APP_BANNER: true,
            AUTHORIZATION_CODE_EXPIRES_IN: 300,
            SPA_ACCESS_TOKEN_EXPIRES_IN: 1_800,
            SPA_REFRESH_TOKEN_EXPIRES_IN: 2_592_000,
            S2S_ACCESS_TOKEN_EXPIRES_IN: 3_600,
            ID_TOKEN_EXPIRES_IN: 1_800,
            SERVER_SESSION_EXPIRES_IN: 1_800,
            OTP_MFA_IS_REQUIRED: false,
            EMAIL_MFA_IS_REQUIRED: false,
            SMS_MFA_IS_REQUIRED: false,
            ENFORCE_ONE_MFA_ENROLLMENT: ["__none__"],
            ALLOW_EMAIL_MFA_AS_BACKUP: true,
            ALLOW_PASSKEY_ENROLLMENT: true,
            ENABLE_RECOVERY_CODE: true,
            ENABLE_MFA_REMEMBER_DEVICE: true,
            UNLOCK_ACCOUNT_VIA_PASSWORD_RESET: true,
            PASSWORD_RESET_EMAIL_THRESHOLD: 5,
            PASSWORD_RESET_CODE_THRESHOLD: 5,
            ACCOUNT_LOCKOUT_THRESHOLD: 5,
            EMAIL_MFA_EMAIL_THRESHOLD: 10,
            CHANGE_EMAIL_EMAIL_THRESHOLD: 5,
            CHANGE_EMAIL_CODE_THRESHOLD: 5,
            EMAIL_VERIFICATION_CODE_THRESHOLD: 5,
            ACCOUNT_LOCKOUT_EXPIRES_IN: 86_400,
            SMS_MFA_MESSAGE_THRESHOLD: 5,
            MFA_CODE_VERIFY_THRESHOLD: 10,
            AUTH_CODE_VERIFIER_THRESHOLD: 5,
            GOOGLE_AUTH_CLIENT_ID: "",
            FACEBOOK_AUTH_CLIENT_ID: "",
            GITHUB_AUTH_CLIENT_ID: "",
            GITHUB_AUTH_APP_NAME: "",
            DISCORD_AUTH_CLIENT_ID: "",
            APPLE_AUTH_CLIENT_ID: "",
            TWILIO_ACCOUNT_ID: "",
            TWILIO_SENDER_NUMBER: "",
            LOG_LEVEL: "silent",
            ENABLE_EMAIL_LOG: true,
            ENABLE_SMS_LOG: true,
            ENABLE_SIGN_IN_LOG: true,
            SENDGRID_API_KEY: "",
            SENDGRID_SENDER_ADDRESS: "",
            BREVO_API_KEY: "",
            BREVO_SENDER_ADDRESS: "",
            MAILGUN_API_KEY: "",
            MAILGUN_SENDER_ADDRESS: "",
            RESEND_API_KEY: "",
            RESEND_SENDER_ADDRESS: "",
            POSTMARK_API_KEY: "",
            POSTMARK_SENDER_ADDRESS: "",
            PG_CONNECTION_STRING: "",
            REDIS_CONNECTION_STRING: "",
            ...d1RuntimeBindings(migrations),
          },
          serviceBindings: {
            ASSETS: () => new Response("asset", {
              headers: { "content-type": "application/javascript" },
            }),
            EMAIL_SERVICE: () => Response.json({
              id: crypto.randomUUID(),
              status: "queued",
              transport: "smtp",
            }),
            FILES_SERVICE: () =>
              Response.json({ data: { erased: true, files_deleted: 0 } }),
          },
        },
      };
    }),
  ],
  test: {
    include: ["runtime-tests/**/*.test.ts"],
    setupFiles: ["./runtime-tests/apply-migrations.ts"],
    sequence: { concurrent: false },
  },
});
