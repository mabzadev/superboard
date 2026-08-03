import { Buffer } from 'node:buffer';
import type {
  JWSTransactionDecodedPayload,
  ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';
import { importPKCS8, SignJWT } from 'jose';
import type { BillingEnv } from '../types';
import { BillingEnvironment, BillingStatus, VerifiedPurchase } from './billing';
import { decryptCredential } from './secrets';
import {
  googleBasePlanReadiness,
  parseAppleSubscriptionAvailability,
  type AppleSubscriptionAvailability,
} from './store-catalog-readiness';

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

export type StoreCatalogProduct = {
  applicationId: string;
  storeProductId: string;
  productType: 'subscription' | 'non_consumable' | 'consumable';
  displayName: string;
  description: string | null;
  active: boolean;
  metadata: Record<string, unknown>;
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

function appleRoots(env: BillingEnv): Buffer[] {
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

async function appleVerifier(env: BillingEnv, app: BillingApplication, environment: BillingEnvironment) {
  const { Environment, SignedDataVerifier } = await loadAppleLibrary();
  const appleEnvironment = environment === 'production' ? Environment.PRODUCTION : Environment.SANDBOX;
  if (environment === 'production' && !app.appAppleId) throw new Error('Apple App ID is required for production verification');
  return new SignedDataVerifier(
    appleRoots(env),
    // The official Node package performs online certificate checks through
    // node-fetch, which is not callable in Cloudflare Workers. Signature and
    // certificate-chain checks remain enabled; transaction state is then
    // confirmed against Apple's Server API below using the native fetch API.
    false,
    appleEnvironment,
    app.identifier,
    environment === 'production' ? app.appAppleId || undefined : undefined,
  );
}

async function appleServerClient(env: BillingEnv, app: BillingApplication, environment: BillingEnvironment) {
  const row = await appleApiCredentials(env, app);
  const token = await appleServerToken(row, app.identifier);
  const baseUrl = environment === 'production'
    ? 'https://api.storekit.apple.com'
    : 'https://api.storekit-sandbox.apple.com';
  const request = async (path: string, method = 'GET', body?: unknown): Promise<any> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw storeApiError('App Store Server API', response.status, payload);
    return payload;
  };
  return {
    requestTestNotification: () => request('/inApps/v1/notifications/test', 'POST'),
    getTransactionHistory: (transactionId: string, _revision: unknown, options: { sort?: unknown }, version: unknown) => {
      const query = options?.sort ? `?sort=${encodeURIComponent(String(options.sort))}` : '';
      return request(`/inApps/${encodeURIComponent(String(version))}/history/${encodeURIComponent(transactionId)}${query}`);
    },
    getAllSubscriptionStatuses: (transactionId: string) =>
      request(`/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`),
    sendConsumptionInformation: (transactionId: string, payload: AppleConsumptionRequest) =>
      request(`/inApps/v2/transactions/consumption/${encodeURIComponent(transactionId)}`, 'PUT', payload),
  };
}

export type AppleConsumptionRequest = {
  customerConsented: true;
  deliveryStatus: 'DELIVERED' | 'UNDELIVERED_QUALITY_ISSUE' | 'UNDELIVERED_WRONG_ITEM' | 'UNDELIVERED_SERVER_OUTAGE' | 'UNDELIVERED_OTHER';
  sampleContentProvided: boolean;
  consumptionPercentage?: number;
  refundPreference?: 'DECLINE' | 'GRANT_FULL' | 'GRANT_PRORATED';
};

export async function sendAppleConsumptionInformation(env: BillingEnv, params: {
  projectId: string;
  environment: BillingEnvironment;
  transactionId: string;
  payload: AppleConsumptionRequest;
}) {
  const app = await applicationForProject(env.DB, params.projectId, 'ios');
  const client = await appleServerClient(env, app, params.environment);
  await client.sendConsumptionInformation(params.transactionId, params.payload);
  return { accepted: true, transaction_id: params.transactionId };
}

async function appleApiCredentials(env: BillingEnv, app: BillingApplication) {
  const row = await env.DB.prepare(`
    SELECT encrypted_key, billing_encrypted_key, key_id, issuer_id
    FROM ios_server_api_keys
    WHERE instance_id = ? OR ios_configuration_id IN (
      SELECT id FROM ios_configurations WHERE application_id = ?
    )
    ORDER BY updated_at DESC LIMIT 1
  `).bind(app.instanceId, app.applicationId).first<{ encrypted_key: string; billing_encrypted_key: string | null; key_id: string; issuer_id: string }>();
  const encryptedKey = env.CREDENTIAL_KEY_SCOPE === 'billing' ? row?.billing_encrypted_key : row?.encrypted_key;
  if (!encryptedKey || !row?.key_id || !row.issuer_id) throw new Error('App Store Server API credentials are not configured for this execution domain');
  return {
    key: await decryptCredential(env, encryptedKey),
    keyId: row.key_id,
    issuerId: row.issuer_id,
  };
}

async function appleServerToken(
  credentials: { key: string; keyId: string; issuerId: string },
  bundleId: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(credentials.key, 'ES256');
  return new SignJWT({
    iss: credentials.issuerId,
    aud: 'appstoreconnect-v1',
    bid: bundleId,
    iat: now,
    exp: now + 5 * 60,
  }).setProtectedHeader({ alg: 'ES256', kid: credentials.keyId, typ: 'JWT' }).sign(key);
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

export async function verifyAppleTransaction(env: BillingEnv, params: {
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
  const historyTransactions = await Promise.all((history.signedTransactions || []).map((value: string) => verifier.verifyAndDecodeTransaction(value)));
  const matching = historyTransactions.filter((value) => value.originalTransactionId === transaction.originalTransactionId);
  if (!matching.some((value) => value.transactionId === transaction.transactionId)) throw new Error('Apple transaction is absent from server history');
  matching.sort((left, right) => Number(right.signedDate || right.purchaseDate || 0) - Number(left.signedDate || left.purchaseDate || 0));
  transaction = matching[0] || transaction;
  let serverStatus: number | undefined;
  let autoRenews = appleProductType(String(transaction.type || '')) === 'subscription';
  let renewal: Record<string, unknown> | null = null;
  if (autoRenews) {
    const statuses = await client.getAllSubscriptionStatuses(transaction.transactionId!);
    const latest = (statuses.data || []).flatMap((group: { lastTransactions?: Array<Record<string, any>> }) => group.lastTransactions || [])
      .find((item: Record<string, any>) => item.originalTransactionId === transaction.originalTransactionId);
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

export async function verifyAppleNotification(env: BillingEnv, params: {
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

async function googleCredentials(env: BillingEnv, app: BillingApplication): Promise<GoogleCredentials> {
  const row = await env.DB.prepare(`
    SELECT encrypted_key, billing_encrypted_key
    FROM android_server_api_keys
    WHERE instance_id = ? OR android_configuration_id IN (
      SELECT id FROM android_configurations WHERE application_id = ?
    )
    ORDER BY updated_at DESC
    LIMIT 1
  `).bind(app.instanceId, app.applicationId).first<{ encrypted_key: string; billing_encrypted_key: string | null }>();
  const encryptedKey = env.CREDENTIAL_KEY_SCOPE === 'billing' ? row?.billing_encrypted_key : row?.encrypted_key;
  const source = encryptedKey || (env.CREDENTIAL_KEY_SCOPE === 'billing' ? null : env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  if (!source) throw new Error('Google Play service account is not configured');
  const clear = encryptedKey ? await decryptCredential(env, source) : source;
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

function storeApiError(store: string, status: number, payload: Record<string, unknown>): Error {
  const errors = Array.isArray(payload.errors) ? payload.errors as Array<Record<string, unknown>> : [];
  const first = errors[0] || {};
  const nested = payload.error && typeof payload.error === 'object'
    ? payload.error as Record<string, unknown>
    : {};
  if (store === 'App Store Server API' && status === 401) {
    return new Error('Apple rejected the server key. Upload an In-App Purchase key from Users and Access > Integrations > In-App Purchase.');
  }
  const message = String(
    first.detail || first.title || nested.message || payload.errorMessage || payload.message || `${store} API returned HTTP ${status}`,
  );
  return new Error(`${store}: ${message}`);
}

async function fetchStoreJson(url: string, accessToken: string, store: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw storeApiError(store, response.status, payload);
  return payload;
}

async function appleConnectToken(env: BillingEnv, app: BillingApplication): Promise<string> {
  const credentials = await appleApiCredentials(env, app);
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(credentials.key, 'ES256');
  return new SignJWT({
    iss: credentials.issuerId,
    aud: 'appstoreconnect-v1',
    iat: now,
    exp: now + 19 * 60,
  }).setProtectedHeader({ alg: 'ES256', kid: credentials.keyId, typ: 'JWT' }).sign(key);
}

function appleProduct(resource: Record<string, unknown>, applicationId: string): StoreCatalogProduct | null {
  const attributes = resource.attributes && typeof resource.attributes === 'object'
    ? resource.attributes as Record<string, unknown>
    : {};
  const storeProductId = String(attributes.productId || '').trim();
  if (!storeProductId) return null;
  const rawType = String(attributes.inAppPurchaseType || '').toUpperCase();
  const state = String(attributes.state || '').toUpperCase();
  return {
    applicationId,
    storeProductId,
    productType: rawType.includes('CONSUMABLE') && !rawType.includes('NON_CONSUMABLE')
      ? 'consumable'
      : rawType.includes('SUBSCRIPTION')
        ? 'subscription'
        : 'non_consumable',
    displayName: String(attributes.referenceName || attributes.name || storeProductId),
    description: null,
    active: !state.includes('REMOVED') && !state.includes('REJECTED'),
    metadata: {
      source: 'app_store_connect',
      store_resource_id: resource.id || null,
      state: attributes.state || null,
      in_app_purchase_type: attributes.inAppPurchaseType || null,
    },
  };
}

function appleSubscription(
  resource: Record<string, unknown>,
  applicationId: string,
  availability: AppleSubscriptionAvailability,
): StoreCatalogProduct | null {
  const attributes = resource.attributes && typeof resource.attributes === 'object'
    ? resource.attributes as Record<string, unknown>
    : {};
  const storeProductId = String(attributes.productId || '').trim();
  if (!storeProductId) return null;
  const state = String(attributes.state || '').toUpperCase();
  const providerApproved = state === 'APPROVED';
  const providerAvailable = availability.planCount > 0 && availability.availableTerritoryCount > 0;
  const providerPurchasable = providerApproved
    && providerAvailable;
  return {
    applicationId,
    storeProductId,
    productType: 'subscription',
    displayName: String(attributes.name || storeProductId),
    description: null,
    active: !state.includes('REMOVED') && !state.includes('REJECTED'),
    metadata: {
      source: 'app_store_connect',
      store_resource_id: resource.id || null,
      state: attributes.state || null,
      provider_approved: providerApproved,
      provider_available: providerAvailable,
      provider_purchasable: providerPurchasable,
      plan_count: availability.planCount,
      available_territory_count: availability.availableTerritoryCount,
      available_in_new_territories: availability.availableInNewTerritories,
      subscription_period: attributes.subscriptionPeriod || null,
      family_sharable: attributes.familySharable || false,
    },
  };
}

async function appleSubscriptionAvailability(
  resource: Record<string, unknown>,
  token: string,
): Promise<AppleSubscriptionAvailability> {
  const resourceId = String(resource.id || '').trim();
  if (!resourceId) return { planCount: 0, availableTerritoryCount: 0, availableInNewTerritories: false };
  const payload = await fetchStoreJson(
    `https://api.appstoreconnect.apple.com/v1/subscriptions/${encodeURIComponent(resourceId)}/planAvailabilities?include=availableTerritories&limit=200&limit%5BavailableTerritories%5D=1`,
    token,
    'App Store Connect',
  );
  return parseAppleSubscriptionAvailability(payload);
}

async function appleCollection(url: string, token: string): Promise<Record<string, unknown>[]> {
  const values: Record<string, unknown>[] = [];
  let next: string | null = url;
  while (next) {
    const payload = await fetchStoreJson(next, token, 'App Store Connect');
    if (Array.isArray(payload.data)) values.push(...payload.data as Record<string, unknown>[]);
    const links = payload.links && typeof payload.links === 'object' ? payload.links as Record<string, unknown> : {};
    next = typeof links.next === 'string' && links.next ? links.next : null;
  }
  return values;
}

async function syncAppleCatalog(env: BillingEnv, projectId: string | number): Promise<StoreCatalogProduct[]> {
  const app = await applicationForProject(env.DB, projectId, 'ios');
  const token = await appleConnectToken(env, app);
  const appsPayload = await fetchStoreJson(
    `https://api.appstoreconnect.apple.com/v1/apps?filter%5BbundleId%5D=${encodeURIComponent(app.identifier)}&limit=2`,
    token,
    'App Store Connect',
  );
  const apps = Array.isArray(appsPayload.data) ? appsPayload.data as Record<string, unknown>[] : [];
  const matchingApp = apps.find((item) => {
    const attributes = item.attributes && typeof item.attributes === 'object'
      ? item.attributes as Record<string, unknown>
      : {};
    return attributes.bundleId === app.identifier;
  });
  const resolvedAppId = String(matchingApp?.id || '').trim();
  if (!resolvedAppId) throw new Error(`App Store Connect: no app found for bundle ID ${app.identifier}`);
  if (String(app.appAppleId || '') !== resolvedAppId) {
    await env.DB.prepare(`
      UPDATE ios_configurations SET app_apple_id = ?, updated_at = datetime('now')
      WHERE application_id = ?
    `).bind(resolvedAppId, app.applicationId).run();
  }
  const appId = encodeURIComponent(resolvedAppId);
  const oneTime = await appleCollection(
    `https://api.appstoreconnect.apple.com/v1/apps/${appId}/inAppPurchasesV2?limit=200`,
    token,
  );
  const groupPayload = await fetchStoreJson(
    `https://api.appstoreconnect.apple.com/v1/apps/${appId}/subscriptionGroups?include=subscriptions&limit=200&limit%5Bsubscriptions%5D=50`,
    token,
    'App Store Connect',
  );
  const included = Array.isArray(groupPayload.included)
    ? groupPayload.included as Record<string, unknown>[]
    : [];
  const subscriptions = included.filter((item) => item.type === 'subscriptions');
  const subscriptionProducts: StoreCatalogProduct[] = [];
  for (const subscription of subscriptions) {
    const availability = await appleSubscriptionAvailability(subscription, token);
    const product = appleSubscription(subscription, app.applicationId, availability);
    if (product) subscriptionProducts.push(product);
  }
  return [
    ...oneTime.map((item) => appleProduct(item, app.applicationId)),
    ...subscriptionProducts,
  ].filter((item): item is StoreCatalogProduct => item !== null);
}

export async function appStoreConnectAccess(env: BillingEnv, projectId: string | number) {
  const app = await applicationForProject(env.DB, projectId, 'ios');
  const token = await appleConnectToken(env, app);
  const appsPayload = await fetchStoreJson(
    `https://api.appstoreconnect.apple.com/v1/apps?filter%5BbundleId%5D=${encodeURIComponent(app.identifier)}&limit=2`,
    token,
    'App Store Connect',
  );
  const apps = Array.isArray(appsPayload.data) ? appsPayload.data as Record<string, unknown>[] : [];
  const matching = apps.find((item) => {
    const attributes = item.attributes && typeof item.attributes === 'object' ? item.attributes as Record<string, unknown> : {};
    return attributes.bundleId === app.identifier;
  });
  if (!matching?.id) throw new Error(`App Store Connect: no app found for bundle ID ${app.identifier}`);
  return { token, appId: String(matching.id), bundleId: app.identifier };
}

export async function googlePlayAccess(env: BillingEnv, projectId: string | number) {
  const app = await applicationForProject(env.DB, projectId, 'android');
  const credentials = await googleCredentials(env, app);
  return { token: await googleAccessToken(credentials), packageName: app.identifier };
}

function localizedListing(value: unknown): { title?: string; description?: string } {
  if (Array.isArray(value)) {
    const listing = value.find((item) => item && typeof item === 'object') as Record<string, unknown> | undefined;
    return listing ? { title: String(listing.title || ''), description: String(listing.description || '') } : {};
  }
  if (value && typeof value === 'object') {
    const listings = Object.values(value as Record<string, unknown>);
    const listing = listings.find((item) => item && typeof item === 'object') as Record<string, unknown> | undefined;
    return listing ? { title: String(listing.title || ''), description: String(listing.description || '') } : {};
  }
  return {};
}

async function googleCollection(
  baseUrl: string,
  token: string,
  responseKey: string,
): Promise<Record<string, unknown>[]> {
  const values: Record<string, unknown>[] = [];
  let pageToken = '';
  do {
    const separator = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${separator}pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const payload = await fetchStoreJson(url, token, 'Google Play');
    if (Array.isArray(payload[responseKey])) values.push(...payload[responseKey] as Record<string, unknown>[]);
    pageToken = typeof payload.nextPageToken === 'string' ? payload.nextPageToken : '';
  } while (pageToken);
  return values;
}

async function syncGoogleCatalog(env: BillingEnv, projectId: string | number): Promise<StoreCatalogProduct[]> {
  const app = await applicationForProject(env.DB, projectId, 'android');
  const credentials = await googleCredentials(env, app);
  const token = await googleAccessToken(credentials);
  const packageName = encodeURIComponent(app.identifier);
  const root = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}`;
  const [subscriptions, oneTimeProducts] = await Promise.all([
    googleCollection(`${root}/subscriptions`, token, 'subscriptions'),
    googleCollection(`${root}/oneTimeProducts`, token, 'oneTimeProducts'),
  ]);
  return [
    ...subscriptions.map((item): StoreCatalogProduct | null => {
      const storeProductId = String(item.productId || '').trim();
      if (!storeProductId) return null;
      const listing = localizedListing(item.listings);
      const basePlans = Array.isArray(item.basePlans) ? item.basePlans as Array<Record<string, unknown>> : [];
      const basePlanReadiness = basePlans.map(googleBasePlanReadiness);
      const providerApproved = item.archived !== true
        && basePlanReadiness.some((plan) => String(plan.state || '').toUpperCase() === 'ACTIVE');
      const providerAvailable = item.archived !== true
        && basePlanReadiness.some((plan) => plan.newSubscriberAvailable);
      const providerPurchasable = providerApproved && basePlanReadiness.some((plan) =>
        String(plan.state || '').toUpperCase() === 'ACTIVE' && plan.newSubscriberAvailable);
      return {
        applicationId: app.applicationId,
        storeProductId,
        productType: 'subscription',
        displayName: listing.title || storeProductId,
        description: listing.description || null,
        active: item.archived !== true && providerApproved,
        metadata: {
          source: 'google_play',
          archived: item.archived === true,
          provider_approved: providerApproved,
          provider_available: providerAvailable,
          provider_purchasable: providerPurchasable,
          base_plans: basePlanReadiness.map((plan) => ({
            base_plan_id: plan.basePlanId,
            state: plan.state,
            billing_period: plan.billingPeriod,
            available_region_count: plan.availableRegionCount,
            available_in_other_regions: plan.availableInOtherRegions,
            new_subscriber_available: plan.newSubscriberAvailable,
          })),
        },
      };
    }),
    ...oneTimeProducts.map((item): StoreCatalogProduct | null => {
      const storeProductId = String(item.productId || '').trim();
      if (!storeProductId) return null;
      const listing = localizedListing(item.listings);
      const purchaseOptions = Array.isArray(item.purchaseOptions) ? item.purchaseOptions as Array<Record<string, unknown>> : [];
      return {
        applicationId: app.applicationId,
        storeProductId,
        // Google does not distinguish consumable from non-consumable in its catalog.
        // The upsert preserves an existing consumable classification when present.
        productType: 'non_consumable',
        displayName: listing.title || storeProductId,
        description: listing.description || null,
        active: purchaseOptions.length === 0 || purchaseOptions.some((option) => String(option.state || '').toUpperCase() === 'ACTIVE'),
        metadata: {
          source: 'google_play',
          purchase_options: purchaseOptions.map((option) => ({ purchase_option_id: option.purchaseOptionId || null, state: option.state || null })),
        },
      };
    }),
  ].filter((item): item is StoreCatalogProduct => item !== null);
}

export async function fetchStoreCatalog(env: BillingEnv, params: {
  projectId: string | number;
  platform: 'ios' | 'android';
}): Promise<StoreCatalogProduct[]> {
  return params.platform === 'ios'
    ? syncAppleCatalog(env, params.projectId)
    : syncGoogleCatalog(env, params.projectId);
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

export async function verifyGooglePurchase(env: BillingEnv, params: {
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

export async function reconcileAppleSubscription(env: BillingEnv, params: {
  projectId: string | number;
  customerId: string;
  transactionId: string;
  environment: BillingEnvironment;
}) {
  const app = await applicationForProject(env.DB, params.projectId, 'ios');
  const client = await appleServerClient(env, app, params.environment);
  const statuses = await client.getAllSubscriptionStatuses(params.transactionId);
  const latest = (statuses.data || []).flatMap((group: { lastTransactions?: Array<Record<string, any>> }) => group.lastTransactions || [])
    .find((item: Record<string, any>) => item.originalTransactionId === params.transactionId)
    || (statuses.data || []).flatMap((group: { lastTransactions?: Array<Record<string, any>> }) => group.lastTransactions || [])[0];
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

export async function testStoreCredentials(env: BillingEnv, params: {
  projectId: string | number;
  platform: 'ios' | 'android';
  environment: BillingEnvironment;
}) {
  if (params.platform === 'ios') {
    const products = await syncAppleCatalog(env, params.projectId);
    return { platform: 'ios', valid: true, catalog_products: products.length };
  }
  const app = await applicationForProject(env.DB, params.projectId, 'android');
  const credentials = await googleCredentials(env, app);
  const products = await syncGoogleCatalog(env, params.projectId);
  return { platform: 'android', valid: true, service_account: credentials.client_email, catalog_products: products.length };
}
