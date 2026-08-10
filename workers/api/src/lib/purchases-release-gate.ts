export type ReleaseGateCheckDefinition = {
  key: string;
  provider: "apple" | "google" | "cross_platform";
  group: string;
  label: string;
  description: string;
  required_evidence: Array<"build" | "device" | "reference">;
  reference_types: CertificationReferenceType[];
};

export type CertificationReferenceType =
  | "billing_transaction"
  | "billing_event"
  | "paywall_event"
  | "legacy_inventory"
  | "test_run";

export type ReleaseGateCertificationObservation = {
  id: string;
  run_id: string;
  check_key: string;
  outcome: string;
  evidence_json?: string;
  evidence_sha256: string;
  run_status: string;
  digest_valid: boolean;
};

export type StoredReleaseGateCheck = {
  check_key: string;
  status: string;
  evidence_json?: string;
  notes?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  updated_at?: string | null;
};

export type ReleaseGatePrerequisite = {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type BillingOperationalState = {
  dedicated_execution: boolean;
  worker_ready: boolean;
  canonical_failed: number;
  canonical_stale_pending: number;
  provider_failed: number;
  provider_stale_received: number;
  subscription_reconciliation_failed: number;
  subscription_reconciliation_stale: number;
  entitlement_delivery_failed: number;
  entitlement_delivery_stale_pending: number;
  refund_action_failed: number;
  refund_action_stale: number;
  missed_refund_deadlines: number;
  quarantined_dead_letters: number;
};

export type ReleaseGateCatalogProduct = {
  project_id: string;
  store: string;
  environment: string;
  metadata?: string | Record<string, unknown> | null;
  premium_mapped: number;
  package_types?: string | null;
};

export type NativeCatalogCoverage = {
  catalog: boolean;
  premium: boolean;
  packages: boolean;
  approved: boolean;
  available: boolean;
  purchasable: boolean;
};

const REQUIRED_NATIVE_CADENCES = ["weekly", "annual"] as const;

const nativeScenarios = [
  [
    "weekly_purchase",
    "Weekly subscription purchase",
    "Complete a verified purchase for the weekly subscription.",
  ],
  [
    "yearly_purchase",
    "Yearly subscription purchase",
    "Complete a verified purchase for the yearly subscription.",
  ],
  [
    "trial",
    "Trial conversion",
    "Start a trial and verify the entitlement and period type.",
  ],
  [
    "pending",
    "Pending purchase",
    "Keep the purchase pending until the store resolves it.",
  ],
  [
    "user_cancelled",
    "User cancellation",
    "Cancel the purchase sheet without granting an entitlement.",
  ],
  [
    "renewal",
    "Renewal",
    "Verify a renewal event updates the existing subscription exactly once.",
  ],
  [
    "upgrade_downgrade",
    "Upgrade and downgrade",
    "Verify plan changes preserve one canonical subscription state.",
  ],
  [
    "expiration",
    "Expiration",
    "Verify expiration removes the entitlement deterministically.",
  ],
  ["refund", "Refund", "Verify a provider refund revokes the entitlement."],
  [
    "restore",
    "Restore purchases",
    "Restore verified purchases without duplicating transactions.",
  ],
  [
    "device_change",
    "Device change",
    "Sign in on another device and recover the same entitlement.",
  ],
  [
    "reinstall",
    "Reinstallation",
    "Reinstall the app and recover pending work and entitlements.",
  ],
  [
    "interrupted_purchase",
    "App closed during purchase",
    "Close the app during purchase and resume validation after restart.",
  ],
  [
    "network_loss",
    "Network loss before validation",
    "Recover a transaction after connectivity returns.",
  ],
  [
    "duplicate_event",
    "Duplicate provider event",
    "Replay the same event without creating another transaction or entitlement.",
  ],
  [
    "out_of_order_event",
    "Out-of-order provider event",
    "Apply events according to provider occurrence time.",
  ],
] as const;

const nativeReferenceTypes = (
  key: (typeof nativeScenarios)[number][0],
): CertificationReferenceType[] => {
  if (["pending", "user_cancelled", "restore"].includes(key)) {
    return ["test_run"];
  }
  if (
    [
      "device_change",
      "reinstall",
      "interrupted_purchase",
      "network_loss",
    ].includes(key)
  )
    return ["test_run"];
  if (["duplicate_event", "out_of_order_event"].includes(key))
    return ["test_run"];
  return key === "weekly_purchase" || key === "yearly_purchase"
    ? ["billing_transaction"]
    : ["billing_transaction", "billing_event"];
};

export const RELEASE_GATE_CHECKS: ReleaseGateCheckDefinition[] = [
  ...(["apple", "google"] as const).flatMap((provider) =>
    nativeScenarios.map(([key, label, description]) => ({
      key: `${provider}.${key}`,
      provider,
      group: provider === "apple" ? "Apple App Store" : "Google Play",
      label,
      description,
      required_evidence: ["build", "device", "reference"] as Array<
        "build" | "device" | "reference"
      >,
      reference_types: nativeReferenceTypes(key),
    })),
  ),
  ...(
    [
      [
        "identity_sync",
        "Authenticated identity",
        "A failed identity synchronization blocks a new purchase.",
      ],
      [
        "signed_customer_info",
        "Signed CustomerInfo",
        "The SDK rejects an invalid signature and caches only verified customer data.",
      ],
      [
        "restart_recovery",
        "Restart recovery",
        "The encrypted outbox resumes every unfinished server validation.",
      ],
      [
        "unverified_denied",
        "Unverified transaction denied",
        "No entitlement is granted from an unverified transaction.",
      ],
      [
        "authority_convergence",
        "Authority convergence",
        "Store state, OpenGrow, and the application projection converge.",
      ],
      [
        "flutterflow_ios",
        "FlutterFlow on iOS",
        "Run purchase, restore, synchronization, and subscription management on a real iOS device.",
      ],
      [
        "flutterflow_android",
        "FlutterFlow on Android",
        "Run purchase, restore, synchronization, and subscription management on a real Android device.",
      ],
      [
        "revenuecat_inventory",
        "Legacy subscription inventory",
        "Inventory and import every active legacy subscription before dependency removal.",
      ],
    ] as const
  ).map(([key, label, description]) => ({
    key: `cross_platform.${key}`,
    provider: "cross_platform" as const,
    group: "Cross-platform integrity",
    label,
    description,
    required_evidence: (key === "flutterflow_ios" ||
    key === "flutterflow_android"
      ? ["build", "device", "reference"]
      : key === "revenuecat_inventory"
        ? ["reference"]
        : ["build", "reference"]) as Array<"build" | "device" | "reference">,
    reference_types: (key === "revenuecat_inventory"
      ? ["legacy_inventory"]
      : key === "authority_convergence"
        ? ["billing_transaction", "billing_event", "test_run"]
        : ["test_run"]) as CertificationReferenceType[],
  })),
];

export function validateReleaseGateEvidence(
  definition: ReleaseGateCheckDefinition,
  evidence: Record<string, unknown>,
) {
  const missing = definition.required_evidence.filter((field) => {
    const value = evidence[field];
    return (
      typeof value !== "string" || !value.trim() || value.trim().length > 500
    );
  });
  return { valid: missing.length === 0, missing };
}

export function billingOperationalPrerequisites(
  state: BillingOperationalState,
): ReleaseGatePrerequisite[] {
  const prerequisite = (
    key: string,
    label: string,
    passed: boolean,
    success: string,
    failure: string,
  ): ReleaseGatePrerequisite => ({
    key,
    label,
    passed,
    detail: passed ? success : failure,
  });
  const financialFailures = state.canonical_failed + state.provider_failed;
  const staleFinancialWork =
    state.canonical_stale_pending + state.provider_stale_received;
  const subscriptionReconciliationFailures =
    state.subscription_reconciliation_failed;
  const staleSubscriptionReconciliations =
    state.subscription_reconciliation_stale;
  const projectionFailures = state.entitlement_delivery_failed;
  const staleProjections = state.entitlement_delivery_stale_pending;
  const refundFailures = state.refund_action_failed;
  const staleRefundActions = state.refund_action_stale;
  return [
    prerequisite(
      "dedicated_billing_execution",
      "Dedicated Billing execution",
      state.dedicated_execution && state.worker_ready,
      "Purchases are routed through the ready private Billing Worker.",
      !state.dedicated_execution
        ? "Route Purchases through the private Billing Worker before publication."
        : "Resolve the Billing Worker secret or credential readiness failure before publication.",
    ),
    prerequisite(
      "financial_event_pipeline",
      "Financial event pipeline",
      financialFailures === 0 && staleFinancialWork === 0,
      "No failed or stale provider event is waiting for processing.",
      `Resolve ${financialFailures} failed and ${staleFinancialWork} stale financial events.`,
    ),
    prerequisite(
      "entitlement_projection_pipeline",
      "Entitlement projection pipeline",
      projectionFailures === 0 && staleProjections === 0,
      "Every entitlement projection is delivered or within its active retry window.",
      `Resolve ${projectionFailures} failed and ${staleProjections} stale entitlement projections.`,
    ),
    prerequisite(
      "provider_subscription_reconciliation",
      "Provider subscription reconciliation",
      subscriptionReconciliationFailures === 0 &&
        staleSubscriptionReconciliations === 0,
      "Every owned active subscription has current provider verification.",
      `Resolve ${subscriptionReconciliationFailures} failed and ${staleSubscriptionReconciliations} stale provider subscription verifications.`,
    ),
    prerequisite(
      "refund_action_pipeline",
      "Refund action pipeline",
      refundFailures === 0 && staleRefundActions === 0,
      "No failed or stale approved refund action is waiting for delivery.",
      `Resolve ${refundFailures} failed and ${staleRefundActions} stale refund actions.`,
    ),
    prerequisite(
      "refund_deadlines",
      "Refund deadlines",
      state.missed_refund_deadlines === 0,
      "No refund response deadline is missed.",
      `Resolve ${state.missed_refund_deadlines} missed refund response deadlines.`,
    ),
    prerequisite(
      "billing_dead_letter_queue",
      "Billing dead-letter queue",
      state.quarantined_dead_letters === 0,
      "No financial queue job is quarantined.",
      `Review, replay, or discard ${state.quarantined_dead_letters} quarantined financial jobs.`,
    ),
  ];
}

export function buildReleaseGate(
  stored: StoredReleaseGateCheck[],
  prerequisites: ReleaseGatePrerequisite[],
  certificationObservations: ReleaseGateCertificationObservation[] = [],
) {
  const byKey = new Map(stored.map((row) => [row.check_key, row]));
  const observationById = new Map(
    certificationObservations.map((row) => [row.id, row]),
  );
  const checks = RELEASE_GATE_CHECKS.map((definition) => {
    const row = byKey.get(definition.key);
    const evidence = parseObject(row?.evidence_json);
    const evidenceValidation = validateReleaseGateEvidence(
      definition,
      evidence,
    );
    const observation = observationById.get(
      String(evidence.observation_id || ""),
    );
    const certificationValid = Boolean(
      observation &&
      observation.check_key === definition.key &&
      observation.outcome === "passed" &&
      observation.run_status === "completed" &&
      observation.run_id === evidence.run_id &&
      observation.evidence_sha256 === evidence.evidence_sha256 &&
      observation.digest_valid,
    );
    const authenticatedDeviceEvidenceValid =
      !requiresAuthenticatedDeviceEvidence(definition) ||
      hasAuthenticatedDeviceEvidence(observation, definition.key);
    const status =
      row?.status === "passed" || row?.status === "failed"
        ? row.status
        : "pending";
    const missingEvidence = [
      ...evidenceValidation.missing,
      ...(!certificationValid ? ["certification_observation"] : []),
      ...(!authenticatedDeviceEvidenceValid
        ? ["authenticated_device_result"]
        : []),
    ];
    const certified =
      status === "passed" &&
      evidenceValidation.valid &&
      certificationValid &&
      authenticatedDeviceEvidenceValid;
    return {
      ...definition,
      status,
      evidence,
      evidence_valid:
        evidenceValidation.valid &&
        certificationValid &&
        authenticatedDeviceEvidenceValid,
      missing_evidence: missingEvidence,
      certified,
      notes: row?.notes || null,
      verified_by: row?.verified_by || null,
      verified_at: row?.verified_at || null,
      updated_at: row?.updated_at || null,
    };
  });
  const failedChecks = checks.filter((check) => !check.certified);
  const failedPrerequisites = prerequisites.filter((item) => !item.passed);
  const ready = failedChecks.length === 0 && failedPrerequisites.length === 0;
  return {
    ready,
    publication_allowed: ready,
    legacy_dependency_removal_allowed: ready,
    progress: {
      passed: checks.length - failedChecks.length,
      total: checks.length,
    },
    prerequisites,
    checks,
    blockers: [
      ...failedPrerequisites.map((item) => ({
        type: "prerequisite",
        key: item.key,
        message: item.detail,
      })),
      ...failedChecks.map((item) => ({
        type: "check",
        key: item.key,
        message:
          item.status === "passed" && !item.evidence_valid
            ? `${item.group}: ${item.label} is missing ${item.missing_evidence.join(", ")} evidence`
            : `${item.group}: ${item.label}`,
      })),
    ],
  };
}

export function requiresAuthenticatedDeviceEvidence(
  definition: Pick<ReleaseGateCheckDefinition, "provider">,
) {
  return definition.provider === "apple" || definition.provider === "google";
}

function hasAuthenticatedDeviceEvidence(
  observation: ReleaseGateCertificationObservation | undefined,
  checkKey: string,
) {
  if (!observation) return false;
  const snapshot = parseObject(observation.evidence_json);
  const candidates = [
    parseObject(parseObject(snapshot.reference).verified_record),
    parseObject(parseObject(snapshot.device_reference).verified_record),
  ];
  return candidates.some(
    (reference) =>
      reference.source === "authenticated_sdk" &&
      reference.check_key === checkKey &&
      reference.outcome === "passed" &&
      typeof reference.id === "string" &&
      reference.id.length > 0 &&
      typeof reference.evidence_sha256 === "string" &&
      /^[a-f0-9]{64}$/u.test(reference.evidence_sha256),
  );
}

export function certificationRunCompatibility(
  definition: ReleaseGateCheckDefinition,
  platform: string,
  environment: string,
) {
  const expectedEnvironment =
    definition.key === "cross_platform.revenuecat_inventory"
      ? "production"
      : "sandbox";
  const expectedPlatform =
    definition.provider === "apple"
      ? "ios"
      : definition.provider === "google"
        ? "android"
        : definition.key === "cross_platform.flutterflow_ios"
            ? "ios"
            : definition.key === "cross_platform.flutterflow_android"
              ? "android"
              : "cross_platform";
  return {
    valid: platform === expectedPlatform && environment === expectedEnvironment,
    expected_platform: expectedPlatform,
    expected_environment: expectedEnvironment,
  };
}

export function nativeCatalogCoverage(
  products: ReleaseGateCatalogProduct[],
  projectId: string,
  store: "apple" | "google",
  environment: "sandbox" | "production",
): NativeCatalogCoverage {
  const scoped = products.filter(
    (product) =>
      String(product.project_id) === projectId &&
      product.store === store &&
      product.environment === environment,
  );
  const cadenceProducts = (
    cadence: (typeof REQUIRED_NATIVE_CADENCES)[number],
  ) => scoped.filter((product) => productCadences(product).has(cadence));
  return {
    catalog: REQUIRED_NATIVE_CADENCES.every(
      (cadence) => cadenceProducts(cadence).length > 0,
    ),
    premium: REQUIRED_NATIVE_CADENCES.every((cadence) =>
      cadenceProducts(cadence).some(
        (product) => Number(product.premium_mapped) === 1,
      ),
    ),
    packages: REQUIRED_NATIVE_CADENCES.every((cadence) =>
      cadenceProducts(cadence).some((product) =>
        packageTypes(product).has(cadence),
      ),
    ),
    approved: REQUIRED_NATIVE_CADENCES.every((cadence) =>
      cadenceProducts(cadence).some(
        (product) => releaseGateProviderReadiness(product).approved,
      ),
    ),
    available: REQUIRED_NATIVE_CADENCES.every((cadence) =>
      cadenceProducts(cadence).some(
        (product) => releaseGateProviderReadiness(product).available,
      ),
    ),
    purchasable: REQUIRED_NATIVE_CADENCES.every((cadence) =>
      cadenceProducts(cadence).some(
        (product) => releaseGateProviderReadiness(product).purchasable,
      ),
    ),
  };
}

export function catalogSyncFresh(
  lastSyncedAt: unknown,
  maximumAgeHours: number,
  nowMillis = Date.now(),
) {
  const syncedAtMillis = Date.parse(String(lastSyncedAt || ""));
  if (
    !Number.isFinite(syncedAtMillis) ||
    !Number.isFinite(maximumAgeHours) ||
    maximumAgeHours <= 0
  )
    return false;
  const ageMillis = nowMillis - syncedAtMillis;
  return ageMillis >= -5 * 60_000 && ageMillis <= maximumAgeHours * 60 * 60_000;
}

export function releaseGateProviderReadiness(
  product: ReleaseGateCatalogProduct,
) {
  const metadata = parseObject(product.metadata);
  const providerVerified =
    product.store === "apple"
      ? metadata.source === "app_store_connect"
      : product.store === "google"
        ? metadata.source === "google_play"
        : false;
  return {
    approved: providerVerified && metadata.provider_approved === true,
    available: providerVerified && metadata.provider_available === true,
    purchasable: providerVerified && metadata.provider_purchasable === true,
  };
}

function productCadences(product: ReleaseGateCatalogProduct) {
  const metadata = parseObject(product.metadata);
  const providerCadences = new Set<"weekly" | "annual">();
  addCadence(providerCadences, metadata.subscription_period);
  if (Array.isArray(metadata.base_plans)) {
    for (const value of metadata.base_plans) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      addCadence(
        providerCadences,
        (value as Record<string, unknown>).billing_period,
      );
    }
  }
  // Older imported Google catalog rows did not persist the base-plan period.
  // The current default offering is the canonical fallback until the next sync.
  return providerCadences.size > 0 ? providerCadences : packageTypes(product);
}

export function releaseGateProductCadences(product: ReleaseGateCatalogProduct) {
  return [...productCadences(product)];
}

function packageTypes(product: ReleaseGateCatalogProduct) {
  return new Set(
    String(product.package_types || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(
        (value): value is "weekly" | "annual" =>
          value === "weekly" || value === "annual",
      ),
  );
}

function addCadence(target: Set<"weekly" | "annual">, value: unknown) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replaceAll("-", "_");
  if (["ONE_WEEK", "P1W", "P7D", "WEEKLY"].includes(normalized))
    target.add("weekly");
  if (["ONE_YEAR", "P1Y", "YEARLY", "ANNUAL"].includes(normalized))
    target.add("annual");
}

function parseObject(value: unknown) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return parseObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
