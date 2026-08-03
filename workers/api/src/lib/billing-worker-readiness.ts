import type { BillingEnv } from '../types';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { purchasesSigningJwks, signCustomerInfoPayload } from './billing-identity';
import { decryptCredential } from './secrets';

type BillingSecretEnv = Pick<
  BillingEnv,
  | 'STORE_CREDENTIALS_ENCRYPTION_KEYS'
  | 'STORE_CREDENTIALS_ENCRYPTION_KEY'
  | 'PURCHASES_SIGNING_KEYSET'
  | 'APPLE_ROOT_CERTIFICATES_B64'
  | 'OPENGROW_ENTITLEMENT_WEBHOOK_SECRET'
  | 'OPENGROW_VOCOSTAR_WEBHOOK_SECRET'
>;

export type BillingWorkerReadiness = {
  status: 'ok';
  service: 'opengrow-billing';
  environment: string;
  execution: 'private-service-binding';
  ready_for_traffic: boolean;
  missing_secrets: string[];
  credential_copies_ready: boolean;
  credential_decryption_ready: boolean;
  signing_authority_ready: boolean;
  credential_copies: Record<string, number> | null;
  store_connections: Record<string, unknown>[];
};

export function billingSecretReadiness(env: BillingSecretEnv) {
  const missing: string[] = [];
  if (!env.STORE_CREDENTIALS_ENCRYPTION_KEYS && !env.STORE_CREDENTIALS_ENCRYPTION_KEY) {
    missing.push('STORE_CREDENTIALS_ENCRYPTION_KEYS');
  }
  if (!env.PURCHASES_SIGNING_KEYSET) missing.push('PURCHASES_SIGNING_KEYSET');
  if (!env.APPLE_ROOT_CERTIFICATES_B64) missing.push('APPLE_ROOT_CERTIFICATES_B64');
  if (!env.OPENGROW_ENTITLEMENT_WEBHOOK_SECRET && !env.OPENGROW_VOCOSTAR_WEBHOOK_SECRET) {
    missing.push('OPENGROW_ENTITLEMENT_WEBHOOK_SECRET');
  }
  return { ready: missing.length === 0, missing };
}

export async function billingWorkerReadiness(env: BillingEnv): Promise<BillingWorkerReadiness> {
  const secrets = billingSecretReadiness(env);
  const [stores, credentialCopies, signingAuthorityReady] = await Promise.all([
    env.DB.prepare(`
      SELECT provider, environment, COUNT(*) AS connections,
        SUM(CASE WHEN billing_configuration_encrypted IS NOT NULL THEN 1 ELSE 0 END) AS configured
      FROM billing_store_connections
      WHERE provider IN ('apple', 'google', 'stripe')
      GROUP BY provider, environment ORDER BY provider, environment
    `).all<Record<string, unknown>>(),
    env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM ios_server_api_keys WHERE encrypted_key IS NOT NULL) AS apple_source,
        (SELECT COUNT(*) FROM ios_server_api_keys WHERE billing_encrypted_key IS NOT NULL) AS apple_billing,
        (SELECT COUNT(*) FROM android_server_api_keys WHERE encrypted_key IS NOT NULL) AS google_source,
        (SELECT COUNT(*) FROM android_server_api_keys WHERE billing_encrypted_key IS NOT NULL) AS google_billing
    `).first<Record<string, number>>(),
    billingSigningAuthorityReady(env),
  ]);
  const copiesReady = Boolean(
    credentialCopies
    && credentialCopies.apple_source > 0
    && credentialCopies.google_source > 0
    && credentialCopies.apple_source === credentialCopies.apple_billing
    && credentialCopies.google_source === credentialCopies.google_billing
  );
  const decryptionReady = copiesReady ? await validateCredentialDecryption(env) : false;
  return {
    status: 'ok',
    service: 'opengrow-billing',
    environment: env.ENVIRONMENT,
    execution: 'private-service-binding',
    ready_for_traffic: secrets.ready && copiesReady && decryptionReady && signingAuthorityReady,
    missing_secrets: secrets.missing,
    credential_copies_ready: copiesReady,
    credential_decryption_ready: decryptionReady,
    signing_authority_ready: signingAuthorityReady,
    credential_copies: credentialCopies,
    store_connections: stores.results || [],
  };
}

export async function billingSigningAuthorityReady(env: BillingEnv): Promise<boolean> {
  try {
    const subject = 'billing-readiness-probe';
    const token = await signCustomerInfoPayload(env, 'readiness', subject, {
      customer_id: subject,
      entitlements: {},
      subscriptions: [],
    });
    await jwtVerify(token, createLocalJWKSet(purchasesSigningJwks(env)), {
      issuer: 'opengrow-purchases',
      audience: 'opengrow-sdk',
      subject,
    });
    return true;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'billing_signing_readiness_failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return false;
  }
}

async function validateCredentialDecryption(env: BillingEnv): Promise<boolean> {
  try {
    const [apple, google] = await Promise.all([
      env.DB.prepare('SELECT billing_encrypted_key FROM ios_server_api_keys WHERE billing_encrypted_key IS NOT NULL LIMIT 1')
        .first<{ billing_encrypted_key: string }>(),
      env.DB.prepare('SELECT billing_encrypted_key FROM android_server_api_keys WHERE billing_encrypted_key IS NOT NULL LIMIT 1')
        .first<{ billing_encrypted_key: string }>(),
    ]);
    if (!apple || !google) return false;
    const [appleKey, googleJson] = await Promise.all([
      decryptCredential(env, apple.billing_encrypted_key),
      decryptCredential(env, google.billing_encrypted_key),
    ]);
    const googleKey = JSON.parse(googleJson) as Record<string, unknown>;
    return appleKey.includes('BEGIN PRIVATE KEY')
      && typeof googleKey.client_email === 'string'
      && String(googleKey.private_key || '').includes('BEGIN PRIVATE KEY');
  } catch (error) {
    console.error(JSON.stringify({
      event: 'billing_credential_readiness_failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return false;
  }
}
