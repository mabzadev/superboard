#!/usr/bin/env node
import {
  X509Certificate,
  createHash,
  randomBytes,
  webcrypto,
} from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { generateIdentityKeyset } from "./superboard-generate-identity-keyset.mjs";
import { requiredSecretInventory } from "./cloudflare-secret-inventory.mjs";
import {
  cloudflareAccountId,
  cloudflareEnv,
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";

const APPLE_ROOT_G3_URL =
  "https://www.apple.com/certificateauthority/AppleRootCA-G3.cer";
const APPLE_ROOT_G3_SHA256 =
  "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179";
const MAX_CERTIFICATE_BYTES = 64 * 1024;

export function buildDevelopmentSecretPlan({
  target,
  environment,
  accountId,
  analyticsTokenConfigured,
}) {
  if (environment !== "development") {
    throw new Error(
      "Development secret bootstrap is forbidden outside development",
    );
  }
  if (target.mail?.transport !== "capture") {
    throw new Error(
      "Development secret bootstrap requires capture mail transport",
    );
  }
  const requirements = requiredSecretInventory(target, environment);
  const plan = {
    schemaVersion: 1,
    mode: "name-only-plan",
    target: target.target,
    accountAlias: target.accountAlias,
    accountFingerprint: createHash("sha256")
      .update(accountId)
      .digest("hex")
      .slice(0, 12),
    environment,
    valuesIncluded: false,
    appleTrustRoot: {
      source: APPLE_ROOT_G3_URL,
      sha256: APPLE_ROOT_G3_SHA256,
    },
    services: requirements.map(({ service, names, alternatives }) => ({
      service,
      names,
      alternatives,
      strategy:
        service === "dashboard"
          ? "rotate-dashboard-oauth"
          : "generate-and-upload-in-memory",
    })),
    optionalCapabilities: {
      analyticsQueries: analyticsTokenConfigured ? "enabled" : "disabled",
    },
    blockers: [],
  };
  return { ...plan, confirmation: developmentSecretConfirmation(plan) };
}

export function developmentSecretConfirmation(plan) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: plan.schemaVersion,
        target: plan.target,
        accountAlias: plan.accountAlias,
        accountFingerprint: plan.accountFingerprint,
        environment: plan.environment,
        appleTrustRoot: plan.appleTrustRoot,
        services: plan.services,
        optionalCapabilities: plan.optionalCapabilities,
        blockers: plan.blockers,
      }),
    )
    .digest("hex")
    .slice(0, 12);
  return `CLOUDFLARE:DEV-SECRETS:${plan.target}:${plan.environment}:${digest}`;
}

export async function generateDevelopmentSecretAssignments({
  target,
  environment,
  accountId,
  analyticsToken,
  appleRootBase64,
}) {
  const token = () => randomBytes(48).toString("base64url");
  const moduleToken = token();
  const emailToken = token();
  const filesToken = token();
  const observabilityToken = token();
  const customToken = token();
  const entitlementToken = token();
  const analyticsHashKey = token();
  const storeKeyVersion = "development-v1";
  const storeKeys = JSON.stringify({
    [storeKeyVersion]: randomBytes(32).toString("base64url"),
  });
  const purchasesKeyset = JSON.stringify(await generatePurchasesKeyset());
  const identityKeyset = JSON.stringify(await generateIdentityKeyset());
  const appleRoots = JSON.stringify([appleRootBase64]);
  const assignments = {
    api: {
      JWT_SECRET: token(),
      MODULE_INTERNAL_TOKEN: moduleToken,
      EMAIL_INTERNAL_TOKEN: emailToken,
      OPENGROW_CUTOVER_TOKEN: token(),
      PUSH_PROCESS_KEY: token(),
      IAP_PROCESS_KEY: token(),
      ADMIN_API_KEY: token(),
      MAINTENANCE_PROCESS_KEY: token(),
      DIAGNOSTICS_API_KEY: token(),
      OBSERVABILITY_INTERNAL_TOKEN: observabilityToken,
      STORE_CREDENTIALS_ACTIVE_KEY_VERSION: storeKeyVersion,
      STORE_CREDENTIALS_ENCRYPTION_KEYS: storeKeys,
      CUSTOM_WORKER_TOKEN: customToken,
      APPLE_ROOT_CERTIFICATES_B64: appleRoots,
      PURCHASES_SIGNING_KEYSET: purchasesKeyset,
      OPENGROW_ENTITLEMENT_WEBHOOK_SECRET: entitlementToken,
    },
    billing: {
      INTERNAL_API_TOKEN: moduleToken,
      APPLE_ROOT_CERTIFICATES_B64: appleRoots,
      PURCHASES_SIGNING_KEYSET: purchasesKeyset,
      STORE_CREDENTIALS_ACTIVE_KEY_VERSION: storeKeyVersion,
      STORE_CREDENTIALS_ENCRYPTION_KEYS: storeKeys,
      OPENGROW_ENTITLEMENT_WEBHOOK_SECRET: entitlementToken,
    },
    email: {
      EMAIL_INTERNAL_TOKEN: emailToken,
      MAIL_PREVIEW_TOKEN: token(),
    },
    identity: {
      INTERNAL_API_TOKEN: moduleToken,
      IDENTITY_KEYSET: identityKeyset,
      EMAIL_INTERNAL_TOKEN: emailToken,
      FILES_INTERNAL_TOKEN: filesToken,
    },
    files: {
      FILES_INTERNAL_TOKEN: filesToken,
      FILES_DOWNLOAD_SIGNING_KEY: token(),
    },
    observability: {
      OBSERVABILITY_INTERNAL_TOKEN: observabilityToken,
      ...(analyticsToken
        ? {
            CLOUDFLARE_ANALYTICS_ACCOUNT_ID: accountId,
            CLOUDFLARE_ANALYTICS_TOKEN: analyticsToken,
          }
        : {}),
    },
    custom: {
      CUSTOM_WORKER_TOKEN: customToken,
      ...(target.customWorker?.secrets.includes("FILES_INTERNAL_TOKEN")
        ? { FILES_INTERNAL_TOKEN: filesToken }
        : {}),
    },
    support: {
      INTERNAL_API_TOKEN: moduleToken,
      SUPPORT_WEBHOOK_ENCRYPTION_KEY: token(),
    },
    analytics: {
      INTERNAL_API_TOKEN: moduleToken,
      ANALYTICS_ID_HASH_KEY: analyticsHashKey,
    },
    marketing: {
      INTERNAL_API_TOKEN: moduleToken,
      EMAIL_INTERNAL_TOKEN: emailToken,
      ANALYTICS_ID_HASH_KEY: analyticsHashKey,
      SMTP_ENCRYPTION_KEY: token(),
      TRACKING_SIGNING_KEY: token(),
    },
  };
  for (const service of [
    "app",
    "products",
    "paywalls",
    "dynamic-links",
    "onboardings",
  ]) {
    if (target.features?.[service]) {
      assignments[service] = { INTERNAL_API_TOKEN: moduleToken };
    }
  }
  assertRequiredSecretCoverage(
    assignments,
    requiredSecretInventory(target, environment),
  );
  return assignments;
}

export function assertRequiredSecretCoverage(assignments, requirements) {
  for (const requirement of requirements) {
    if (requirement.service === "dashboard") continue;
    const names = new Set(Object.keys(assignments[requirement.service] ?? {}));
    const missing = requirement.names.filter((name) => !names.has(name));
    const missingAlternatives = requirement.alternatives.filter(
      ({ oneOf }) => !oneOf.some((name) => names.has(name)),
    );
    if (missing.length || missingAlternatives.length) {
      throw new Error(
        `Generated development secrets do not satisfy ${requirement.service}`,
      );
    }
  }
  return true;
}

async function fetchAppleRootG3(fetchImpl = fetch) {
  const response = await fetchImpl(APPLE_ROOT_G3_URL, {
    headers: { Accept: "application/x-x509-ca-cert" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      `Apple Root CA G3 download failed with HTTP ${response.status}`,
    );
  }
  const announced = Number(response.headers.get("content-length") ?? 0);
  if (announced > MAX_CERTIFICATE_BYTES) {
    throw new Error("Apple Root CA G3 exceeds the size limit");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CERTIFICATE_BYTES) {
    throw new Error("Apple Root CA G3 has an invalid size");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== APPLE_ROOT_G3_SHA256) {
    throw new Error("Apple Root CA G3 fingerprint does not match Apple PKI");
  }
  const certificate = new X509Certificate(bytes);
  if (!certificate.ca || !certificate.subject.includes("Apple Root CA - G3")) {
    throw new Error("Apple Root CA G3 certificate identity is invalid");
  }
  return Buffer.from(bytes).toString("base64");
}

async function generatePurchasesKeyset() {
  const pair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const key = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
  const kid = `purchases-${new Date().toISOString().slice(0, 10)}-${randomBytes(6).toString("hex")}`;
  return {
    active_kid: kid,
    keys: [{ ...key, kid, alg: "ES256", use: "sig", key_ops: ["sign"] }],
  };
}

function run(command, args, { env, input } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: env ?? process.env,
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed: ${String(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result;
}

function generateConfig(targetName, environment, service, env) {
  run(
    process.execPath,
    [
      resolve(root, "scripts", "cloudflare-config.mjs"),
      "--target",
      targetName,
      "--environment",
      environment,
      "--service",
      service,
      "--no-routes",
    ],
    { env },
  );
  return resolve(
    root,
    "deploy",
    "generated",
    `${targetName}-${service}-${environment}.jsonc`,
  );
}

export function versionedSecretBulkArgs(
  config,
  targetName,
  environment,
  service,
) {
  return [
    "wrangler",
    "versions",
    "secret",
    "bulk",
    "--config",
    config,
    "--message",
    `SuperBoard generated secrets for ${targetName}/${environment}/${service}`,
  ];
}

function uploadSecrets(targetName, environment, assignments, env) {
  const receipts = [];
  for (const [service, values] of Object.entries(assignments)) {
    const config = generateConfig(targetName, environment, service, env);
    run(
      "npx",
      versionedSecretBulkArgs(config, targetName, environment, service),
      { env, input: JSON.stringify(values) },
    );
    receipts.push({
      service,
      names: Object.keys(values).sort(),
      strategy: "inactive-version",
    });
  }
  return receipts;
}

async function rotateDashboardOAuth({ target, targetName, environment, env }) {
  const secret = randomBytes(48).toString("base64url");
  const digest = createHash("sha256").update(secret).digest("hex");
  const directory = await mkdtemp(
    join(tmpdir(), "superboard-oauth-bootstrap-"),
  );
  const sqlPath = join(directory, "rotate.sql");
  try {
    const clientId = String(target.oauth.dashboardClientId).replaceAll(
      "'",
      "''",
    );
    await writeFile(
      sqlPath,
      `
INSERT INTO oauth_applications (
  name, uid, secret, previous_secret, previous_secret_expires_at,
  redirect_uri, scopes
)
VALUES (
  'SuperBoard Dashboard', '${clientId}', '${digest}', NULL, NULL,
  'urn:ietf:wg:oauth:2.0:oob', 'read write'
)
ON CONFLICT(uid) DO UPDATE SET
  previous_secret = oauth_applications.secret,
  previous_secret_expires_at = datetime('now', '+30 minutes'),
  secret = excluded.secret,
  name = excluded.name,
  updated_at = datetime('now');
`,
      { encoding: "utf8", mode: 0o600 },
    );
    const dashboardConfig = generateConfig(
      targetName,
      environment,
      "dashboard",
      env,
    );
    run(
      "npx",
      versionedSecretBulkArgs(
        dashboardConfig,
        targetName,
        environment,
        "dashboard",
      ),
      { env, input: JSON.stringify({ CLIENT_SECRET: secret }) },
    );
    const apiConfig = generateConfig(targetName, environment, "api", env);
    run(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        "DB",
        "--remote",
        "--file",
        sqlPath,
        "--config",
        apiConfig,
      ],
      { env },
    );
    return {
      service: "dashboard",
      names: ["CLIENT_SECRET"],
      strategy: "inactive-version-with-bounded-database-overlap",
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { target } = await loadTarget(targetName);
  const accountId = cloudflareAccountId(target);
  const analyticsToken = String(
    process.env.CLOUDFLARE_ANALYTICS_TOKEN ?? "",
  ).trim();
  const plan = buildDevelopmentSecretPlan({
    target,
    environment,
    accountId,
    analyticsTokenConfigured: Boolean(analyticsToken),
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (!args.apply) {
    if (plan.blockers.length) process.exitCode = 2;
    return;
  }
  const expected = developmentSecretConfirmation(plan);
  if (args.confirm !== expected) {
    throw new Error(
      `Refusing development secret bootstrap: pass --confirm ${expected}`,
    );
  }
  if (plan.blockers.length) {
    throw new Error(
      "Refusing development secret bootstrap while blockers remain",
    );
  }
  const env = cloudflareEnv(target);
  const assignments = await generateDevelopmentSecretAssignments({
    target,
    environment,
    accountId,
    analyticsToken,
    appleRootBase64: await fetchAppleRootG3(),
  });
  const receipts = uploadSecrets(targetName, environment, assignments, env);
  receipts.push(
    await rotateDashboardOAuth({
      target,
      targetName,
      environment,
      env,
    }),
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: "applied",
        target: targetName,
        environment,
        valuesIncluded: false,
        services: receipts,
      },
      null,
      2,
    )}\n`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
