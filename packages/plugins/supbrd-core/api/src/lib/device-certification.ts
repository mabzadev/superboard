import { purchasesError } from "./purchases-v2";
import {
  certificationRunCompatibility,
  RELEASE_GATE_CHECKS,
} from "./purchases-release-gate";

export const DEVICE_CERTIFICATION_CHALLENGE_TTL_SECONDS = 4 * 60 * 60;

export type CertificationDeviceRun = {
  id: string;
  release_project_id: string;
  target_project_id: string;
  environment: "sandbox" | "production";
  platform: "ios" | "android" | "web" | "cross_platform";
  build_number: string;
  app_version: string | null;
  sdk_version: string | null;
  device_model: string | null;
  os_version: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  started_at: string;
};

type DeviceChallengeRow = CertificationDeviceRun & {
  challenge_hash: string;
  challenge_expires_at: string;
  claimed_customer_id: string | null;
};

export type DeviceCertificationResultInput = {
  id: string;
  runId: string;
  challenge: string;
  checkKey: string;
  outcome: "passed" | "failed";
  customerId: string;
  projectId: string;
  sourcePlatform: "ios" | "android" | "web";
  applicationIdentifier: string;
  buildNumber: string;
  appVersion?: string | null;
  sdkVersion?: string | null;
  deviceModel?: string | null;
  osVersion?: string | null;
  assertions: Record<string, unknown>;
  observedAt?: string | null;
};

export async function issueCertificationDeviceChallenge(
  db: D1Database,
  runId: string,
  now = new Date(),
) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64Url(bytes);
  const challengeHash = await sha256Hex(token);
  const expiresAt = new Date(
    now.getTime() + DEVICE_CERTIFICATION_CHALLENGE_TTL_SECONDS * 1000,
  ).toISOString();
  await db
    .prepare(
      `
    INSERT INTO billing_certification_device_challenges (
      run_id, challenge_hash, expires_at, claimed_customer_id, claimed_at
    ) VALUES (?, ?, ?, NULL, NULL)
    ON CONFLICT(run_id) DO UPDATE SET
      challenge_hash = excluded.challenge_hash,
      expires_at = excluded.expires_at,
      updated_at = datetime('now')
  `,
    )
    .bind(runId, challengeHash, expiresAt)
    .run();
  return { token, expires_at: expiresAt };
}

export async function recordDeviceCertificationResult(
  db: D1Database,
  input: DeviceCertificationResultInput,
  now = new Date(),
) {
  validateIdentifier(input.id, "device_result_id", 128);
  validateIdentifier(input.runId, "certification_run_id", 128);
  if (!input.challenge || input.challenge.length > 512) {
    throw purchasesError(
      "device_challenge_invalid",
      "A valid device certification challenge is required",
      401,
    );
  }
  if (!["passed", "failed"].includes(input.outcome)) {
    throw purchasesError(
      "certification_outcome_invalid",
      "Outcome must be passed or failed",
    );
  }
  const definition = RELEASE_GATE_CHECKS.find(
    (item) => item.key === input.checkKey,
  );
  const acceptsDeviceEvidence =
    definition &&
    (definition.reference_types.includes("test_run") ||
      definition.provider === "apple" ||
      definition.provider === "google");
  if (!acceptsDeviceEvidence) {
    throw purchasesError(
      "device_certification_check_invalid",
      "This check does not accept authenticated device evidence",
      409,
    );
  }
  const assertions = normalizedAssertions(input.assertions);
  if (input.outcome === "passed") {
    const missing = requiredDeviceCertificationAssertions(
      input.checkKey,
    ).filter((key) => assertions[key] !== true);
    if (missing.length) {
      throw purchasesError(
        "device_certification_assertions_incomplete",
        `Passing this check requires true assertions: ${missing.join(", ")}`,
        409,
      );
    }
  }
  const existing = await db
    .prepare(
      `
    SELECT id, run_id, target_project_id, customer_id, check_key, outcome,
      source_platform, application_identifier, build_number, app_version,
      sdk_version, device_model, os_version, evidence_json, evidence_sha256,
      observed_at, received_at
    FROM billing_certification_device_results WHERE id = ? LIMIT 1
  `,
    )
    .bind(input.id)
    .first<Record<string, unknown>>();
  if (existing) {
    const evidence = parseObject(existing.evidence_json);
    const same =
      existing.run_id === input.runId &&
      String(existing.target_project_id) === input.projectId &&
      String(existing.customer_id) === input.customerId &&
      existing.check_key === input.checkKey &&
      existing.outcome === input.outcome &&
      JSON.stringify(evidence.assertions || {}) === JSON.stringify(assertions);
    if (!same) {
      throw purchasesError(
        "device_result_id_conflict",
        "Device result ID is already used by different evidence",
        409,
      );
    }
    return publicDeviceResult(existing, true);
  }
  const run = await db
    .prepare(
      `
    SELECT r.*, c.challenge_hash, c.expires_at AS challenge_expires_at,
      c.claimed_customer_id
    FROM billing_certification_runs r
    JOIN billing_certification_device_challenges c ON c.run_id = r.id
    WHERE r.id = ? AND r.target_project_id = ? LIMIT 1
  `,
    )
    .bind(input.runId, input.projectId)
    .first<DeviceChallengeRow>();
  if (!run || run.status !== "running") {
    throw purchasesError(
      "device_certification_run_unavailable",
      "Running device certification was not found",
      404,
    );
  }
  const compatibility = certificationRunCompatibility(
    definition,
    run.platform,
    run.environment,
  );
  if (!compatibility.valid) {
    throw purchasesError(
      "certification_run_incompatible",
      "The certification run is not compatible with this check",
      409,
    );
  }
  validateSourcePlatform(
    input.checkKey,
    definition.provider,
    input.sourcePlatform,
  );
  if (Date.parse(run.challenge_expires_at) <= now.getTime()) {
    throw purchasesError(
      "device_challenge_expired",
      "The device certification challenge has expired",
      401,
    );
  }
  if ((await sha256Hex(input.challenge)) !== run.challenge_hash) {
    throw purchasesError(
      "device_challenge_invalid",
      "The device certification challenge is invalid",
      401,
    );
  }
  if (
    run.claimed_customer_id &&
    String(run.claimed_customer_id) !== input.customerId
  ) {
    throw purchasesError(
      "device_challenge_claimed",
      "The device certification challenge is already claimed",
      409,
    );
  }
  requireExactRunValue(input.buildNumber, run.build_number, "build number");
  requireExactRunValue(input.appVersion, run.app_version, "app version");
  requireExactRunValue(input.sdkVersion, run.sdk_version, "SDK version");
  requireExactRunValue(input.deviceModel, run.device_model, "device model");
  requireExactRunValue(input.osVersion, run.os_version, "OS version");
  const observedAt = normalizedObservedAt(
    input.observedAt,
    run.started_at,
    now,
  );
  const evidence = {
    schema_version: 1,
    source: "authenticated_sdk",
    run_id: run.id,
    check_key: input.checkKey,
    outcome: input.outcome,
    assertions,
    identity_verified: true,
    source_platform: input.sourcePlatform,
    application_identifier: boundedText(
      input.applicationIdentifier,
      "application identifier",
      255,
    ),
    build_number: boundedText(input.buildNumber, "build number", 100),
    app_version: optionalBoundedText(input.appVersion, "app version", 100),
    sdk_version: optionalBoundedText(input.sdkVersion, "SDK version", 100),
    device_model: optionalBoundedText(input.deviceModel, "device model", 200),
    os_version: optionalBoundedText(input.osVersion, "OS version", 100),
    observed_at: observedAt,
    received_at: now.toISOString(),
  };
  const evidenceJson = JSON.stringify(evidence);
  if (evidenceJson.length > 16_384) {
    throw purchasesError(
      "device_certification_evidence_too_large",
      "Device evidence is limited to 16 KB",
      413,
    );
  }
  const evidenceSha256 = await sha256Hex(evidenceJson);
  const claimed = await db
    .prepare(
      `
    UPDATE billing_certification_device_challenges
    SET claimed_customer_id = COALESCE(claimed_customer_id, ?),
      claimed_at = COALESCE(claimed_at, datetime('now')),
      updated_at = datetime('now')
    WHERE run_id = ? AND challenge_hash = ? AND datetime(expires_at) > datetime('now')
      AND (claimed_customer_id IS NULL OR claimed_customer_id = ?)
  `,
    )
    .bind(input.customerId, run.id, run.challenge_hash, input.customerId)
    .run();
  if (Number(claimed.meta?.changes || 0) !== 1) {
    throw purchasesError(
      "device_challenge_claim_failed",
      "The device certification challenge could not be claimed",
      409,
      true,
    );
  }
  await db
    .prepare(
      `
    INSERT INTO billing_certification_device_results (
      id, run_id, target_project_id, customer_id, check_key, outcome,
      source_platform, application_identifier, build_number, app_version,
      sdk_version, device_model, os_version, evidence_json, evidence_sha256,
      observed_at, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .bind(
      input.id,
      run.id,
      input.projectId,
      input.customerId,
      input.checkKey,
      input.outcome,
      input.sourcePlatform,
      evidence.application_identifier,
      evidence.build_number,
      evidence.app_version,
      evidence.sdk_version,
      evidence.device_model,
      evidence.os_version,
      evidenceJson,
      evidenceSha256,
      observedAt,
      now.toISOString(),
    )
    .run();
  return {
    id: input.id,
    run_id: run.id,
    check_key: input.checkKey,
    outcome: input.outcome,
    evidence_sha256: evidenceSha256,
    observed_at: observedAt,
    received_at: now.toISOString(),
    duplicate: false,
  };
}

export function requiredDeviceCertificationAssertions(
  checkKey: string,
): string[] {
  const scenario = checkKey.split(".").slice(1).join(".");
  const requirements: Record<string, string[]> = {
    weekly_purchase: [
      "purchase_completed",
      "provider_transaction_verified",
      "premium_entitlement_active",
      "transaction_finalized_once",
    ],
    yearly_purchase: [
      "purchase_completed",
      "provider_transaction_verified",
      "premium_entitlement_active",
      "transaction_finalized_once",
    ],
    trial: ["trial_started", "trial_period_verified", "entitlement_verified"],
    pending: [
      "pending_observed",
      "entitlement_withheld_until_verified",
      "terminal_resolution_observed",
    ],
    user_cancelled: ["cancellation_observed", "entitlement_unchanged"],
    renewal: [
      "renewal_observed",
      "entitlement_continued",
      "duplicate_transaction_absent",
    ],
    upgrade_downgrade: [
      "product_change_completed",
      "canonical_subscription_preserved",
      "entitlement_converged",
    ],
    expiration: [
      "expiration_observed",
      "entitlement_revoked",
      "projection_converged",
    ],
    refund: ["refund_observed", "entitlement_revoked", "projection_converged"],
    restore: [
      "restore_completed",
      "duplicate_transaction_absent",
      "entitlement_verified",
    ],
    device_change: ["second_device_authenticated", "entitlement_restored"],
    reinstall: ["app_reinstalled", "outbox_recovered", "entitlement_restored"],
    interrupted_purchase: [
      "purchase_interrupted",
      "validation_resumed",
      "transaction_finalized_once",
    ],
    network_loss: [
      "network_interrupted",
      "outbox_retained",
      "validation_resumed",
    ],
    duplicate_event: [
      "same_event_replayed",
      "single_transaction",
      "single_entitlement_projection",
    ],
    out_of_order_event: [
      "events_reordered",
      "provider_occurrence_order_applied",
      "final_state_converged",
    ],
    portal: ["portal_session_created", "return_url_verified"],
    identity_sync: [
      "authenticated_identity_verified",
      "purchase_blocked_without_identity",
    ],
    signed_customer_info: [
      "valid_signature_accepted",
      "tampered_signature_rejected",
      "unverified_state_unchanged",
    ],
    restart_recovery: [
      "outbox_persisted",
      "app_restarted",
      "validation_resumed",
      "transaction_finalized_once",
    ],
    unverified_denied: [
      "unverified_receipt_submitted",
      "entitlement_not_granted",
    ],
    authority_convergence: [
      "provider_state_checked",
      "billing_state_checked",
      "application_projection_checked",
      "states_match",
    ],
    flutterflow_ios: [
      "purchase_completed",
      "restore_completed",
      "sync_completed",
      "subscription_management_opened",
      "verified_customer_info_applied",
    ],
    flutterflow_android: [
      "purchase_completed",
      "restore_completed",
      "sync_completed",
      "subscription_management_opened",
      "verified_customer_info_applied",
    ],
  };
  const required = requirements[scenario];
  if (!required) {
    throw purchasesError(
      "device_certification_schema_missing",
      "No device evidence schema is defined for this check",
      500,
    );
  }
  return required;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function validateIdentifier(value: string, field: string, max: number) {
  if (
    !new RegExp(`^[A-Za-z0-9][A-Za-z0-9._:-]{7,${max - 1}}$`, "u").test(value)
  ) {
    throw purchasesError(`${field}_invalid`, `${field} is invalid`);
  }
}

function normalizedAssertions(value: Record<string, unknown>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw purchasesError(
      "device_certification_assertions_invalid",
      "Assertions must be a JSON object",
    );
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right, "en"),
  );
  if (entries.length < 1 || entries.length > 64) {
    throw purchasesError(
      "device_certification_assertions_invalid",
      "Assertions must contain 1-64 fields",
    );
  }
  const result: Record<string, boolean | number | string | null> = {};
  for (const [key, item] of entries) {
    if (
      !/^[a-z][a-z0-9_]{0,63}$/u.test(key) ||
      !(
        ["boolean", "number", "string"].includes(typeof item) || item === null
      ) ||
      (typeof item === "string" && item.length > 500) ||
      (typeof item === "number" && !Number.isFinite(item))
    ) {
      throw purchasesError(
        "device_certification_assertions_invalid",
        "Assertions contain an invalid field or value",
      );
    }
    result[key] = item as boolean | number | string | null;
  }
  return result;
}

function validateSourcePlatform(
  checkKey: string,
  provider: "apple" | "google" | "cross_platform",
  sourcePlatform: string,
) {
  const expected =
    provider === "apple"
      ? "ios"
      : provider === "google"
        ? "android"
        : checkKey === "cross_platform.flutterflow_ios"
            ? "ios"
            : checkKey === "cross_platform.flutterflow_android"
              ? "android"
              : null;
  if (expected && sourcePlatform !== expected) {
    throw purchasesError(
      "device_certification_platform_mismatch",
      `This check requires ${expected} SDK evidence`,
      409,
    );
  }
}

function requireExactRunValue(
  actual: string | null | undefined,
  expected: string | null,
  label: string,
) {
  const normalizedExpected = String(expected || "").trim();
  if (!normalizedExpected) return;
  if (String(actual || "").trim() !== normalizedExpected) {
    throw purchasesError(
      "device_certification_run_mismatch",
      `Device ${label} does not match the certification run`,
      409,
    );
  }
}

function normalizedObservedAt(
  value: string | null | undefined,
  startedAt: string,
  now: Date,
) {
  const parsed = value ? Date.parse(value) : now.getTime();
  const started = Date.parse(normalizeD1Timestamp(startedAt));
  if (
    !Number.isFinite(parsed) ||
    !Number.isFinite(started) ||
    parsed < started - 10 * 60_000 ||
    parsed > now.getTime() + 5 * 60_000
  ) {
    throw purchasesError(
      "device_certification_time_invalid",
      "Device evidence timestamp is outside the active run",
      409,
    );
  }
  return new Date(parsed).toISOString();
}

function normalizeD1Timestamp(value: string) {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
}

function boundedText(value: unknown, field: string, max: number) {
  const text = String(value || "").trim();
  if (!text || text.length > max)
    throw purchasesError(
      "device_certification_field_invalid",
      `${field} is required and must contain at most ${max} characters`,
    );
  return text;
}

function optionalBoundedText(value: unknown, field: string, max: number) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length > max)
    throw purchasesError(
      "device_certification_field_invalid",
      `${field} must contain at most ${max} characters`,
    );
  return text;
}

function parseObject(value: unknown) {
  if (typeof value === "string") {
    try {
      return parseObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function publicDeviceResult(row: Record<string, unknown>, duplicate: boolean) {
  return {
    id: String(row.id),
    run_id: String(row.run_id),
    check_key: String(row.check_key),
    outcome: String(row.outcome),
    evidence_sha256: String(row.evidence_sha256),
    observed_at: String(row.observed_at),
    received_at: String(row.received_at),
    duplicate,
  };
}
