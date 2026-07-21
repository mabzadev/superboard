import { Buffer } from 'node:buffer';
import type {
  JWSTransactionDecodedPayload,
  ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';
import { importPKCS8, SignJWT } from 'jose';
import { Env } from '../types';
import { BillingEnvironment, BillingStatus, VerifiedPurchase } from './billing';
import { decryptCredential } from './secrets';

type BillingApplication = {
  applicationId: string;
  instanceId: string;
  identifier: string;
  appAppleId?: number | null;
};

type GoogleCredentials = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

// The Apple library currently loads jsrsasign, which seeds its PRNG during
// module initialization. Cloudflare Workers forbids random generation in the
// global scope, so load the library lazily from inside request/queue handlers.
function loadAppleLibrary() {
  return import('@apple/app-store-server-library');
}

function isoMillis(value: unknown): string | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number).toISOString() : null;
}

function appleRoots(env: Env): Buffer[] {
  if (!env.APPLE_ROOT_CERTIFICATES_B64) throw new Error('Apple root certificates are not configured');
  let values: string[];
  try {
    const parsed = JSON.parse(env.APPLE_ROOT_CERTIFICATES_B64);
    values = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    values = env.APPLE_ROOT_CERTIFICATES_B64.split(',').map((value) => value.trim()).filter(Boolean);
  }
  if (values.length === 0) throw new Error('Apple root certificates are not configured');
  return values.map((value) => Buffer.from(value, 'base64'));
}

async function applicationForProject(db: D1Database, projectId: string | number, platform: 'ios' | 'android'): Promise<BillingApplication> {
  if (platform === 'ios') {
    const row = await db.prepare(`
      SELECT a.id AS application_id, a.instance_id, ic.bundle_id AS identifier, ic.app_apple_id
      FROM projects p
      JOIN applications a ON a.instance_id = p.instance_id AND a.platform = 'ios'
      JOIN ios_configurations ic ON ic.application_id = a.id
      WHERE p.id = ? AND COALESCE(a.enabled, 1) = 1
      LIMIT 1
    `).bind(String(projectId)).first<Record<string, unknown>>();
    if (!row?.application_id || !row.identifier) throw new Error('iOS billing application is not configured');
    return {
      applicationId: String(row.application_id),
      instanceId: String(row.instance_id),
      identifier: String(row.identifier),
      appAppleId: row.app_apple_id ? Number(row.app_apple_id) : null,
    };
  }
  const row = await db.prepare(`
    SELECT a.id AS application_id, a.instance_id, ac.identifier
    FROM projects p
    JOIN applications a ON a.instance_id = p.instance_id AND a.platform = 'android'
    JOIN android_configurations ac ON ac.application_id = a.id
    WHERE p.id = ? AND COALESCE(a.enabled, 1) = 1
    LIMIT 1
  `).bind(String(projectId)).first<Record<string, unknown>>();
  if (!row?.application_id || !row.identifier) throw new Error('Android billing application is not configured');
  return {
    applicationId: String(row.application_id),
    instanceId: String(row.instance_id),
    identifier: String(row.identifier),
  };
}

async function appleVerifier(env: Env, app: BillingApplication, environment: BillingEnvironment) {
  const { Environment, SignedDataVerifier } = await loadAppleLibrary();
  const appleEnvironment = environment === 'production' ? Environment.PRODUCTION : Environment.SANDBOX;
  if (environment === 'production' && !app.appAppleId) throw new Error('Apple App ID is required for production verification');
  return new SignedDataVerifier(
    appleRoots(env),
    true,
    appleEnvironment,
    app.identifier,
    environment === 'production' ? app.appAppleId || undefined : undefined,
  );
}

async function appleServerClient(env: Env, app: BillingApplication, environment: BillingEnvironment) {
  const row = await env.DB.prepare(`
    SELECT encrypted_key, key_id, issuer_id
    FROM ios_server_api_keys
    WHERE instance_id = ? OR ios_configuration_id IN (
      SELECT id FROM ios_configurations WHERE application_id = ?
    )
    ORDER BY updated_at DESC LIMIT 1
  `).bind(app.instanceId, app.applicationId).first<{ encrypted_key: string; key_id: string; issuer_id: string }>();
  if (!row?.encrypted_key || !row.key_id || !row.issuer_id) throw new Error('App Store Server API credentials are not configured');
  const key = await decryptCredential(env, row.encrypted_key);
  const { AppStoreServerAPIClient, Environment } = await loadAppleLibrary();
  return new AppStoreServerAPIClient(
    key,
    row.key_id,
    row.issuer_id,
    app.identifier,
    environment === 'production' ? Environment.PRODUCTION : Environment.SANDBOX,
  );
}

function statusFromAppleServer(status: number | undefined, transaction: JWSTransactionDecodedPayload, autoRenews: boolean): BillingStatus {
  if (transaction.revocationDate || status === 5) return 'revoked';
  if (status === 2) return 'expired';
  if (status === 3) return 'billing_issue';
  if (status === 4) return 'grace_period';
  if (status === 1 && !autoRenews) return 'cancelled';
  if (transaction.offerType === 1) return 'trialing';
  return 'active';
}

function appleProductType(type: string | undefined): VerifiedPurchase['productType'] {
  if (type === 'Consumable') return 'consumable';
  if (type === 'Non-Consumable') return 'non_consumable';
  return 'subscription';
}

function appleStatus(transaction: JWSTransactionDecodedPayload, eventType = 'PURCHASED'): BillingStatus {
  if (transaction.revocationDate || /REFUND|REVOKE/i.test(eventType)) return /REFUND/i.test(eventType) ? 'refunded' : 'revoked';
  if (/EXPIRED/i.test(eventType)) return 'expired';
  if (/FAIL_TO_RENEW/i.test(eventType)) return 'billing_issue';
  if (/GRACE/i.test(eventType)) return 'grace_period';
  if (/CANCEL|DID_CHANGE_RENEWAL_STATUS/i.test(eventType)) return 'cancelled';
  if (transaction.offerType === 1) return 'trialing';
  return 'active';
}

export async function verifyAppleTransaction(env: Env, params: {
  projectId: string | number;
  customerId: string;
  signedTransaction: string;
  environment: BillingEnvironment;
  eventType?: string;
  allowTransfer?: boolean;
}) {
  const app = await applicationForProject(env.DB, params.projectId, 'ios');
  const verifier = await appleVerifier(env, app, params.environment);
  let transaction = await verifier.verifyAndDecodeTransaction(params.signedTransaction);
  if (!transaction.transactionId || !transaction.productId) throw new Error('Apple transaction is incomplete');
  if (!params.allowTransfer && transaction.appAccountToken !== params.customerId) {
    throw new Error('Apple transaction is not bound to the authenticated customer');
  }
  const client = await appleServerClient(env, app, params.environment);
  const { GetTransactionHistoryVersion, Order } = await loadAppleLibrary();
  const history = await client.getTransactionHistory(
    transaction.transactionId,
    null,
    { sort: Order.DESCENDING },
    GetTransactionHistoryVersion.V2,
  );
  if (history.bundleId !== app.identifier || (params.environment === 'production' && Number(history.appAppleId) !== app.appAppleId)) {
    throw new Error('App Store Server API returned a different application');
  }
  const historyTransactions = await Promise.all((history.signedTransactions || []).map((value) => verifier.verifyAndDecodeTransaction(value)));
  const matching = historyTransactions.filter((value) => value.originalTransactionId === transaction.originalTransactionId);
  if (!matching.some((value) => value.transactionId === transaction.transactionId)) throw new Error('Apple transaction is absent from server history');
  matching.sort((left, right) => Number(right.signedDate || right.purchaseDate || 0) - Number(left.signedDate || left.purchaseDate || 0));
  transaction = matching[0] || transaction;
  let serverStatus: number | undefined;
  let autoRenews = appleProductType(String(transaction.type || '')) === 'subscription';
  let renewal: Record<string, unknown> | null = null;
  if (autoRenews) {
    const statuses = await client.getAllSubscriptionStatuses(transaction.transactionId!);
    const latest = (statuses.data || []).flatMap((group) => group.lastTransactions || [])
      .find((item) => item.originalTransactionId === transaction.originalTransactionId);
    serverStatus = Number(latest?.status || 0) || undefined;
    if (latest?.signedTransactionInfo) transaction = await verifier.verifyAndDecodeTransaction(latest.signedTransactionInfo);
    if (latest?.signedRenewalInfo) {
      const decoded = await verifier.verifyAndDecodeRenewalInfo(latest.signedRenewalInfo);
      autoRenews = Number(decoded.autoRenewStatus) === 1;
      renewal = decoded as unknown as Record<string, unknown>;
    }
  }
  const eventType = params.eventType || (transaction.transactionReason === 'RENEWAL' ? 'RENEWAL' : 'PURCHASED');
  const purchase: VerifiedPurchase = {
    projectId: params.projectId,
    applicationId: app.applicationId,
    customerId: params.customerId,
    store: 'apple',
    environment: params.environment,
    storeProductId: transaction.productId!,
    productType: appleProductType(String(transaction.type || '')),
    storeTransactionId: transaction.transactionId!,
    originalTransactionId: transaction.originalTransactionId || transaction.transactionId,
    orderId: transaction.webOrderLineItemId || null,
    eventType,
    status: serverStatus ? statusFromAppleServer(serverStatus, transaction, autoRenews) : appleStatus(transaction, eventType),
    priceMicros: transaction.price === undefined ? null : Number(transaction.price) * 1000,
    currency: transaction.currency || null,
    quantity: transaction.quantity || 1,
    purchasedAt: isoMillis(transaction.purchaseDate),
    eventOccurredAt: new Date().toISOString(),
    expiresAt: isoMillis(transaction.expiresDate),
    autoRenews,
    periodType: transaction.offerType === 1 ? 'trial' : transaction.offerType ? 'intro' : 'normal',
    rawPayload: { transaction, server_history: history, renewal },
    transfer: params.allowTransfer === true,
  };
  return { purchase, transaction };
}

export async function verifyAppleNotification(env: Env, params: {
  projectId: string | number;
  signedPayload: string;
  environment: BillingEnvironment;
}): Promise<{ notification: ResponseBodyV2DecodedPayload; purchase: VerifiedPurchase | null }> {
  const app = await applicationForProject(env.DB, params.projectId, 'ios');
  const verifier = await appleVerifier(env, app, params.environment);
  const notification = await verifier.verifyAndDecodeNotification(params.signedPayload);
  const signedTransaction = notification.data?.signedTransactionInfo;
  if (!signedTransaction) return { notification, purchase: null };
  const transaction = await verifier.verifyAndDecodeTransaction(signedTransaction);
  if (!transaction.transactionId || !transaction.productId) throw new Error('Apple notification transaction is incomplete');
  const eventType = String(notification.notificationType || 'PURCHASED');
  const customerId = transaction.appAccountToken || null;
  return {
    notification,
    purchase: {
      projectId: params.projectId,
      applicationId: app.applicationId,
      customerId,
      store: 'apple',
      environment: params.environment,
      storeProductId: transaction.productId,
      productType: appleProductType(String(transaction.type || '')),
      storeTransactionId: transaction.transactionId,
      originalTransactionId: transaction.originalTransactionId || transaction.transactionId,
      orderId: transaction.webOrderLineItemId || null,
      eventType,
      status: appleStatus(transaction, eventType),
      priceMicros: transaction.price === undefined ? null : Number(transaction.price) * 1000,
      currency: transaction.currency || null,
      quantity: transaction.quantity || 1,
      purchasedAt: isoMillis(transaction.purchaseDate),
      eventOccurredAt: isoMillis(notification.signedDate),
      expiresAt: isoMillis(transaction.expiresDate),
      autoRenews: !/CANCEL|EXPIRED|REFUND|REVOKE/i.test(eventType),
      periodType: transaction.offerType === 1 ? 'trial' : transaction.offerType ? 'intro' : 'normal',
      rawPayload: { notification, transaction },
    },
  };
}

async function googleCredentials(env: Env, app: BillingApplication): Promise<GoogleCredentials> {
  const row = await env.DB.prepare(`
    SELECT encrypted_key
    FROM android_server_api_keys
    WHERE instance_id = ? OR android_configuration_id IN (
      SELECT id FROM android_configurations WHERE application_id = ?
    )
    ORDER BY updated_at DESC
    LIMIT 1
  `).bind(app.instanceId, app.applicationId).first<{ encrypted_key: string }>();
  const source = row?.encrypted_key || env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!source) throw new Error('Google Play service account is not configured');
  const clear = row?.encrypted_key ? await decryptCredential(env, source) : source;
  let parsed: Partial<GoogleCredentials>;
  try {
    parsed = JSON.parse(clear);
  } catch {
    throw new Error('Google Play service account is invalid');
  }
  if (!parsed.client_email || !parsed.private_key) throw new Error('Google Play service account is incomplete');
  return parsed as GoogleCredentials;
}

async function googleAccessToken(credentials: GoogleCredentials): Promise<string> {
  const tokenUri = credentials.token_uri || 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(credentials.private_key, 'RS256');
  const assertion = await new SignJWT({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }).setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).sign(key);
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== 'string') throw new Error('Unable to authenticate with Google Play');
  return payload.access_token;
}

function googleSubscriptionStatus(value: string): BillingStatus {
  const status: Record<string, BillingStatus> = {
    SUBSCRIPTION_STATE_PENDING: 'pending',
    SUBSCRIPTION_STATE_ACTIVE: 'active',
    SUBSCRIPTION_STATE_PAUSED: 'paused',
    SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'grace_period',
    SUBSCRIPTION_STATE_ON_HOLD: 'billing_issue',
    SUBSCRIPTION_STATE_CANCELED: 'cancelled',
    SUBSCRIPTION_STATE_EXPIRED: 'expired',
  };
  return status[value] || 'pending';
}

export async function verifyGooglePurchase(env: Env, params: {
  projectId: string | number;
  customerId: string | null;
  purchaseToken: string;
  storeProductId: string;
  productType: 'subscription' | 'non_consumable' | 'consumable';
  environment: BillingEnvironment;
  allowTransfer?: boolean;
}) {
  const app = await applicationForProject(env.DB, params.projectId, 'android');
  const credentials = await googleCredentials(env, app);
  const accessToken = await googleAccessToken(credentials);
  const packageName = encodeURIComponent(app.identifier);
  const token = encodeURIComponent(params.purchaseToken);
  const productId = encodeURIComponent(params.storeProductId);
  const url = params.productType === 'subscription'
    ? `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${token}`
    : `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/products/${productId}/tokens/${token}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const verified = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error('Google Play purchase verification failed');

  const lineItems = Array.isArray(verified.lineItems) ? verified.lineItems as Array<Record<string, unknown>> : [];
  const lineItem = lineItems.find((item) => item.productId === params.storeProductId) || lineItems[0] || {};
  const externalIdentifiers = verified.externalAccountIdentifiers as Record<string, unknown> | undefined;
  const boundCustomer = String(externalIdentifiers?.obfuscatedExternalAccountId || verified.obfuscatedExternalAccountId || '');
  if (!params.allowTransfer && (!params.customerId || boundCustomer !== params.customerId)) {
    throw new Error('Google Play purchase is not bound to the authenticated customer');
  }
  const effectiveCustomerId = params.customerId || (params.allowTransfer ? boundCustomer || null : null);
  const subscriptionState = String(verified.subscriptionState || '');
  const numericPurchaseState = Number(verified.purchaseState);
  const status: BillingStatus = params.productType === 'subscription'
    ? googleSubscriptionStatus(subscriptionState)
    : numericPurchaseState === 0 ? 'active' : numericPurchaseState === 2 ? 'pending' : 'revoked';
  const autoRenewingPlan = lineItem.autoRenewingPlan as Record<string, unknown> | undefined;
  const recurringPrice = autoRenewingPlan?.recurringPrice as Record<string, unknown> | undefined;
  const priceMicros = params.productType === 'subscription'
    ? Number(recurringPrice?.units || 0) * 1_000_000 + Math.round(Number(recurringPrice?.nanos || 0) / 1000)
    : Number(verified.priceAmountMicros || 0);
  const currency = params.productType === 'subscription'
    ? String(recurringPrice?.currencyCode || '')
    : String(verified.priceCurrencyCode || '');
  const orderId = String(verified.latestOrderId || verified.orderId || params.purchaseToken);
  const purchase: VerifiedPurchase = {
    projectId: params.projectId,
    applicationId: app.applicationId,
    customerId: effectiveCustomerId,
    store: 'google',
    environment: params.environment,
    storeProductId: String(lineItem.productId || params.storeProductId),
    productType: params.productType,
    storeTransactionId: orderId,
    originalTransactionId: String(verified.linkedPurchaseToken || params.purchaseToken),
    orderId,
    purchaseToken: params.purchaseToken,
    eventType: status === 'active' ? 'PURCHASED' : status.toUpperCase(),
    status,
    priceMicros: priceMicros > 0 ? priceMicros : null,
    currency: currency || null,
    quantity: Number(verified.quantity || 1),
    purchasedAt: typeof verified.startTime === 'string' ? verified.startTime : isoMillis(verified.purchaseTimeMillis),
    eventOccurredAt: new Date().toISOString(),
    expiresAt: typeof lineItem.expiryTime === 'string' ? lineItem.expiryTime : null,
    autoRenews: Boolean(autoRenewingPlan?.autoRenewEnabled),
    periodType: 'normal',
    rawPayload: verified,
    transfer: params.allowTransfer === true,
  };
  return { purchase, verified, accessToken, app };
}

export async function finalizeGooglePurchase(params: {
  purchase: VerifiedPurchase;
  verified: Record<string, unknown>;
  accessToken: string;
  app: BillingApplication;
}) {
  if (params.purchase.status !== 'active' && params.purchase.status !== 'trialing') return;
  const acknowledgement = String(params.verified.acknowledgementState || '');
  if (acknowledgement === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' || Number(params.verified.acknowledgementState) === 1) return;
  const packageName = encodeURIComponent(params.app.identifier);
  const token = encodeURIComponent(params.purchase.purchaseToken || '');
  const productId = encodeURIComponent(params.purchase.storeProductId);
  const url = params.purchase.productType === 'subscription'
    ? `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptions/${productId}/tokens/${token}:acknowledge`
    : params.purchase.productType === 'consumable'
      ? `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/products/${productId}/tokens/${token}:consume`
      : `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/products/${productId}/tokens/${token}:acknowledge`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error('Google Play purchase acknowledgement failed');
}

export async function reconcileAppleSubscription(env: Env, params: {
  projectId: string | number;
  customerId: string;
  transactionId: string;
  environment: BillingEnvironment;
}) {
  const app = await applicationForProject(env.DB, params.projectId, 'ios');
  const client = await appleServerClient(env, app, params.environment);
  const statuses = await client.getAllSubscriptionStatuses(params.transactionId);
  const latest = (statuses.data || []).flatMap((group) => group.lastTransactions || [])
    .find((item) => item.originalTransactionId === params.transactionId)
    || (statuses.data || []).flatMap((group) => group.lastTransactions || [])[0];
  if (!latest?.signedTransactionInfo) throw new Error('Apple subscription status has no transaction');
  const verified = await verifyAppleTransaction(env, {
    projectId: params.projectId,
    customerId: params.customerId,
    signedTransaction: latest.signedTransactionInfo,
    environment: params.environment,
    eventType: 'RECONCILIATION',
  });
  verified.purchase.eventType = `RECONCILIATION_${verified.purchase.status.toUpperCase()}`;
  return verified.purchase;
}

export async function testStoreCredentials(env: Env, params: {
  projectId: string | number;
  platform: 'ios' | 'android';
  environment: BillingEnvironment;
}) {
  const app = await applicationForProject(env.DB, params.projectId, params.platform);
  if (params.platform === 'ios') {
    const client = await appleServerClient(env, app, params.environment);
    const response = await client.requestTestNotification();
    return { platform: 'ios', valid: true, test_notification_token: response.testNotificationToken || null };
  }
  const credentials = await googleCredentials(env, app);
  await googleAccessToken(credentials);
  return { platform: 'android', valid: true, service_account: credentials.client_email };
}
