import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";
import {
  ALL_SERVICES,
  DOMAIN_SERVICES,
  DOMAIN_SERVICE_REGISTRY,
  PLATFORM_SERVICE_SECRETS,
  assertService,
  managedWorkerOperationalBinding,
  managedWorkerService,
} from "./cloudflare-services.mjs";
import {
  localMigrationFiles,
  targetD1Descriptors,
} from "./cloudflare-d1-registry.mjs";
import { loadTarget } from "./cloudflare-target.mjs";

const execFileAsync = promisify(execFile);

test("the declarative registry exposes exactly nine domain services", () => {
  assert.deepEqual(DOMAIN_SERVICES, [
    "app",
    "products",
    "paywalls",
    "dynamic-links",
    "support",
    "analytics",
    "marketing",
    "onboardings",
    "flows",
  ]);
  assert.equal(Object.keys(DOMAIN_SERVICE_REGISTRY).length, 9);
  for (const service of DOMAIN_SERVICES) {
    const definition = DOMAIN_SERVICE_REGISTRY[service];
    assert.match(definition.binding, /^[A-Z_]+_MODULE$/);
    assert.equal(definition.internalRoute, "/internal/v1");
    assert.ok(definition.secrets.includes("INTERNAL_API_TOKEN"));
  }
  assert.ok(!ALL_SERVICES.includes("growth"));
  assert.ok(ALL_SERVICES.includes("observability"));
  assert.ok(ALL_SERVICES.includes("mcp"));
  assert.deepEqual(PLATFORM_SERVICE_SECRETS.observability, [
    "OBSERVABILITY_INTERNAL_TOKEN",
    "OBSERVABILITY_INTERNAL_TOKEN_PREVIOUS",
    "CLOUDFLARE_ANALYTICS_ACCOUNT_ID",
    "CLOUDFLARE_ANALYTICS_TOKEN",
  ]);
  assert.deepEqual(PLATFORM_SERVICE_SECRETS.identity, [
    "IDENTITY_KEYSET",
    "MELODY_AUTH_SECRETS",
    "EMAIL_INTERNAL_TOKEN",
    "FILES_INTERNAL_TOKEN",
    "INTERNAL_API_TOKEN",
    "INTERNAL_API_TOKEN_PREVIOUS",
  ]);
  assert.deepEqual(PLATFORM_SERVICE_SECRETS.files, [
    "FILES_INTERNAL_TOKEN",
    "FILES_INTERNAL_TOKEN_PREVIOUS",
    "FILES_DOWNLOAD_SIGNING_KEY",
    "FILES_DOWNLOAD_SIGNING_KEY_PREVIOUS",
  ]);
  assert.deepEqual(PLATFORM_SERVICE_SECRETS.dashboard, ["CLIENT_SECRET"]);
  assert.deepEqual(PLATFORM_SERVICE_SECRETS.mcp, []);
  assert.ok(PLATFORM_SERVICE_SECRETS.api.includes("JWT_SECRET"));
  assert.ok(PLATFORM_SERVICE_SECRETS.api.includes("MODULE_INTERNAL_TOKEN"));
  assert.ok(PLATFORM_SERVICE_SECRETS.api.includes("FLOWS_INTERNAL_TOKEN"));
  assert.ok(
    PLATFORM_SERVICE_SECRETS.billing.includes("PURCHASES_SIGNING_KEYSET"),
  );
  assert.ok(PLATFORM_SERVICE_SECRETS.email.includes("SMTP_PASSWORD"));
  assert.equal(
    PLATFORM_SERVICE_SECRETS.email.includes("FLOWS_EMAIL_INTERNAL_TOKEN"),
    false,
  );
  for (const secrets of Object.values(PLATFORM_SERVICE_SECRETS)) {
    assert.equal(
      secrets.some((name) => /vocostar|mbza/i.test(name)),
      false,
      "common secret names must not contain an application or environment brand",
    );
  }
  for (const service of [
    "api",
    "dashboard",
    "billing",
    "messaging",
    "email",
    "identity",
    "files",
    "observability",
    "mcp",
  ]) {
    assert.ok(Array.isArray(PLATFORM_SERVICE_SECRETS[service]), service);
  }
});

test("all domain services are accepted by shared service validation", () => {
  for (const service of DOMAIN_SERVICES) {
    assert.doesNotThrow(() => assertService(service));
  }
  assert.throws(() => assertService("unknown"), /must be one of/);
});

test("generated Site config uses only explicit target resources and keeps public release disabled", async () => {
  for (const [targetName, environment] of [
    ["mbza-development", "development"],
    ["vocostar", "production"],
  ]) {
    execFileSync(
      process.execPath,
      [
        "scripts/cloudflare-config.mjs",
        "--service",
        "site",
        "--target",
        targetName,
        "--environment",
        environment,
        "--allow-unprovisioned",
      ],
      { cwd: new URL("..", import.meta.url), stdio: "pipe" },
    );
    const { target } = await loadTarget(targetName);
    const resources = target.environments[environment];
    const config = JSON.parse(
      readFileSync(
        new URL(
          `../deploy/generated/${targetName}-site-${environment}.jsonc`,
          import.meta.url,
        ),
        "utf8",
      ),
    );

    assert.equal(config.vars.SUPERBOARD_INSTANCE_ID, target.target);
    assert.equal(config.vars.SUPERBOARD_RELEASE_OPERATIONS, "disabled");
    assert.match(config.vars.D1_EXPECTED_MIGRATION, /^\d+.*\.sql$/u);
    assert.equal(config.compatibility_flags.includes("global_fetch_strictly_public"), false);
    assert.equal(config.d1_databases[0].database_name, resources.siteD1.name);
    assert.equal(config.d1_databases[0].database_id.length, 36);
    assert.equal(config.r2_buckets[0].bucket_name, resources.siteMedia.name);
    const namespaces = Object.fromEntries(
      config.kv_namespaces.map(({ binding, id }) => [binding, id]),
    );
    assert.equal(namespaces.SESSION.length, 32);
    assert.equal(namespaces.RELEASE_CACHE.length, 32);
    assert.equal(
      config.worker_loaders[0].binding,
      target.siteRuntime.workerLoaderBinding,
    );
    assert.deepEqual(config.triggers, { crons: target.siteRuntime.crons });
    assert.deepEqual(config.observability, target.siteRuntime.observability);
    assert.equal(config.routes, undefined);

    execFileSync(
      process.execPath,
      [
        "scripts/cloudflare-config.mjs",
        "--service",
        "api",
        "--target",
        targetName,
        "--environment",
        environment,
        "--allow-unprovisioned",
        "--no-routes",
      ],
      { cwd: new URL("..", import.meta.url), stdio: "pipe" },
    );
    const apiConfig = JSON.parse(
      readFileSync(
        new URL(
          `../deploy/generated/${targetName}-api-${environment}.jsonc`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const siteMonitor = JSON.parse(apiConfig.vars.PUBLIC_SURFACES_JSON).find(
      ({ id }) => id === "site-preview",
    );
    assert.equal(siteMonitor.url, `https://${target.domains.site}`);
    assert.equal(
      JSON.parse(apiConfig.vars.PLATFORM_WORKERS_JSON).workers.find(
        ({ id }) => id === "site",
      ).publicSurfaceIds.includes("site-preview"),
      true,
    );
  }
});

test("every D1 Worker receives the reviewed latest migration automatically", async () => {
  const targetName = "mbza-development";
  const environment = "development";
  const { target } = await loadTarget(targetName);
  const descriptors = targetD1Descriptors(
    target,
    targetName,
    environment,
    "all",
  );
  for (const descriptor of descriptors) {
    execFileSync(
      process.execPath,
      [
        "scripts/cloudflare-config.mjs",
        "--service",
        descriptor.service,
        "--target",
        targetName,
        "--environment",
        environment,
        "--allow-unprovisioned",
      ],
      { cwd: new URL("..", import.meta.url), stdio: "pipe" },
    );
    const config = JSON.parse(
      readFileSync(
        new URL(
          `../deploy/generated/${targetName}-${descriptor.service}-${environment}.jsonc`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const migrations = await localMigrationFiles(descriptor);
    assert.equal(
      config.vars.D1_EXPECTED_MIGRATION,
      migrations.at(-1),
      descriptor.service,
    );
    assert.equal(
      config.d1_databases[0].migrations_table,
      "d1_migrations",
      descriptor.service,
    );
  }
});

test("generated Analytics config declares its complete durable pipeline", () => {
  execFileSync(
    process.execPath,
    [
      "scripts/cloudflare-config.mjs",
      "--service",
      "analytics",
      "--target",
      "mbza-development",
      "--environment",
      "development",
      "--allow-unprovisioned",
    ],
    { cwd: new URL("..", import.meta.url), stdio: "pipe" },
  );
  const config = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/mbza-development-analytics-development.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(config.workers_dev, false);
  assert.equal(config.vars.SERVICE_NAME, "analytics");
  assert.deepEqual(config.r2_buckets, [
    {
      binding: "EVENT_ARCHIVE",
      bucket_name: "superboard-dev-analytics-events",
    },
  ]);
  assert.deepEqual(config.queues.producers, [
    {
      binding: "ANALYTICS_INGEST_QUEUE",
      queue: "superboard-dev-analytics-ingest",
    },
  ]);
  assert.equal(
    config.queues.consumers[0].dead_letter_queue,
    "superboard-dev-analytics-ingest-dlq",
  );
  assert.deepEqual(config.workflows, [
    {
      name: "superboard-analytics-dev-operations",
      binding: "ANALYTICS_OPERATIONS_WORKFLOW",
      class_name: "AnalyticsOperationsWorkflow",
    },
  ]);
  assert.deepEqual(config.triggers, { crons: ["* * * * *"] });
  assert.deepEqual(DOMAIN_SERVICE_REGISTRY.analytics.secrets, [
    "INTERNAL_API_TOKEN",
    "INTERNAL_API_TOKEN_PREVIOUS",
    "EMAIL_INTERNAL_TOKEN",
    "ANALYTICS_ID_HASH_KEY",
    "ANALYTICS_ID_HASH_KEY_PREVIOUS",
    "ANALYTICS_CONFIG_ENCRYPTION_KEY",
  ]);
  assert.deepEqual(config.services, [
    { binding: "MARKETING_MODULE", service: "superboard-marketing-dev" },
    { binding: "EMAIL_SERVICE", service: "superboard-email-dev" },
  ]);
});

test("generated Flows config declares its native Cloudflare runtime", () => {
  execFileSync(
    process.execPath,
    [
      "scripts/cloudflare-config.mjs",
      "--service",
      "flows",
      "--target",
      "mbza-development",
      "--environment",
      "development",
      "--allow-unprovisioned",
    ],
    { cwd: new URL("..", import.meta.url), stdio: "pipe" },
  );
  const config = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/mbza-development-flows-development.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(config.vars.SERVICE_NAME, "flows");
  assert.equal(config.vars.PUBLIC_API_URL, "https://api.mbza.dev");
  assert.equal(Object.hasOwn(config.vars, "PUBLIC_DASHBOARD_URL"), false);
  assert.deepEqual(config.r2_buckets, [
    {
      binding: "ARCHIVE",
      bucket_name: "superboard-dev-flows-archive",
    },
  ]);
  assert.deepEqual(config.queues.producers, [
    {
      binding: "FLOW_EVENTS",
      queue: "superboard-dev-flows-events",
    },
  ]);
  assert.equal(
    config.queues.consumers[0].dead_letter_queue,
    "superboard-dev-flows-events-dlq",
  );
  assert.deepEqual(config.durable_objects.bindings, [
    { name: "FLOW_USER_RUNTIME", class_name: "FlowUserRuntime" },
    { name: "FLOW_REALTIME_HUB", class_name: "FlowRealtimeHub" },
  ]);
  assert.deepEqual(config.migrations, [
    {
      tag: "v1",
      new_sqlite_classes: ["FlowUserRuntime", "FlowRealtimeHub"],
    },
  ]);
  assert.deepEqual(config.workflows, [
    {
      name: "superboard-flows-dev-delay",
      binding: "FLOW_DELAY_EXECUTION",
      class_name: "FlowDelayExecution",
    },
    {
      name: "superboard-flows-dev-maintenance",
      binding: "FLOW_MAINTENANCE_EXECUTION",
      class_name: "FlowMaintenanceExecution",
    },
  ]);
  assert.deepEqual(config.triggers, { crons: ["17 2 * * *"] });
  assert.deepEqual(config.services, [
    { binding: "PRODUCTS_MODULE", service: "superboard-products-dev" },
  ]);
  assert.deepEqual(DOMAIN_SERVICE_REGISTRY.flows.secrets, [
    "INTERNAL_API_TOKEN",
    "INTERNAL_API_TOKEN_PREVIOUS",
    "FLOW_USER_ENCRYPTION_KEY",
    "FLOW_USER_ENCRYPTION_KEY_PREVIOUS",
    "FLOW_USER_HASH_KEY",
  ]);
});

test("generated domain config is private and has no static project allowlist", () => {
  execFileSync(
    process.execPath,
    [
      "scripts/cloudflare-config.mjs",
      "--service",
      "marketing",
      "--target",
      "vocostar",
      "--environment",
      "production",
      "--allow-unprovisioned",
      "--preflight",
    ],
    { cwd: new URL("..", import.meta.url), stdio: "pipe" },
  );
  const config = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/vocostar-marketing-production.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(config.workers_dev, false);
  assert.equal(config.vars.SERVICE_NAME, "marketing");
  assert.equal(config.vars.ALLOWED_PROJECT_IDS, undefined);
  assert.equal(config.d1_databases[0].binding, "DB");
  assert.deepEqual(config.r2_buckets, [
    { binding: "MEDIA", bucket_name: "opengrow-marketing-media" },
  ]);
  assert.deepEqual(config.queues.producers, [
    { binding: "MARKETING_QUEUE", queue: "opengrow-marketing-delivery" },
  ]);
  assert.equal(config.vars.QUEUE_NAME, "opengrow-marketing-delivery");
  assert.equal(config.vars.DLQ_NAME, "opengrow-marketing-delivery-dlq");
  assert.equal(config.vars.PUBLIC_API_URL, "https://api.vocostar.com");
  assert.deepEqual(config.services, [
    { binding: "EMAIL_SERVICE", service: "opengrow-email" },
  ]);
  assert.deepEqual(DOMAIN_SERVICE_REGISTRY.marketing.secrets, [
    "INTERNAL_API_TOKEN",
    "INTERNAL_API_TOKEN_PREVIOUS",
    "EMAIL_INTERNAL_TOKEN",
    "ANALYTICS_ID_HASH_KEY",
    "ANALYTICS_ID_HASH_KEY_PREVIOUS",
    "SMTP_ENCRYPTION_KEY",
    "TRACKING_SIGNING_KEY",
  ]);
});

test("generated Support config includes its stateful runtime resources", () => {
  execFileSync(
    process.execPath,
    [
      "scripts/cloudflare-config.mjs",
      "--service",
      "support",
      "--target",
      "vocostar",
      "--environment",
      "production",
      "--allow-unprovisioned",
    ],
    { cwd: new URL("..", import.meta.url), stdio: "pipe" },
  );
  const config = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/vocostar-support-production.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(config.r2_buckets, [
    {
      binding: "ATTACHMENTS",
      bucket_name: "opengrow-support-v2-attachments",
    },
  ]);
  assert.deepEqual(config.durable_objects.bindings, [
    { name: "CONVERSATIONS", class_name: "ConversationRoom" },
  ]);
  assert.deepEqual(config.queues.producers, [
    { binding: "SUPPORT_QUEUE", queue: "opengrow-support-v2-events" },
    { binding: "SUPPORT_AI_QUEUE", queue: "opengrow-support-v2-ai" },
    { binding: "SUPPORT_BULK_QUEUE", queue: "opengrow-support-v2-bulk" },
  ]);
  assert.equal(config.queues.consumers[0].queue, "opengrow-support-v2-events");
  assert.equal(
    config.queues.consumers[0].dead_letter_queue,
    "opengrow-support-v2-events-dlq",
  );
  assert.equal(config.queues.consumers[1].queue, "opengrow-support-v2-ai");
  assert.equal(config.queues.consumers[1].max_retries, 5);
  assert.equal(config.queues.consumers[2].queue, "opengrow-support-v2-bulk");
  assert.equal(config.vars.QUEUE_NAME, "opengrow-support-v2-events");
  assert.equal(config.vars.DLQ_NAME, "opengrow-support-v2-events-dlq");
  assert.equal(
    config.vars.SUPPORT_EVENTS_QUEUE_NAME,
    "opengrow-support-v2-events",
  );
  assert.equal(
    config.vars.SUPPORT_EVENTS_DLQ_NAME,
    "opengrow-support-v2-events-dlq",
  );
  assert.equal(config.vars.SUPPORT_AI_QUEUE_NAME, "opengrow-support-v2-ai");
  assert.equal(
    config.vars.SUPPORT_AI_DLQ_NAME,
    "opengrow-support-v2-ai-dlq",
  );
  assert.equal(
    config.vars.SUPPORT_BULK_QUEUE_NAME,
    "opengrow-support-v2-bulk",
  );
  assert.equal(
    config.vars.SUPPORT_BULK_DLQ_NAME,
    "opengrow-support-v2-bulk-dlq",
  );
  assert.deepEqual(config.queues.consumers[3], {
    queue: "opengrow-support-v2-events-dlq",
    max_batch_size: 10,
    max_batch_timeout: 5,
    max_retries: 100,
  });
  assert.deepEqual(config.ai, { binding: "AI" });
  assert.deepEqual(config.vectorize, [
    {
      binding: "SUPPORT_KNOWLEDGE",
      index_name: "opengrow-support-v2-knowledge",
    },
  ]);
  assert.equal(
    config.vars.SUPPORT_EMBEDDING_MODEL,
    "@cf/qwen/qwen3-embedding-0.6b",
  );
  assert.equal(
    config.vars.SUPPORT_GENERATION_MODEL,
    "@cf/zai-org/glm-4.7-flash",
  );
  assert.deepEqual(config.services, [
    { binding: "EMAIL_SERVICE", service: "opengrow-email" },
    { binding: "API_SERVICE", service: "opengrow-api" },
  ]);
  assert.deepEqual(config.triggers, { crons: ["* * * * *"] });
  assert.deepEqual(config.secrets.required, [
    "EMAIL_INTERNAL_TOKEN",
    "INTERNAL_API_TOKEN",
    "SUPPORT_CREDENTIAL_ENCRYPTION_KEY",
    "SUPPORT_WEBHOOK_ENCRYPTION_KEY",
  ]);
  assert.deepEqual(DOMAIN_SERVICE_REGISTRY.support.secrets, [
    "INTERNAL_API_TOKEN",
    "INTERNAL_API_TOKEN_PREVIOUS",
    "EMAIL_INTERNAL_TOKEN",
    "SUPPORT_CREDENTIAL_ENCRYPTION_KEY",
    "SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS",
    "SUPPORT_WEBHOOK_ENCRYPTION_KEY",
  ]);
  assert.deepEqual(
    DOMAIN_SERVICE_REGISTRY.support.queue,
    DOMAIN_SERVICE_REGISTRY.support.queues[0],
  );
});

test("generated Files config enforces the selected target upload policy", () => {
  for (const [target, environment] of [
    ["mbza-development", "development"],
    ["vocostar", "production"],
  ]) {
    execFileSync(
      process.execPath,
      [
        "scripts/cloudflare-config.mjs",
        "--service",
        "files",
        "--target",
        target,
        "--environment",
        environment,
        "--allow-unprovisioned",
      ],
      { cwd: new URL("..", import.meta.url), stdio: "pipe" },
    );
  }
  const development = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/mbza-development-files-development.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const production = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/vocostar-files-production.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(development.vars.MAX_FILE_BYTES, "10485760");
  assert.deepEqual(
    JSON.parse(development.vars.ALLOWED_FILE_CONTENT_TYPES_JSON),
    [
      "application/json",
      "application/octet-stream",
      "application/pdf",
      "image/jpeg",
      "image/png",
      "text/plain",
    ],
  );
  assert.equal(production.vars.MAX_FILE_BYTES, "52428800");
  assert.ok(
    JSON.parse(production.vars.ALLOWED_FILE_CONTENT_TYPES_JSON).includes(
      "audio/*",
    ),
  );
  assert.ok(
    JSON.parse(production.vars.ALLOWED_FILE_CONTENT_TYPES_JSON).includes(
      "video/*",
    ),
  );
});

test("generated Email and Marketing configs quarantine terminal queue failures", () => {
  for (const service of ["email", "marketing"]) {
    execFileSync(
      process.execPath,
      [
        "scripts/cloudflare-config.mjs",
        "--service",
        service,
        "--target",
        "vocostar",
        "--environment",
        "production",
        "--allow-unprovisioned",
      ],
      { cwd: new URL("..", import.meta.url), stdio: "pipe" },
    );
  }
  const email = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/vocostar-email-production.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(email.vars.EMAIL_QUEUE_NAME, "opengrow-email-delivery");
  assert.equal(email.vars.EMAIL_DLQ_NAME, "opengrow-email-delivery-dlq");
  assert.equal(
    email.queues.consumers[0].dead_letter_queue,
    email.vars.EMAIL_DLQ_NAME,
  );
  assert.equal(email.queues.consumers[1].queue, email.vars.EMAIL_DLQ_NAME);
  assert.equal(email.queues.consumers[1].dead_letter_queue, undefined);
  assert.deepEqual(email.secrets.required, [
    "AWS_SES_SMTP_PASSWORD",
    "AWS_SES_SMTP_USERNAME",
    "AWS_SES_SNS_TOPIC_ARN",
    "EMAIL_INTERNAL_TOKEN",
  ]);

  const marketing = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/vocostar-marketing-production.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(
    marketing.queues.consumers[0].dead_letter_queue,
    marketing.vars.DLQ_NAME,
  );
  assert.equal(marketing.queues.consumers[1].queue, marketing.vars.DLQ_NAME);
  assert.equal(marketing.queues.consumers[1].dead_letter_queue, undefined);
  assert.deepEqual(marketing.secrets.required, [
    "ANALYTICS_ID_HASH_KEY",
    "EMAIL_INTERNAL_TOKEN",
    "INTERNAL_API_TOKEN",
    "SMTP_ENCRYPTION_KEY",
    "TRACKING_SIGNING_KEY",
  ]);
  assert.deepEqual(marketing.services, [
    { binding: "EMAIL_SERVICE", service: "opengrow-email" },
  ]);
});

test("domain secret rotation accepts only secrets declared by the registry", () => {
  const rejected = spawnSync(
    process.execPath,
    [
      "scripts/cloudflare-set-secret.mjs",
      "--service",
      "marketing",
      "--target",
      "vocostar",
      "--environment",
      "production",
      "--name",
      "UNDECLARED_SECRET",
    ],
    {
      cwd: new URL("..", import.meta.url),
      input: "not-uploaded",
      encoding: "utf8",
    },
  );
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /is not declared for marketing/);
});

test("legacy single-binding secret upload never reads or mutates an allowed value", () => {
  const marker = "must-never-appear-in-output";
  const rejected = spawnSync(
    process.execPath,
    [
      "scripts/cloudflare-set-secret.mjs",
      "--service",
      "api",
      "--target",
      "vocostar",
      "--environment",
      "production",
      "--name",
      "EMAIL_INTERNAL_TOKEN",
    ],
    {
      cwd: new URL("..", import.meta.url),
      input: marker,
      encoding: "utf8",
    },
  );
  assert.equal(rejected.status, 2);
  assert.equal(rejected.stderr, "");
  assert.doesNotMatch(rejected.stdout, new RegExp(marker));
  const plan = JSON.parse(rejected.stdout);
  assert.equal(plan.mutationPerformed, false);
  assert.equal(plan.valuesRead, false);
  assert.equal(plan.owningContract.id, "email-internal-token");
  assert.match(plan.replacement.command, /cloudflare:secrets:upload/u);
});

test("legacy Dashboard secret upload redirects to paired OAuth rotation", () => {
  const rejected = spawnSync(
    process.execPath,
    [
      "scripts/cloudflare-set-secret.mjs",
      "--service",
      "dashboard",
      "--target",
      "vocostar",
      "--environment",
      "production",
      "--name",
      "CLIENT_SECRET",
    ],
    {
      cwd: new URL("..", import.meta.url),
      input: "not-read",
      encoding: "utf8",
    },
  );
  assert.equal(rejected.status, 2);
  const plan = JSON.parse(rejected.stdout);
  assert.equal(plan.owningContract.id, "dashboard-client-secret");
  assert.match(plan.replacement.command, /cloudflare:rotate-oauth/u);
});

test("observability secret rotation rejects undeclared values before invoking Wrangler", () => {
  const rejected = spawnSync(
    process.execPath,
    [
      "scripts/cloudflare-set-secret.mjs",
      "--service",
      "observability",
      "--target",
      "vocostar",
      "--environment",
      "production",
      "--name",
      "UNDECLARED_SECRET",
    ],
    {
      cwd: new URL("..", import.meta.url),
      input: "not-uploaded",
      encoding: "utf8",
    },
  );
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /is not declared for observability/);
});

test("all common platform services reject undeclared secret names", () => {
  for (const service of [
    "api",
    "dashboard",
    "billing",
    "messaging",
    "email",
    "identity",
    "files",
    "mcp",
  ]) {
    const rejected = spawnSync(
      process.execPath,
      [
        "scripts/cloudflare-set-secret.mjs",
        "--service",
        service,
        "--target",
        "vocostar",
        "--environment",
        "production",
        "--name",
        "UNDECLARED_SECRET",
      ],
      {
        cwd: new URL("..", import.meta.url),
        input: "not-uploaded",
        encoding: "utf8",
      },
    );
    assert.notEqual(rejected.status, 0, service);
    assert.match(rejected.stderr, /is not declared/u, service);
  }
});

test("generated observability config attaches an Analytics Engine dataset and no tail loop", () => {
  execFileSync(
    process.execPath,
    [
      "scripts/cloudflare-config.mjs",
      "--service",
      "observability",
      "--target",
      "mbza-development",
      "--environment",
      "development",
      "--allow-unprovisioned",
    ],
    { cwd: new URL("..", import.meta.url), stdio: "pipe" },
  );
  const config = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/mbza-development-observability-development.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(config.name, "superboard-observability-dev");
  assert.equal(config.workers_dev, false);
  assert.equal(config.tail_consumers, undefined);
  assert.deepEqual(config.analytics_engine_datasets, [
    { binding: "ANALYTICS", dataset: "superboard_mbza_development" },
  ]);
});

test("staged production API stays private while exposing service bindings", async () => {
  execFileSync(
    process.execPath,
    [
      "scripts/cloudflare-config.mjs",
      "--service",
      "api",
      "--target",
      "vocostar",
      "--environment",
      "production",
      "--allow-unprovisioned",
    ],
    { cwd: new URL("..", import.meta.url), stdio: "pipe" },
  );
  const config = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/vocostar-api-production.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.tail_consumers, [
    { service: "opengrow-observability" },
  ]);
  assert.deepEqual(
    config.services.find(({ binding }) => binding === "OBSERVABILITY"),
    {
      binding: "OBSERVABILITY",
      service: "opengrow-observability",
    },
  );
  assert.deepEqual(
    config.services.find(({ binding }) => binding === "IDENTITY_SERVICE"),
    {
      binding: "IDENTITY_SERVICE",
      service: "opengrow-identity",
    },
  );
  assert.deepEqual(
    config.services.find(({ binding }) => binding === "FILES_SERVICE"),
    {
      binding: "FILES_SERVICE",
      service: "opengrow-files",
    },
  );
  assert.equal(config.routes, undefined);
  assert.deepEqual(
    JSON.parse(config.vars.PUBLIC_SURFACES_JSON).find(
      ({ id }) => id === "legacy-chatwoot",
    ),
    {
      id: "legacy-chatwoot",
      url: "https://chat.vocostar.com",
      healthUrl: "https://chat.vocostar.com/ready",
      description:
        "Legacy Chatwoot migration source; keep read-only until OpenGrow Support acceptance and retention sign-off, then remove this monitor with the service",
    },
  );
  for (const [queueName, dlqName] of [
    [config.vars.EVENT_QUEUE_NAME, config.vars.EVENT_DLQ_NAME],
    [config.vars.PUSH_QUEUE_NAME, config.vars.PUSH_DLQ_NAME],
    [config.vars.MAINTENANCE_QUEUE_NAME, config.vars.MAINTENANCE_DLQ_NAME],
  ]) {
    assert.equal(
      config.queues.consumers.find(({ queue }) => queue === queueName)
        ?.dead_letter_queue,
      dlqName,
    );
    const quarantine = config.queues.consumers.find(
      ({ queue }) => queue === dlqName,
    );
    assert.ok(quarantine);
    assert.equal(quarantine.dead_letter_queue, undefined);
  }

  execFileSync(
    process.execPath,
    [
      "scripts/cloudflare-config.mjs",
      "--service",
      "api",
      "--target",
      "mbza-development",
      "--environment",
      "development",
      "--allow-unprovisioned",
    ],
    {
      cwd: new URL("..", import.meta.url),
      stdio: "pipe",
      env: {
        ...process.env,
        SUPERBOARD_RELEASE: "superboard-test-release",
        OPENGROW_RELEASE: "legacy-test-release",
      },
    },
  );
  const mbza = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/mbza-development-api-development.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const publicSurfaces = JSON.parse(mbza.vars.PUBLIC_SURFACES_JSON);
  const workerCatalog = JSON.parse(mbza.vars.PLATFORM_WORKERS_JSON);
  assert.equal(mbza.vars.OPENGROW_RELEASE, "superboard-test-release");
  assert.deepEqual(
    workerCatalog.workers.map(({ id }) => id),
    ALL_SERVICES,
  );
  assert.deepEqual(
    workerCatalog.workers.find(({ id }) => id === "api"),
    {
      id: "api",
      workerName: "superboard-api-dev",
      enabled: true,
      publicSurfaceIds: ["api", "sdk", "shortlinks"],
    },
  );
  assert.deepEqual(
    workerCatalog.workers.find(({ id }) => id === "messaging"),
    {
      id: "messaging",
      workerName: null,
      enabled: false,
      publicSurfaceIds: [],
    },
  );
  assert.deepEqual(workerCatalog.customDependencies, []);
  assert.deepEqual(JSON.parse(mbza.vars.CORS_ORIGINS_JSON), [
    "https://board.mbza.dev",
    "https://auth.mbza.dev",
    "https://reference.mbza.dev",
  ]);
  assert.deepEqual(
    publicSurfaces.map(({ id }) => id),
    [
      "api",
      "sdk",
      "shortlinks",
      "files",
      "dashboard",
    "mcp",
    "mail-preview",
    "site-preview",
    "reference",
    ],
  );
  assert.deepEqual(
    publicSurfaces.find(({ id }) => id === "reference"),
    {
      id: "reference",
      url: "https://reference.mbza.dev",
      healthUrl: "https://reference.mbza.dev/",
      description:
        "Executable Flutter Web acceptance application for the common SuperBoard journeys",
    },
  );

  const vocostarCatalog = JSON.parse(config.vars.PLATFORM_WORKERS_JSON);
  const { target: vocostarTarget } = await loadTarget("vocostar");
  const expectedManaged = vocostarTarget.customWorker.managedWorkers.map(
    (component) => ({
      id: managedWorkerService(component),
      workerName: component.workers.production,
      binding: managedWorkerOperationalBinding(component),
    }),
  );
  assert.deepEqual(
    vocostarCatalog.workers
      .filter(({ managed }) => managed)
      .map(({ id, workerName, managed }) => ({
        id,
        workerName,
        binding: managed.binding,
      })),
    expectedManaged,
  );
  for (const component of expectedManaged) {
    assert.deepEqual(
      config.services.find(({ binding }) => binding === component.binding),
      { binding: component.binding, service: component.workerName },
    );
  }
  assert.deepEqual(vocostarCatalog.customDependencies, [
    {
      binding: "VOCALS_ORCHESTRATOR",
      workerName: "send-users-vocals-orchestrator",
    },
    {
      binding: "MEDIAS_ORCHESTRATOR",
      workerName: "send-users-medias-orchestrator",
    },
    { binding: "FILES_SERVICE", workerName: "opengrow-files" },
  ]);
  assert.equal(JSON.stringify(vocostarCatalog).includes("TOKEN"), false);
});

test("parallel configuration generation publishes only complete atomic JSON", async () => {
  const cwd = new URL("..", import.meta.url);
  const command = [
    "scripts/cloudflare-config.mjs",
    "--service",
    "api",
    "--target",
    "vocostar",
    "--environment",
    "production",
    "--allow-unprovisioned",
  ];
  const rejected = spawnSync(
    process.execPath,
    [...command, "--output-suffix", "../escape"],
    { cwd, encoding: "utf8" },
  );
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /safe lowercase name/u);
  await Promise.all(
    Array.from({ length: 8 }, () =>
      execFileAsync(process.execPath, command, { cwd }),
    ),
  );
  const config = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/vocostar-api-production.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(config.name, "opengrow-api");
  assert.equal(config.routes, undefined);
});

test("generated MCP config is public only on its target domain and uses a private API binding", () => {
  execFileSync(
    process.execPath,
    [
      "scripts/cloudflare-config.mjs",
      "--service",
      "mcp",
      "--target",
      "mbza-development",
      "--environment",
      "development",
    ],
    { cwd: new URL("..", import.meta.url), stdio: "pipe" },
  );
  const config = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/mbza-development-mcp-development.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(config.name, "superboard-mcp-dev");
  assert.equal(config.main, "../../workers/mcp/src/index.ts");
  assert.equal(config.workers_dev, false);
  assert.equal(config.vars.PUBLIC_API_URL, "https://api.mbza.dev");
  assert.equal(config.vars.PUBLIC_MCP_URL, "https://mcp.mbza.dev");
  assert.equal(config.vars.MCP_DOMAIN, "mcp.mbza.dev");
  assert.deepEqual(config.services, [
    { binding: "API_SERVICE", service: "superboard-api-dev" },
  ]);
  assert.deepEqual(config.routes, [
    { pattern: "mcp.mbza.dev", custom_domain: true },
  ]);
  assert.deepEqual(config.tail_consumers, [
    { service: "superboard-observability-dev" },
  ]);
});

test("generated identity and files configs are private and parameterized", () => {
  for (const service of ["identity", "files"]) {
    execFileSync(
      process.execPath,
      [
        "scripts/cloudflare-config.mjs",
        "--service",
        service,
        "--target",
        "mbza-development",
        "--environment",
        "development",
        "--allow-unprovisioned",
      ],
      { cwd: new URL("..", import.meta.url), stdio: "pipe" },
    );
  }
  const identity = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/mbza-development-identity-development.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const files = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/mbza-development-files-development.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(identity.workers_dev, false);
  assert.equal(
    identity.vars.APPLICATION_AUDIENCE,
    "mbza-development.application",
  );
  assert.equal(identity.vars.GOOGLE_AUDIENCES_JSON, "[]");
  assert.equal(
    identity.d1_databases[0].database_name,
    "superboard-dev-identity-db",
  );
  assert.deepEqual(
    identity.services.map(({ binding }) => binding),
    ["EMAIL_SERVICE", "FILES_SERVICE"],
  );
  assert.deepEqual(identity.assets, {
    directory: "../../workers/identity/dist",
    binding: "ASSETS",
    run_worker_first: true,
  });
  assert.equal(identity.vars.AUTH_SERVER_URL, "https://auth.mbza.dev");
  assert.equal(identity.vars.EMAIL_PROVIDER_NAME, "superboard");
  assert.equal(identity.vars.ENABLE_SAML_SSO_AS_SP, true);
  assert.equal(files.workers_dev, false);
  assert.equal(
    files.vars.AUTH_GATEWAY_JWKS_URL,
    "https://auth.mbza.dev/.well-known/jwks.json",
  );
  assert.equal(files.vars.FILES_PUBLIC_ORIGIN, "https://files.mbza.dev");
  assert.equal(files.vars.DOWNLOAD_TICKET_TTL_SECONDS, "600");
  assert.equal(files.d1_databases[0].database_name, "superboard-dev-files-db");
  assert.equal(files.r2_buckets[0].bucket_name, "superboard-dev-files");
});

test("generated VocoStar custom config declares all legacy bridges through the target", () => {
  execFileSync(
    process.execPath,
    [
      "scripts/cloudflare-config.mjs",
      "--service",
      "custom",
      "--target",
      "vocostar",
      "--environment",
      "production",
    ],
    { cwd: new URL("..", import.meta.url), stdio: "pipe" },
  );
  const config = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/vocostar-custom-production.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(config.workers_dev, false);
  assert.equal(config.main, "../../workers/custom/vocostar/src/index.ts");
  assert.deepEqual(config.d1_databases, [
    {
      binding: "VOCOSTAR_DB",
      database_name: "vocostar-db",
      database_id: "07c6f044-e00a-421f-90de-b56db7bcfc40",
      migrations_dir: "../../workers/custom/vocostar/migrations",
      migrations_table: "d1_migrations",
    },
  ]);
  assert.deepEqual(config.services, [
    {
      binding: "VOCALS_ORCHESTRATOR",
      service: "send-users-vocals-orchestrator",
    },
    {
      binding: "MEDIAS_ORCHESTRATOR",
      service: "send-users-medias-orchestrator",
    },
    {
      binding: "FILES_SERVICE",
      service: "opengrow-files",
    },
  ]);
  assert.deepEqual(config.triggers, { crons: ["*/1 * * * *"] });
  assert.equal(config.vars.LEGACY_FILE_ORIGIN, undefined);
  assert.equal(
    config.vars.CUSTOM_WORKER_CAPABILITIES,
    "vocostar.voice.clone,vocostar.media.convert,vocostar.jobs.read,vocostar.jobs.cancel,vocostar.jobs.retry",
  );
});

test("generated reference custom config owns its durable D1 job store", () => {
  const target = JSON.parse(
    readFileSync(
      new URL("../deploy/targets/mbza-development.json", import.meta.url),
      "utf8",
    ),
  );
  execFileSync(
    process.execPath,
    [
      "scripts/cloudflare-config.mjs",
      "--service",
      "custom",
      "--target",
      "mbza-development",
      "--environment",
      "development",
      "--allow-unprovisioned",
    ],
    { cwd: new URL("..", import.meta.url), stdio: "pipe" },
  );
  const config = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/mbza-development-custom-development.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(config.workers_dev, false);
  assert.equal(config.main, "../../workers/custom/reference/src/index.ts");
  assert.equal(
    config.vars.CUSTOM_WORKER_CAPABILITIES,
    "reference.echo,reference.acceptance",
  );
  assert.equal(config.vars.REFERENCE_JOB_RETENTION_DAYS, "30");
  assert.deepEqual(config.d1_databases, [
    {
      binding: "REFERENCE_DB",
      database_name: "superboard-dev-custom-reference-db",
      database_id: target.environments.development.customD1.id,
      migrations_dir: "../../workers/custom/reference/migrations",
      migrations_table: "d1_migrations",
    },
  ]);
  assert.equal(config.services, undefined);
  assert.deepEqual(config.triggers, { crons: ["0 3 * * *"] });
});

test("custom preflight versions are isolated from scheduled triggers", () => {
  execFileSync(
    process.execPath,
    [
      "scripts/cloudflare-config.mjs",
      "--service",
      "custom",
      "--target",
      "vocostar",
      "--environment",
      "production",
      "--preflight",
    ],
    { cwd: new URL("..", import.meta.url), stdio: "pipe" },
  );
  const config = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/generated/vocostar-custom-production.jsonc",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(config.triggers, undefined);
  assert.equal(config.routes, undefined);
});

test("custom secret rotation is restricted by each target manifest", () => {
  const rejected = spawnSync(
    process.execPath,
    [
      "scripts/cloudflare-set-secret.mjs",
      "--service",
      "custom",
      "--target",
      "vocostar",
      "--environment",
      "production",
      "--name",
      "R2_SECRET_ACCESS_KEY",
    ],
    {
      cwd: new URL("..", import.meta.url),
      input: "not-uploaded",
      encoding: "utf8",
    },
  );
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /is not declared for custom/);
});
