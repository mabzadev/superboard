import { DELETE, GET, PATCH, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";

export interface BillingProduct {
  id: string;
  store: "apple" | "google" | "stripe";
  store_product_id: string;
  product_type: string;
  display_name: string;
  environment: string;
  active: number;
}

export interface BillingEntitlement {
  id: string;
  identifier: string;
  display_name: string;
  active: number;
}

export interface BillingOffering {
  id: string;
  identifier: string;
  display_name: string;
  is_current: number;
}

export interface BillingPackage {
  id: string;
  offering_id: string;
  identifier: string;
  package_type: string;
  position: number;
  product_ids: string[];
}

export interface BillingProductEntitlement {
  product_id: string;
  entitlement_id: string;
}

export interface BillingOverview {
  settings?: { purchases_enabled: number; restore_behavior: string };
  products: BillingProduct[];
  entitlements: BillingEntitlement[];
  offerings: BillingOffering[];
  packages: BillingPackage[];
  product_entitlements: BillingProductEntitlement[];
  metrics?: { revenue_micros: number; paying_customers: number; trials: number; refunds: number };
  credentials?: {
    ios: {
      configured: boolean;
      key_id?: string | null;
      app_apple_id?: string | null;
      bundle_id?: string | null;
      filename?: string | null;
    };
    android: {
      configured: boolean;
      client_email?: string | null;
      project_id?: string | null;
      package_name?: string | null;
      filename?: string | null;
    };
  };
}

export const getBillingOverview = async (projectId: string): Promise<BillingOverview> =>
  (await GET(config.apiPath + `/billing/${projectId}`)).data;

export const updateBillingSettings = async (projectId: string, data: { purchases_enabled: boolean; restore_behavior: string }) =>
  (await PUT(config.apiPath + `/billing/${projectId}/settings`, data)).data;

export const createEntitlement = async (projectId: string, data: { identifier: string; display_name: string }) =>
  (await POST(config.apiPath + `/billing/${projectId}/entitlements`, data)).data;

export const mapBillingProductsToEntitlement = async (projectId: string, entitlementId: string, productIds: string[]) =>
  (await POST(config.apiPath + `/billing/${projectId}/entitlements/${entitlementId}/products`, { product_ids: productIds })).data;

export const createProduct = async (projectId: string, data: Record<string, unknown>) =>
  (await POST(config.apiPath + `/billing/${projectId}/products`, data)).data;

export interface BillingStoreSyncResult {
  stores: Array<{
    ok: boolean;
    platform: "ios" | "android";
    store: "apple" | "google";
    imported?: number;
    error?: string;
  }>;
}

export const syncBillingProducts = async (projectId: string): Promise<BillingStoreSyncResult> =>
  (await POST(config.apiPath + `/billing/${projectId}/products/sync`, {})).data;

export const createOffering = async (projectId: string, data: Record<string, unknown>) =>
  (await POST(config.apiPath + `/billing/${projectId}/offerings`, data)).data;

export const createBillingPackage = async (projectId: string, offeringId: string, data: Record<string, unknown>) =>
  (await POST(config.apiPath + `/billing/${projectId}/offerings/${offeringId}/packages`, data)).data;

export const searchBillingCustomers = async (projectId: string, query: string) =>
  (await GET(purchasesV2Path(projectId, `/customers?q=${encodeURIComponent(query)}&limit=100`))).data;

export const testBillingCredentials = async (projectId: string, platform: "ios" | "android") =>
  (await POST(config.apiPath + `/billing/${projectId}/credentials/test`, { platform })).data;

const purchasesV2Path = (projectId: string, resource = "") => {
  const apiV2 = config.apiPath.replace(/\/v1\/?$/, "/v2");
  return `${apiV2}/purchases/projects/${projectId}${resource}`;
};

export type BillingCapability = {
  status: "available" | "connected" | "needs_test" | "not_configured" | "unsupported" | "request_only" | string;
  message?: string;
};

export type BillingConnection = {
  id: string;
  provider: string;
  environment: "sandbox" | "production";
  display_name: string;
  status: string;
  capabilities: Record<string, BillingCapability>;
  public_configuration?: Record<string, unknown>;
  last_tested_at?: string | null;
  last_synced_at?: string | null;
  last_event_at?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
};

export type BillingTransaction = {
  id: string;
  store: string;
  environment: string;
  store_transaction_id: string;
  event_type: string;
  status: string;
  price_micros?: number | null;
  currency?: string | null;
  purchased_at?: string | null;
  created_at: string;
  store_product_id?: string | null;
  product_name?: string | null;
  primary_app_user_id?: string | null;
};

export type BillingSubscription = {
  id: string;
  store: string;
  environment: string;
  status: string;
  period_type: string;
  starts_at?: string | null;
  expires_at?: string | null;
  will_renew: number;
  updated_at: string;
  store_product_id?: string | null;
  product_name?: string | null;
  primary_app_user_id?: string | null;
};

export type BillingPaywall = {
  id: string;
  identifier: string;
  display_name: string;
  offering_id?: string | null;
  offering_identifier?: string | null;
  active_version_id?: string | null;
  active_version?: number | null;
  active: number;
  updated_at: string;
};

export type BillingPlacement = {
  id: string;
  identifier: string;
  display_name: string;
  description?: string | null;
  default_offering_id?: string | null;
  default_offering_identifier?: string | null;
  active: number;
};

export type BillingTargetingRule = {
  id: string;
  display_name: string;
  priority: number;
  state: string;
  conditions: Array<Record<string, unknown>>;
  placement_identifier: string;
  offering_identifier: string;
};

export type BillingExperiment = {
  id: string;
  display_name: string;
  state: string;
  placement_identifier: string;
  variants: Array<Record<string, unknown>>;
  metrics: Array<Record<string, unknown>>;
};

export type BillingAnalytics = {
  range_days: number;
  summary?: Record<string, number>;
  series: Array<Record<string, unknown>>;
  paywall_funnel: Array<{ event_type: string; count: number }>;
  stores: Array<Record<string, unknown>>;
};

export type BillingHealth = {
  status: "healthy" | "degraded";
  events?: Record<string, unknown>;
  subscriptions?: Record<string, unknown>;
  deliveries?: Record<string, unknown>;
  connections?: Array<Record<string, unknown>>;
  features?: Record<string, unknown>;
};

export type BillingReleaseGate = {
  environments: Array<"sandbox" | "production">;
  scope: { releaseProjectId: string; testProjectId: string; productionProjectId: string };
  ready: boolean;
  publication_allowed: boolean;
  legacy_dependency_removal_allowed: boolean;
  progress: { passed: number; total: number };
  prerequisites: Array<{ key: string; label: string; passed: boolean; detail: string }>;
  checks: Array<{
    key: string;
    provider: "apple" | "google" | "stripe" | "cross_platform";
    group: string;
    label: string;
    description: string;
    required_evidence: Array<"build" | "device" | "reference">;
    reference_types: BillingCertificationReferenceType[];
    status: "pending" | "passed" | "failed";
    evidence: Record<string, unknown>;
    evidence_valid: boolean;
    missing_evidence: string[];
    certified: boolean;
    notes?: string | null;
    verified_by?: string | null;
    verified_at?: string | null;
  }>;
  blockers: Array<{ type: "prerequisite" | "check"; key: string; message: string }>;
};

export type BillingCertificationReferenceType =
  | "billing_transaction"
  | "billing_event"
  | "paywall_event"
  | "legacy_inventory"
  | "test_run";

export type BillingCertificationRun = {
  id: string;
  release_project_id: string;
  target_project_id: string;
  environment: "sandbox" | "production";
  platform: "ios" | "android" | "web" | "cross_platform";
  build_number: string;
  app_version?: string | null;
  sdk_version?: string | null;
  device_model?: string | null;
  os_version?: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  notes?: string | null;
  started_at: string;
  completed_at?: string | null;
  observation_count: number;
  passed_count: number;
  failed_count: number;
};

export type BillingCertificationRuns = {
  runs: BillingCertificationRun[];
  observations: Array<Record<string, unknown>>;
};

export type BillingLegacyInventory = {
  source: {
    id: string;
    provider: "revenuecat";
    external_project_id: string;
    status: "configured" | "connected" | "error" | "disabled";
    last_tested_at?: string | null;
    last_error_code?: string | null;
    last_error_message?: string | null;
  } | null;
  runs: Array<{
    id: string;
    environment: "sandbox" | "production";
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    customers_scanned: number;
    active_subscriptions: number;
    matched_subscriptions: number;
    unresolved_subscriptions: number;
    unsupported_subscriptions: number;
    last_error_message?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    created_at: string;
  }>;
  unresolved: Array<{
    external_customer_id: string;
    external_subscription_id: string;
    app_user_id?: string | null;
    provider: "apple" | "google" | "stripe" | "unsupported";
    environment: "sandbox" | "production";
    store_product_id?: string | null;
    source_status?: string | null;
    source_expires_at?: string | null;
    resolution_status: string;
    resolution_detail?: string | null;
  }>;
};

export type BillingRefundCase = {
  id: string;
  provider: "apple" | "google" | "stripe";
  environment: "sandbox" | "production";
  provider_case_id: string;
  case_type: string;
  status: string;
  reason?: string | null;
  amount_micros?: number | null;
  currency?: string | null;
  deadline_at?: string | null;
  primary_app_user_id?: string | null;
  store_product_id?: string | null;
  evidence_count?: number;
  actions_requiring_approval?: number;
  updated_at: string;
};

export type BillingRefundCaseDetail = {
  refund_case: BillingRefundCase;
  evidence: Array<Record<string, any>>;
  actions: Array<Record<string, any>>;
  deadlines: Array<Record<string, any>>;
  audit_events: Array<Record<string, any>>;
  action_definitions: Array<{
    action_type: string;
    default_payload: Record<string, unknown>;
    recommended_evidence_type: string;
  }>;
};

export const getBillingConnections = async (projectId: string): Promise<{ data: BillingConnection[] }> =>
  (await GET(purchasesV2Path(projectId, "/connections"))).data;

export const testBillingConnection = async (projectId: string, provider: string, environment: string) =>
  (await POST(purchasesV2Path(projectId, `/connections/${provider}/test`), { environment })).data;

export const createBillingConnection = async (projectId: string, data: Record<string, unknown>) =>
  (await POST(purchasesV2Path(projectId, "/connections"), data)).data;

export const createBillingProviderProduct = async (projectId: string, data: Record<string, unknown>) =>
  (await POST(purchasesV2Path(projectId, "/provider-products"), data)).data;

export const getBillingTransactions = async (projectId: string): Promise<{ data: BillingTransaction[]; next_cursor?: string | null }> =>
  (await GET(purchasesV2Path(projectId, "/transactions?limit=100"))).data;

export const getBillingSubscriptions = async (projectId: string): Promise<{ data: BillingSubscription[] }> =>
  (await GET(purchasesV2Path(projectId, "/subscriptions?limit=100"))).data;

export const getBillingPaywalls = async (projectId: string): Promise<{ data: BillingPaywall[] }> =>
  (await GET(purchasesV2Path(projectId, "/paywalls"))).data;

export const createBillingPaywall = async (projectId: string, data: Record<string, unknown>) =>
  (await POST(purchasesV2Path(projectId, "/paywalls"), data)).data;

export const getBillingPaywallVersions = async (projectId: string, paywallId: string) =>
  (await GET(purchasesV2Path(projectId, `/paywalls/${paywallId}/versions`))).data;

export const createBillingPaywallVersion = async (projectId: string, paywallId: string, data: Record<string, unknown>) =>
  (await POST(purchasesV2Path(projectId, `/paywalls/${paywallId}/versions`), data)).data;

export const publishBillingPaywall = async (projectId: string, paywallId: string, versionId: string) =>
  (await POST(purchasesV2Path(projectId, `/paywalls/${paywallId}/publish`), { version_id: versionId })).data;

export const getBillingPlacements = async (projectId: string): Promise<{ data: BillingPlacement[] }> =>
  (await GET(purchasesV2Path(projectId, "/placements"))).data;

export const createBillingPlacement = async (projectId: string, data: Record<string, unknown>) =>
  (await POST(purchasesV2Path(projectId, "/placements"), data)).data;

export const updateBillingPlacement = async (projectId: string, placementId: string, data: Record<string, unknown>) =>
  (await PATCH(purchasesV2Path(projectId, `/placements/${placementId}`), data)).data;

export const getBillingTargeting = async (projectId: string): Promise<{ data: BillingTargetingRule[] }> =>
  (await GET(purchasesV2Path(projectId, "/targeting"))).data;

export const createBillingTargetingRule = async (projectId: string, data: Record<string, unknown>) =>
  (await POST(purchasesV2Path(projectId, "/targeting"), data)).data;

export const updateBillingTargetingRule = async (projectId: string, id: string, data: Record<string, unknown>) =>
  (await PATCH(purchasesV2Path(projectId, `/targeting/${id}`), data)).data;

export const getBillingExperiments = async (projectId: string): Promise<{ data: BillingExperiment[] }> =>
  (await GET(purchasesV2Path(projectId, "/experiments"))).data;

export const createBillingExperiment = async (projectId: string, data: Record<string, unknown>) =>
  (await POST(purchasesV2Path(projectId, "/experiments"), data)).data;

export const updateBillingExperiment = async (projectId: string, id: string, data: Record<string, unknown>) =>
  (await PATCH(purchasesV2Path(projectId, `/experiments/${id}`), data)).data;

export const getBillingAnalytics = async (projectId: string): Promise<BillingAnalytics> =>
  (await GET(purchasesV2Path(projectId, "/analytics?days=30"))).data;

export const getBillingHealth = async (projectId: string): Promise<BillingHealth> =>
  (await GET(purchasesV2Path(projectId, "/health"))).data;

export const getBillingReleaseGate = async (projectId: string): Promise<BillingReleaseGate> =>
  (await GET(purchasesV2Path(projectId, "/release-gate"))).data.data;

export const updateBillingReleaseGateCheck = async (
  projectId: string,
  checkKey: string,
  data: { status: "pending" | "passed" | "failed"; evidence?: Record<string, unknown>; notes?: string },
) => (await PATCH(purchasesV2Path(projectId, `/release-gate/checks/${encodeURIComponent(checkKey)}`), data)).data.data;

export const getBillingCertificationRuns = async (projectId: string): Promise<BillingCertificationRuns> =>
  (await GET(purchasesV2Path(projectId, "/certification-runs"))).data.data;

export const createBillingCertificationRun = async (
  projectId: string,
  data: Record<string, unknown>,
): Promise<BillingCertificationRun> =>
  (await POST(purchasesV2Path(projectId, "/certification-runs"), data)).data.data;

export const completeBillingCertificationRun = async (
  projectId: string,
  runId: string,
  status: "completed" | "failed" | "cancelled",
) => (await PATCH(purchasesV2Path(projectId, `/certification-runs/${runId}`), { status })).data.data;

export const recordBillingCertificationObservation = async (
  projectId: string,
  runId: string,
  data: {
    check_key: string;
    outcome: "passed" | "failed";
    reference_type: BillingCertificationReferenceType;
    reference_id: string;
    notes?: string;
  },
) => (await POST(purchasesV2Path(projectId, `/certification-runs/${runId}/observations`), data)).data.data;

export const getBillingLegacyInventory = async (projectId: string): Promise<BillingLegacyInventory> =>
  (await GET(purchasesV2Path(projectId, "/legacy/revenuecat/inventory"))).data.data;

export const configureBillingLegacySource = async (
  projectId: string,
  data: { external_project_id: string; api_key: string },
) => (await POST(purchasesV2Path(projectId, "/legacy/revenuecat/connections"), data)).data.data;

export const testBillingLegacySource = async (projectId: string) =>
  (await POST(purchasesV2Path(projectId, "/legacy/revenuecat/connection-test"), {})).data.data;

export const disableBillingLegacySource = async (projectId: string) =>
  (await DELETE(purchasesV2Path(projectId, "/legacy/revenuecat/connection"))).data.data;

export const startBillingLegacyInventory = async (
  projectId: string,
  environment: "sandbox" | "production" = "production",
) => (await POST(purchasesV2Path(projectId, "/legacy/revenuecat/inventory-runs"), { environment })).data.data;

export const getBillingWebhookDeliveries = async (projectId: string) =>
  (await GET(purchasesV2Path(projectId, "/integrations/deliveries?limit=100"))).data;

export const replayBillingWebhookDelivery = async (projectId: string, deliveryId: string) =>
  (await POST(purchasesV2Path(projectId, `/integrations/deliveries/${deliveryId}/replay`), {})).data;

export const getBillingRefundCases = async (projectId: string): Promise<{ data: BillingRefundCase[] }> =>
  (await GET(purchasesV2Path(projectId, "/refunds?limit=100"))).data;

export const getBillingRefundCase = async (projectId: string, caseId: string): Promise<BillingRefundCaseDetail> =>
  (await GET(purchasesV2Path(projectId, `/refunds/${caseId}`))).data;

export const createBillingRefundEvidence = async (projectId: string, caseId: string, data: { evidence_type: string; content?: string; file_key?: string }) =>
  (await POST(purchasesV2Path(projectId, `/refunds/${caseId}/evidence`), data)).data;

export const reviewBillingRefundEvidence = async (projectId: string, caseId: string, evidenceId: string, approved: boolean) =>
  (await POST(purchasesV2Path(projectId, `/refunds/${caseId}/evidence/${evidenceId}/review`), { approved })).data;

export const createBillingRefundAction = async (projectId: string, caseId: string, actionType: string, payload: Record<string, unknown>) =>
  (await POST(purchasesV2Path(projectId, `/refunds/${caseId}/actions`), { action_type: actionType, payload })).data;

export const updateBillingRefundAction = async (projectId: string, caseId: string, actionId: string, payload: Record<string, unknown>) =>
  (await PATCH(purchasesV2Path(projectId, `/refunds/${caseId}/actions/${actionId}`), { payload })).data;

export const approveBillingRefundAction = async (projectId: string, caseId: string, actionId: string) =>
  (await POST(purchasesV2Path(projectId, `/refunds/${caseId}/actions/${actionId}/approve`), {})).data;

export const getBillingVirtualCurrencies = async (projectId: string) =>
  (await GET(purchasesV2Path(projectId, "/virtual-currencies"))).data;

export const createBillingVirtualCurrency = async (projectId: string, data: Record<string, unknown>) =>
  (await POST(purchasesV2Path(projectId, "/virtual-currencies"), data)).data;

export const getBillingExports = async (projectId: string) =>
  (await GET(purchasesV2Path(projectId, "/exports"))).data;

export const createBillingExport = async (projectId: string, dataset: string) =>
  (await POST(purchasesV2Path(projectId, "/exports"), { dataset, format: "csv", incremental: true })).data;

export const getBillingAudiences = async (projectId: string) =>
  (await GET(purchasesV2Path(projectId, "/audiences"))).data;

export const createBillingAudience = async (projectId: string, data: Record<string, unknown>) =>
  (await POST(purchasesV2Path(projectId, "/audiences"), data)).data;

export const getBillingCustomer = async (projectId: string, customerId: string) =>
  (await GET(purchasesV2Path(projectId, `/customers/${customerId}`))).data;

export const setBillingCustomerBlocked = async (projectId: string, customerId: string, blocked: boolean) =>
  (await POST(purchasesV2Path(projectId, `/customers/${customerId}/block`), { blocked })).data;

export const grantBillingEntitlement = async (projectId: string, customerId: string, entitlementId: string, expiresAt?: string | null) =>
  (await POST(purchasesV2Path(projectId, `/customers/${customerId}/entitlements/${entitlementId}`), { expires_at: expiresAt || null })).data;

export const revokeBillingEntitlement = async (projectId: string, customerId: string, entitlementId: string) =>
  (await DELETE(purchasesV2Path(projectId, `/customers/${customerId}/entitlements/${entitlementId}`))).data;

export const mergeBillingCustomers = async (projectId: string, customerId: string, targetCustomerId: string) =>
  (await POST(purchasesV2Path(projectId, `/customers/${customerId}/merge`), { target_customer_id: targetCustomerId })).data;

export const deleteBillingCustomer = async (projectId: string, customerId: string) =>
  (await DELETE(purchasesV2Path(projectId, `/customers/${customerId}`))).data;

export const archiveBillingProduct = async (projectId: string, productId: string) =>
  (await DELETE(config.apiPath + `/billing/${projectId}/products/${productId}`)).data;

export const archiveBillingEntitlement = async (projectId: string, entitlementId: string) =>
  (await DELETE(config.apiPath + `/billing/${projectId}/entitlements/${entitlementId}`)).data;

export const archiveBillingOffering = async (projectId: string, offeringId: string) =>
  (await DELETE(config.apiPath + `/billing/${projectId}/offerings/${offeringId}`)).data;
