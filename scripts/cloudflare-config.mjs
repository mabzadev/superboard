import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { environmentFromArgs, loadTarget, parseArgs, root } from "./cloudflare-target.mjs";

const args = parseArgs();
const targetName = args.target ?? process.env.OPENGROW_TARGET ?? "vocostar";
const service = args.service ?? "api";
const environment = environmentFromArgs(args);
const preflight = Boolean(args.preflight);
if (!new Set(["api", "dashboard", "billing", "messaging", "growth"]).has(service)) throw new Error("--service must be api, dashboard, billing, messaging or growth");

const { target } = await loadTarget(targetName);
const resources = target.environments[environment];
if (!resources || !target.workers[service]?.[environment]) {
  throw new Error(`${targetName} does not define a ${environment} environment`);
}
if (!resources.d1.id || !resources.kv.id || (service === "messaging" && !resources.messagingD1.id) || (service === "growth" && !resources.growthD1.id)) {
  throw new Error(`Run cloudflare-bootstrap for ${targetName}/${environment} before generating configuration`);
}

const outputDirectory = resolve(root, "deploy", "generated");
await mkdir(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, `${targetName}-${service}-${environment}.jsonc`);
const config = service === "api" ? apiConfig()
  : service === "dashboard" ? dashboardConfig()
    : service === "billing" ? billingConfig()
      : service === "messaging" ? messagingConfig()
        : growthConfig();
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log(relative(root, outputPath));

function baseConfig() {
  return {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: target.workers[service][environment],
    account_id: target.accountId,
    compatibility_date: "2026-08-03",
    compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
    workers_dev: true,
    observability: { enabled: true, head_sampling_rate: 1 },
  };
}

function apiConfig() {
  const appUrl = environment === "production"
    ? `https://${target.domains.dashboard}`
    : `https://${target.workers.dashboard.staging}.${target.workersDevSubdomain}.workers.dev`;
  const config = {
    ...baseConfig(),
    main: "../../workers/api/src/index.ts",
    vars: {
      ENVIRONMENT: environment,
      SHORTLINK_DOMAIN: target.domains.shortlinks,
      API_DOMAIN: target.domains.shortlinks,
      SDK_DOMAIN: target.domains.sdk,
      CORS_ORIGIN: environment === "production" ? `https://${target.domains.dashboard}` : "*",
      APP_URL: appUrl,
      DASHBOARD_CLIENT_ID: target.oauth.dashboardClientId,
      OPENGROW_ACCESS_MODE: target.accessMode,
      REGISTRATION_MODE: target.registrationMode,
      REGISTRATION_REALM: `${target.target}:${environment}`,
      SSO_ENABLED: String(target.ssoEnabled),
      BILLING_EXECUTION_MODE: "local",
      MAIL_PROVIDER: target.mail.provider,
      MAIL_FROM: `${target.mail.fromName} <${target.mail.fromAddress}>`,
    },
    d1_databases: [{
      binding: "DB",
      database_name: resources.d1.name,
      database_id: resources.d1.id,
      migrations_dir: "../../workers/api/migrations",
    }],
    kv_namespaces: [{ binding: "KV", id: resources.kv.id }],
    r2_buckets: [{ binding: "R2", bucket_name: resources.r2.name }],
    send_email: [{
      name: "EMAIL",
      allowed_sender_addresses: [target.mail.fromAddress],
    }],
    queues: {
      producers: [
        { binding: "EVENT_QUEUE", queue: resources.queues.events },
        { binding: "PUSH_QUEUE", queue: resources.queues.push },
        { binding: "MAINTENANCE_QUEUE", queue: resources.queues.maintenance },
        { binding: "BILLING_QUEUE", queue: resources.queues.billing },
      ],
    },
    services: [
      { binding: "MESSAGING", service: target.workers.messaging[environment] },
      { binding: "BILLING", service: target.workers.billing[environment] },
      { binding: "GROWTH", service: target.workers.growth[environment] },
    ],
  };
  if (!preflight) {
    config.triggers = { crons: ["*/10 * * * *"] };
    config.queues.consumers = [
      queueConsumer(resources.queues.events, resources.queues.eventsDlq, 25, 10, 5),
      queueConsumer(resources.queues.push, resources.queues.pushDlq, 10, 5, 5),
      queueConsumer(resources.queues.maintenance, resources.queues.maintenanceDlq, 5, 10, 3),
      queueConsumer(resources.queues.billing, resources.queues.billingDlq, 10, 5, 8),
    ];
  }
  if (environment === "production" && !args["no-routes"] && !preflight) {
    config.routes = [
      { pattern: target.domains.shortlinks, custom_domain: true },
      { pattern: target.domains.sdk, custom_domain: true },
    ];
  }
  return config;
}

function billingConfig() {
  return {
    ...baseConfig(),
    workers_dev: false,
    main: "../../workers/billing/src/index.ts",
    vars: { ENVIRONMENT: environment, CREDENTIAL_KEY_SCOPE: "billing" },
    d1_databases: [{
      binding: "DB",
      database_name: resources.d1.name,
      database_id: resources.d1.id,
    }],
    kv_namespaces: [{ binding: "KV", id: resources.kv.id }],
    r2_buckets: [{ binding: "R2", bucket_name: resources.r2.name }],
    queues: {
      producers: [{ binding: "BILLING_QUEUE", queue: resources.queues.billing }],
    },
  };
}

function messagingConfig() {
  const config = {
    ...baseConfig(),
    main: "../../workers/messaging/src/index.ts",
    vars: {
      ENVIRONMENT: environment,
      VOCOSTAR_ISSUER: "https://api.vocostar.com",
      VOCOSTAR_AUDIENCE: "opengrow",
      VOCOSTAR_JWKS_URL: "https://api.vocostar.com/.well-known/jwks.json",
      ALLOWED_PROJECT_IDS: environment === "production" ? "11,12" : "",
      CORS_ORIGIN: environment === "production" ? `https://${target.domains.dashboard}` : "*",
    },
    d1_databases: [{
      binding: "DB",
      database_name: resources.messagingD1.name,
      database_id: resources.messagingD1.id,
      migrations_dir: "../../workers/messaging/migrations",
    }],
    r2_buckets: [{ binding: "ATTACHMENTS", bucket_name: resources.messagingR2.name }],
    durable_objects: {
      bindings: [{ name: "CONVERSATIONS", class_name: "ConversationRoom" }],
    },
    migrations: [{ tag: "v1", new_sqlite_classes: ["ConversationRoom"] }],
  };
  if (environment === "production" && !args["no-routes"] && !preflight) {
    config.routes = [{ pattern: target.domains.messaging, custom_domain: true }];
  }
  return config;
}

function growthConfig() {
  const config = {
    ...baseConfig(),
    workers_dev: false,
    main: "../../workers/growth/src/index.ts",
    vars: {
      ENVIRONMENT: environment,
      APPTWEAK_API_BASE_URL: "https://public-api.apptweak.com/api/public/store",
    },
    d1_databases: [{
      binding: "DB",
      database_name: resources.growthD1.name,
      database_id: resources.growthD1.id,
      migrations_dir: "../../workers/growth/migrations",
    }],
    queues: {
      producers: [{ binding: "GROWTH_QUEUE", queue: resources.queues.growth }],
    },
  };
  if (!preflight) {
    config.triggers = { crons: ["15 */6 * * *"] };
    config.queues.consumers = [queueConsumer(resources.queues.growth, resources.queues.growthDlq, 10, 5, 8)];
  }
  return config;
}

function dashboardConfig() {
  const apiUrl = environment === "production"
    ? `https://${target.domains.shortlinks}`
    : `https://${target.workers.api.staging}.${target.workersDevSubdomain}.workers.dev`;
  const appUrl = environment === "production"
    ? `https://${target.domains.dashboard}`
    : `https://${target.workers.dashboard.staging}.${target.workersDevSubdomain}.workers.dev`;
  const config = {
    ...baseConfig(),
    main: "../../apps/dashboard/.open-next/worker.js",
    assets: {
      directory: "../../apps/dashboard/.open-next/assets",
      binding: "ASSETS",
      run_worker_first: false,
    },
    services: [{
      binding: "WORKER_SELF_REFERENCE",
      service: target.workers.dashboard[environment],
    }],
    images: { binding: "IMAGES" },
    r2_buckets: [{
      binding: "NEXT_INC_CACHE_R2_BUCKET",
      bucket_name: resources.dashboardCache.name,
    }],
    vars: {
      NEXT_PUBLIC_API_URL: apiUrl,
      NEXT_PUBLIC_API_PATH: "/api/v1",
      NEXT_PUBLIC_CLIENT_ID: target.oauth.dashboardClientId,
      NEXT_PUBLIC_APP_URL: appUrl,
      NEXT_PUBLIC_ENV: environment,
      NEXT_PUBLIC_OPENGROW_ACCESS_MODE: target.accessMode,
      NEXT_PUBLIC_OPENGROW_EE: String(target.accessMode === "full"),
      NEXT_PUBLIC_REGISTRATION_MODE: target.registrationMode,
      NEXT_PUBLIC_SSO_ENABLED: String(target.ssoEnabled),
    },
  };
  if (environment === "production" && !args["no-routes"] && !preflight) {
    config.routes = [{ pattern: target.domains.dashboard, custom_domain: true }];
  }
  return config;
}

function queueConsumer(queue, deadLetterQueue, maxBatchSize, maxBatchTimeout, maxRetries) {
  return {
    queue,
    max_batch_size: maxBatchSize,
    max_batch_timeout: maxBatchTimeout,
    max_retries: maxRetries,
    dead_letter_queue: deadLetterQueue,
  };
}
