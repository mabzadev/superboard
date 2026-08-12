#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { d1Descriptor } from "./cloudflare-d1-registry.mjs";
import {
  cloudflareEnv,
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";

export function parseProjectRef(value) {
  const match = /^(\d+)-(prod|test)$/u.exec(String(value ?? ""));
  if (!match) {
    throw new Error(
      "--project-ref must use <instance_id>-prod or <instance_id>-test",
    );
  }
  return {
    project_ref: `${match[1]}-${match[2]}`,
    instance_id: Number(match[1]),
    is_test: match[2] === "test" ? 1 : 0,
  };
}

export function staticAnalyticsReconciliationPlan({
  target,
  targetName,
  environment,
  projectRef,
}) {
  const project = parseProjectRef(projectRef);
  const resources = target.environments?.[environment];
  if (!resources)
    throw new Error(`${targetName} does not define ${environment}`);
  const blockers = [];
  if (target.features?.analytics !== true) {
    blockers.push({
      code: "analytics_feature_disabled",
      message: `Analytics is disabled for ${targetName}`,
    });
  }
  if (!resources.d1?.id) {
    blockers.push({
      code: "api_database_unprovisioned",
      message: "The central API D1 database is not provisioned",
    });
  }
  if (!resources.moduleD1?.analytics?.id) {
    blockers.push({
      code: "analytics_database_unprovisioned",
      message: "The Analytics D1 database is not provisioned",
    });
  }
  return {
    schema_version: 1,
    mode: "plan",
    target: targetName,
    environment,
    project,
    source_database: resources.d1?.name ?? null,
    analytics_database: resources.moduleD1?.analytics?.name ?? null,
    remote_read: false,
    ready: blockers.length === 0,
    blockers,
  };
}

export function buildAnalyticsReconciliationReport({
  plan,
  projectId,
  source,
  analytics,
  sourcePurchaseDimensions,
  analyticsPurchaseDimensions,
}) {
  const sourceDimensions = normalizeDimensions(sourcePurchaseDimensions);
  const analyticsDimensions = normalizeDimensions(analyticsPurchaseDimensions);
  const checks = [
    check(
      "installations",
      source.expected_installations,
      analytics.installations,
    ),
    check("verified_purchases", source.expected_purchases, analytics.purchases),
    check(
      "delivered_installation_outbox",
      source.expected_installations,
      source.delivered_installations,
    ),
    check(
      "delivered_purchase_outbox",
      source.expected_purchases,
      source.delivered_purchases,
    ),
    {
      id: "purchase_dimensions",
      expected: sourceDimensions,
      actual: analyticsDimensions,
      matches:
        JSON.stringify(sourceDimensions) ===
        JSON.stringify(analyticsDimensions),
    },
    {
      id: "outbox_dead_letters",
      expected: 0,
      actual: numeric(source.dead_letters),
      matches: numeric(source.dead_letters) === 0,
    },
    {
      id: "outbox_in_flight",
      expected: 0,
      actual: numeric(source.in_flight),
      matches: numeric(source.in_flight) === 0,
    },
  ];
  return {
    ...plan,
    mode: "remote-verify",
    remote_read: true,
    generated_at: new Date().toISOString(),
    project: { ...plan.project, project_id: String(projectId) },
    ready: plan.blockers.length === 0 && checks.every((item) => item.matches),
    checks,
    source: numericRecord(source),
    analytics: numericRecord(analytics),
    purchase_dimensions: {
      source: sourceDimensions,
      analytics: analyticsDimensions,
    },
  };
}

function check(id, expected, actual) {
  const normalizedExpected = numeric(expected);
  const normalizedActual = numeric(actual);
  return {
    id,
    expected: normalizedExpected,
    actual: normalizedActual,
    matches: normalizedExpected === normalizedActual,
  };
}

function normalizeDimensions(rows) {
  return rows
    .map((row) => ({
      store: String(row.store),
      environment: String(row.environment),
      event_type: String(row.event_type),
      currency:
        row.currency == null ? null : String(row.currency).toUpperCase(),
      facts: numeric(row.facts),
      amount_micros: numeric(row.amount_micros),
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right), "en"),
    );
}

function numericRecord(value) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, numeric(item)]),
  );
}

function numeric(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number))
    throw new Error(`Invalid numeric result: ${value}`);
  return number;
}

export function parseWranglerRows(output) {
  const parsed = JSON.parse(String(output));
  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  for (const candidate of candidates) {
    if (Array.isArray(candidate?.results)) return candidate.results;
    if (Array.isArray(candidate?.result?.results))
      return candidate.result.results;
  }
  throw new Error("Wrangler D1 output did not contain a results array");
}

function generateConfig(service, targetName, environment, env) {
  execFileSync(
    process.execPath,
    [
      `${root}/scripts/cloudflare-config.mjs`,
      "--service",
      service,
      "--target",
      targetName,
      "--environment",
      environment,
    ],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
  );
}

function queryRemote(descriptor, sql, env) {
  const output = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      descriptor.databaseName,
      "--remote",
      "--config",
      descriptor.configPath,
      "--command",
      sql,
      "--json",
    ],
    { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return parseWranglerRows(output);
}

const PURCHASE_TYPE_SQL = `CASE
  WHEN lower(transaction_row.event_type) LIKE '%chargeback%' THEN 'chargeback'
  WHEN lower(transaction_row.event_type) LIKE '%refund%'
    OR lower(transaction_row.status) IN ('refunded', 'revoked') THEN 'refund'
  WHEN lower(transaction_row.event_type) LIKE '%cancel%'
    OR lower(transaction_row.status) = 'cancelled' THEN 'cancellation'
  WHEN lower(transaction_row.event_type) LIKE '%renew%' THEN 'renewal'
  WHEN lower(transaction_row.event_type) LIKE '%trial%'
    AND (lower(transaction_row.event_type) LIKE '%convert%'
      OR lower(transaction_row.status) = 'active') THEN 'trial_converted'
  ELSE 'initial_purchase'
END`;

function sourceMetricsSql(projectId) {
  return `SELECT
    (SELECT COUNT(*) FROM installed_apps WHERE project_id = ${projectId}) AS expected_installations,
    (SELECT COUNT(*) FROM billing_transactions
      WHERE project_id = '${projectId}' AND verified_at IS NOT NULL
        AND store IN ('apple','google') AND environment IN ('sandbox','production')) AS expected_purchases,
    (SELECT COUNT(*) FROM analytics_fact_outbox
      WHERE project_id = '${projectId}' AND fact_key LIKE 'installation:%'
        AND status = 'delivered') AS delivered_installations,
    (SELECT COUNT(*) FROM analytics_fact_outbox
      WHERE project_id = '${projectId}' AND fact_key LIKE 'purchase:%'
        AND status = 'delivered') AS delivered_purchases,
    (SELECT COUNT(*) FROM analytics_fact_outbox
      WHERE project_id = '${projectId}' AND status = 'dead_letter') AS dead_letters,
    (SELECT COUNT(*) FROM analytics_fact_outbox
      WHERE project_id = '${projectId}' AND status IN ('pending','delivering')) AS in_flight`;
}

function sourcePurchaseDimensionsSql(projectId) {
  return `SELECT store, environment, event_type, currency, COUNT(*) AS facts,
    SUM(amount_micros) AS amount_micros FROM (
      SELECT transaction_row.store, transaction_row.environment,
        ${PURCHASE_TYPE_SQL} AS event_type,
        upper(NULLIF(transaction_row.currency, '')) AS currency,
        COALESCE(abs(transaction_row.price_micros), 0) AS amount_micros
      FROM billing_transactions transaction_row
      WHERE transaction_row.project_id = '${projectId}'
        AND transaction_row.verified_at IS NOT NULL
        AND transaction_row.store IN ('apple','google')
        AND transaction_row.environment IN ('sandbox','production')
    ) GROUP BY store, environment, event_type, currency
    ORDER BY store, environment, event_type, currency`;
}

function analyticsMetricsSql(projectId) {
  return `SELECT
    (SELECT COUNT(*) FROM analytics_installations WHERE project_id = '${projectId}') AS installations,
    (SELECT COUNT(*) FROM analytics_purchase_facts WHERE project_id = '${projectId}') AS purchases`;
}

function analyticsPurchaseDimensionsSql(projectId) {
  return `SELECT store, environment, event_type, upper(currency) AS currency,
    COUNT(*) AS facts, SUM(COALESCE(amount_micros, 0)) AS amount_micros
    FROM analytics_purchase_facts WHERE project_id = '${projectId}'
    GROUP BY store, environment, event_type, upper(currency)
    ORDER BY store, environment, event_type, upper(currency)`;
}

export async function run(
  argv = process.argv.slice(2),
  environmentVariables = process.env,
) {
  const args = parseArgs(argv);
  const targetName = targetNameFromArgs(args, environmentVariables);
  const environment = environmentFromArgs(args, environmentVariables);
  const projectRef = String(args["project-ref"] ?? "");
  const { target } = await loadTarget(targetName);
  const plan = staticAnalyticsReconciliationPlan({
    target,
    targetName,
    environment,
    projectRef,
  });
  if (!args.remote || !plan.ready) return plan;

  const env = cloudflareEnv(target, environmentVariables);
  generateConfig("api", targetName, environment, env);
  generateConfig("analytics", targetName, environment, env);
  const api = d1Descriptor(target, targetName, environment, "api");
  const analytics = d1Descriptor(target, targetName, environment, "analytics");
  const projectRows = queryRemote(
    api,
    `SELECT id FROM projects WHERE instance_id = ${plan.project.instance_id} AND is_test = ${plan.project.is_test} LIMIT 1`,
    env,
  );
  if (projectRows.length !== 1) {
    throw new Error(
      `Project ${plan.project.project_ref} was not found exactly once`,
    );
  }
  const projectId = Number(projectRows[0].id);
  if (!Number.isSafeInteger(projectId) || projectId < 1) {
    throw new Error("Resolved project id is invalid");
  }
  const source = queryRemote(api, sourceMetricsSql(projectId), env)[0];
  const targetMetrics = queryRemote(
    analytics,
    analyticsMetricsSql(projectId),
    env,
  )[0];
  const sourceDimensions = queryRemote(
    api,
    sourcePurchaseDimensionsSql(projectId),
    env,
  );
  const targetDimensions = queryRemote(
    analytics,
    analyticsPurchaseDimensionsSql(projectId),
    env,
  );
  return buildAnalyticsReconciliationReport({
    plan,
    projectId,
    source,
    analytics: targetMetrics,
    sourcePurchaseDimensions: sourceDimensions,
    analyticsPurchaseDimensions: targetDimensions,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (process.argv.includes("--require-ready") && !report.ready) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
