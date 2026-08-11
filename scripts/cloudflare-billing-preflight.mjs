import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseQueueConsumer } from "./cloudflare-billing-consumer.mjs";
import {
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";

const RESPONSE_LIMIT_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export function evaluateBillingPreflight(input) {
  const checks = [];
  const check = (key, passed, detail) => {
    checks.push({ key, passed: Boolean(passed), detail });
  };
  check(
    "main_queue_consumer",
    input.mainConsumer === input.expectedMainConsumer,
    input.mainConsumer === input.expectedMainConsumer
      ? `Main Billing queue is owned by ${input.expectedMainConsumer}.`
      : `Expected ${input.expectedMainConsumer}, found ${input.mainConsumer ?? "no consumer"}.`,
  );
  check(
    "dead_letter_queue_consumer",
    input.dlqConsumer === input.expectedDlqConsumer,
    input.dlqConsumer === input.expectedDlqConsumer
      ? `Billing DLQ is owned by ${input.expectedDlqConsumer}.`
      : `Expected ${input.expectedDlqConsumer}, found ${input.dlqConsumer ?? "no consumer"}.`,
  );
  const appliedMigrations = new Set(input.appliedMigrations || []);
  const missingMigrations = (input.requiredMigrations || [])
    .filter((name) => !appliedMigrations.has(name));
  check(
    "database_migrations",
    missingMigrations.length === 0,
    missingMigrations.length === 0
      ? "Every required D1 migration is applied."
      : `Apply pending D1 migrations: ${missingMigrations.join(", ")}.`,
  );
  const operational = object(input.operationalCounts);
  const operationalMetrics = [
    "billing_events_failed",
    "billing_events_stale",
    "provider_events_failed",
    "provider_events_stale",
    "subscription_verification_failed",
    "subscription_verification_stale",
    "entitlement_deliveries_failed",
    "entitlement_deliveries_stale",
    "refund_actions_failed",
    "refund_actions_stale",
    "refund_deadlines_missed",
    "dead_letters_quarantined",
  ];
  const unavailableMetrics = operationalMetrics.filter((name) =>
    !Number.isFinite(Number(operational[name])));
  const unhealthyMetrics = operationalMetrics.filter((name) =>
    Number.isFinite(Number(operational[name])) && Number(operational[name]) !== 0);
  check(
    "billing_operational_state",
    unavailableMetrics.length === 0 && unhealthyMetrics.length === 0,
    unavailableMetrics.length > 0
      ? `Operational counters are unavailable: ${unavailableMetrics.join(", ")}.`
      : unhealthyMetrics.length > 0
        ? `Resolve non-zero Billing counters: ${unhealthyMetrics.map((name) => `${name}=${operational[name]}`).join(", ")}.`
        : "Financial events, reconciliation, projections, refunds, deadlines, and quarantine are clear.",
  );

  const health = object(input.health);
  const missingSecrets = Array.isArray(health.missing_secrets)
    ? health.missing_secrets.map(String)
    : ["invalid health response"];
  check(
    "billing_worker_readiness",
    health.ready_for_traffic === true &&
      health.execution === "private-service-binding" &&
      health.credential_copies_ready === true &&
      health.credential_decryption_ready === true &&
      health.signing_authority_ready === true &&
      missingSecrets.length === 0,
    health.ready_for_traffic === true && missingSecrets.length === 0
      ? "Private Billing Worker reports complete credential and signing readiness."
      : `Billing readiness failed; missing secrets: ${missingSecrets.join(", ") || "none"}.`,
  );
  check(
    "billing_routing_mode",
    health.routing_mode === input.executionMode,
    `Expected ${input.executionMode} routing, observed ${String(health.routing_mode || "unknown")}.`,
  );
  check(
    "purchases_signing_jwks",
    validPublicEs256Jwks(input.purchasesJwks),
    "Purchases CustomerInfo JWKS must contain only public ES256 signing keys.",
  );
  check(
    "application_identity_jwks",
    validPublicEs256Jwks(input.authJwks),
    "Application identity JWKS must contain only public ES256 signing keys.",
  );

  const secretNames = new Set(input.billingSecretNames || []);
  for (const name of [
    "APPLE_ROOT_CERTIFICATES_B64",
    "PURCHASES_SIGNING_KEYSET",
    "STORE_CREDENTIALS_ENCRYPTION_KEYS",
  ]) {
    check(
      `secret_${name.toLowerCase()}`,
      secretNames.has(name),
      secretNames.has(name) ? `${name} is configured.` : `${name} is missing.`,
    );
  }
  const genericWebhookSecret = secretNames.has("OPENGROW_ENTITLEMENT_WEBHOOK_SECRET");
  check(
    "secret_entitlement_webhook",
    genericWebhookSecret,
    genericWebhookSecret
      ? "The entitlement projection secret is configured under the generic name."
      : "OPENGROW_ENTITLEMENT_WEBHOOK_SECRET is missing.",
  );

  return {
    ready: checks.every((item) => item.passed),
    checked_at: new Date().toISOString(),
    checks,
    blockers: checks.filter((item) => !item.passed).map((item) => ({
      key: item.key,
      detail: item.detail,
    })),
  };
}

export function parseSecretNames(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Unable to parse Wrangler secret list");
  const rows = JSON.parse(output.slice(start, end + 1));
  if (!Array.isArray(rows)) throw new Error("Wrangler secret list is not an array");
  return rows
    .map((row) => String(object(row).name || ""))
    .filter(Boolean);
}

export function parseD1MigrationNames(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Unable to parse Wrangler D1 query output");
  const batches = JSON.parse(output.slice(start, end + 1));
  if (!Array.isArray(batches)) throw new Error("Wrangler D1 query output is not an array");
  return batches.flatMap((batch) => {
    const results = object(batch).results;
    return Array.isArray(results)
      ? results.map((row) => String(object(row).name || "")).filter(Boolean)
      : [];
  });
}

export function parseD1Metrics(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Unable to parse Wrangler D1 metric output");
  const batches = JSON.parse(output.slice(start, end + 1));
  if (!Array.isArray(batches)) throw new Error("Wrangler D1 metric output is not an array");
  const metrics = {};
  for (const batch of batches) {
    const results = object(batch).results;
    if (!Array.isArray(results)) continue;
    for (const rowValue of results) {
      const row = object(rowValue);
      const name = String(row.metric || "");
      const value = Number(row.value);
      if (name && Number.isFinite(value)) metrics[name] = value;
    }
  }
  return metrics;
}

export function validPublicEs256Jwks(value) {
  const keys = object(value).keys;
  return Array.isArray(keys) && keys.length > 0 && keys.every((candidate) => {
    const key = object(candidate);
    return key.kty === "EC" && key.crv === "P-256" && key.alg === "ES256" &&
      key.use === "sig" && typeof key.kid === "string" && key.kid.length > 0 &&
      typeof key.x === "string" && key.x.length > 0 &&
      typeof key.y === "string" && key.y.length > 0 && !("d" in key);
  });
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { target } = await loadTarget(targetName);
  const resources = target.environments[environment];
  if (!resources) throw new Error(`${targetName} does not define a ${environment} environment`);

  run(process.execPath, [
    resolve(root, "scripts", "cloudflare-billing-config.mjs"),
    "--target", targetName,
    "--environment", environment,
  ]);
  const apiConfig = configPath(targetName, "api", environment);
  const billingConfig = configPath(targetName, "billing", environment);
  const expectedMainConsumer = resources.billingExecutionMode === "service"
    ? target.workers.billing[environment]
    : target.workers.api[environment];
  const expectedDlqConsumer = target.workers.billing[environment];
  const requiredMigrations = readdirSync(resolve(root, "workers", "api", "migrations"))
    .filter((name) => /^\d+_.+\.sql$/u.test(name))
    .sort();
  const appliedMigrations = parseD1MigrationNames(capture("npx", [
    "wrangler", "d1", "execute", resources.d1.name,
    "--remote", "--config", apiConfig,
    "--command", "SELECT name FROM d1_migrations ORDER BY name",
  ]));
  const pendingMigrations = requiredMigrations.filter((name) => !appliedMigrations.includes(name));
  const operationalCounts = pendingMigrations.length === 0
    ? parseD1Metrics(capture("npx", [
        "wrangler", "d1", "execute", resources.d1.name,
        "--remote", "--config", apiConfig,
        "--command", operationalSql(),
      ]))
    : null;
  const [health, purchasesJwks, authJwks] = await Promise.all([
    fetchJson(`https://${target.domains.api}/health/billing`),
    fetchJson(`https://${target.domains.api}/.well-known/purchases-jwks.json`),
    fetchJson(target.authGateway.jwksUrl),
  ]);
  const report = evaluateBillingPreflight({
    executionMode: resources.billingExecutionMode,
    expectedMainConsumer,
    expectedDlqConsumer,
    mainConsumer: queueConsumer(resources.queues.billing, apiConfig),
    dlqConsumer: queueConsumer(resources.queues.billingDlq, apiConfig),
    requiredMigrations,
    appliedMigrations,
    operationalCounts,
    health,
    purchasesJwks,
    authJwks,
    billingSecretNames: parseSecretNames(capture("npx", [
      "wrangler", "secret", "list", "--config", billingConfig,
    ])),
  });
  console.log(`Billing certification preflight: ${report.ready ? "READY" : "BLOCKED"}`);
  for (const item of report.checks) {
    console.log(`${item.passed ? "PASS" : "FAIL"} ${item.key}: ${item.detail}`);
  }
  if (args.json) console.log(JSON.stringify(report, null, 2));
  if (!report.ready) process.exitCode = 1;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    const text = await responseTextLimited(response, RESPONSE_LIMIT_BYTES);
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${url} did not return a JSON object`);
    }
    return value;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${url} timed out`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function responseTextLimited(response, limit) {
  const announced = Number(response.headers.get("content-length") || 0);
  if (announced > limit) throw new Error("Preflight response is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("Preflight response is too large");
        throw new Error("Preflight response is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function queueConsumer(queue, config) {
  return parseQueueConsumer(capture("npx", [
    "wrangler", "queues", "info", queue, "--config", config,
  ]));
}

function configPath(target, service, environment) {
  return resolve(root, "deploy", "generated", `${target}-${service}-${environment}.jsonc`);
}

function capture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return `${result.stdout}\n${result.stderr}`;
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8",
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) throw new Error(`${command} failed`);
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function operationalSql() {
  return [
    "SELECT 'billing_events_failed' AS metric, COUNT(*) AS value FROM billing_events WHERE status = 'failed'",
    "SELECT 'billing_events_stale' AS metric, COUNT(*) AS value FROM billing_events WHERE status = 'pending' AND datetime(received_at) <= datetime('now', '-15 minutes')",
    "SELECT 'provider_events_failed' AS metric, COUNT(*) AS value FROM billing_webhook_events WHERE status = 'failed'",
    "SELECT 'provider_events_stale' AS metric, COUNT(*) AS value FROM billing_webhook_events WHERE status = 'received' AND datetime(received_at) <= datetime('now', '-15 minutes')",
    "SELECT 'subscription_verification_failed' AS metric, COUNT(*) AS value FROM billing_subscriptions WHERE customer_id IS NOT NULL AND status NOT IN ('expired', 'revoked', 'refunded') AND provider_verification_status = 'failed'",
    "SELECT 'subscription_verification_stale' AS metric, COUNT(*) AS value FROM billing_subscriptions WHERE customer_id IS NOT NULL AND status NOT IN ('expired', 'revoked', 'refunded') AND provider_verification_status <> 'failed' AND ((provider_last_verified_at IS NULL AND datetime(updated_at) <= datetime('now', '-15 minutes')) OR datetime(provider_last_verified_at) <= datetime('now', '-15 minutes'))",
    "SELECT 'entitlement_deliveries_failed' AS metric, COUNT(*) AS value FROM billing_webhook_deliveries WHERE event_type = 'customer.entitlement.changed' AND status = 'failed'",
    "SELECT 'entitlement_deliveries_stale' AS metric, COUNT(*) AS value FROM billing_webhook_deliveries WHERE event_type = 'customer.entitlement.changed' AND status = 'pending' AND datetime(created_at) <= datetime('now', '-15 minutes')",
    "SELECT 'refund_actions_failed' AS metric, COUNT(*) AS value FROM billing_refund_provider_actions WHERE status = 'failed'",
    "SELECT 'refund_actions_stale' AS metric, COUNT(*) AS value FROM billing_refund_provider_actions WHERE status IN ('approved', 'queued') AND datetime(updated_at) <= datetime('now', '-15 minutes')",
    "SELECT 'refund_deadlines_missed' AS metric, COUNT(*) AS value FROM billing_refund_deadlines WHERE status = 'missed'",
    "SELECT 'dead_letters_quarantined' AS metric, COUNT(*) AS value FROM billing_dead_letters WHERE status = 'quarantined'",
  ].join("; ");
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) await main();
