import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  cloudflareAccountId,
  loadTarget,
  parseArgs,
  publicApiUrl,
  publicDashboardUrl,
  publicMcpUrl,
  publicSdkUrl,
  publicShortlinkUrl,
  root,
  targetSelectionFromArgs,
} from "./cloudflare-target.mjs";
import {
  DOMAIN_SERVICES,
  DOMAIN_SERVICE_REGISTRY,
  DOMAIN_SERVICE_BINDINGS,
  assertService,
  isServiceEnabled,
  moduleResourceKey,
} from "./cloudflare-services.mjs";
import { requiredSecretInventory } from "./cloudflare-secret-inventory.mjs";
import { assertPublicRoutingReady } from "./public-routing-gate.mjs";
import {
  D1_SCHEMA_OWNERS,
  d1Descriptor,
  localMigrationFiles,
} from "./cloudflare-d1-registry.mjs";

const args = parseArgs();
const service = args.service ?? "api";
const { targetName, environment } = await targetSelectionFromArgs(
  args,
  process.env,
  { allowReference: true },
);
const preflight = Boolean(args.preflight);
const allowUnprovisioned = Boolean(args["allow-unprovisioned"]);
const outputSuffix = args["output-suffix"];
if (outputSuffix && !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(outputSuffix)) {
  throw new Error("--output-suffix must be a safe lowercase name");
}
assertService(service);

const { target } = await loadTarget(targetName);
if (!isServiceEnabled(target, service) && !args["allow-disabled"]) {
  throw new Error(`${service} is disabled for target ${targetName}`);
}
const resources = target.environments[environment];
if (!resources || !target.workers[service]?.[environment]) {
  throw new Error(`${targetName} does not define a ${environment} environment`);
}
const routing = assertPublicRoutingReady(target, environment);
const publicRoutesEnabled =
  routing.routesEnabled && !args["no-routes"] && !preflight;
const domainResource = DOMAIN_SERVICES.includes(service)
  ? resources.moduleD1?.[moduleResourceKey(service)]
  : null;
if (
  ((service === "api" || service === "billing") &&
    (!resources.d1.id || !resources.kv.id)) ||
  (service === "messaging" && !resources.messagingD1.id) ||
  (service === "email" && !resources.emailD1.id) ||
  (service === "identity" && !resources.identityD1.id) ||
  (service === "files" && !resources.filesD1.id) ||
  (service === "custom" &&
    target.customWorker?.d1Binding &&
    !resources.customD1?.id) ||
  (DOMAIN_SERVICES.includes(service) && !domainResource?.id)
) {
  if (allowUnprovisioned) {
    console.warn(
      `Generating ${targetName}/${service}/${environment} with validation-only placeholder resource ids`,
    );
  } else {
    throw new Error(
      `Run cloudflare-bootstrap for ${targetName}/${environment} before generating configuration`,
    );
  }
}

const expectedD1Migration = await expectedD1MigrationForService();

const outputDirectory = resolve(root, "deploy", "generated");
await mkdir(outputDirectory, { recursive: true });
const outputPath = resolve(
  outputDirectory,
  `${targetName}-${service}-${environment}${outputSuffix ? `-${outputSuffix}` : ""}.jsonc`,
);
const config =
  service === "api"
    ? apiConfig()
    : service === "dashboard"
      ? dashboardConfig()
      : service === "billing"
        ? billingConfig()
        : service === "messaging"
          ? messagingConfig()
          : service === "email"
            ? emailConfig()
            : service === "identity"
              ? identityConfig()
              : service === "files"
                ? filesConfig()
                : service === "observability"
                  ? observabilityConfig()
                  : service === "mcp"
                    ? mcpConfig()
                    : service === "custom"
                      ? customConfig()
                      : domainConfig();
await writeConfigAtomically(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(relative(root, outputPath));

async function writeConfigAtomically(path, contents) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { flag: "wx", mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function expectedD1MigrationForService() {
  if (!D1_SCHEMA_OWNERS.includes(service)) return null;
  const descriptor = d1Descriptor(target, targetName, environment, service, {
    includeDisabled: Boolean(args["allow-disabled"]),
  });
  if (!descriptor) return null;
  return (await localMigrationFiles(descriptor)).at(-1) ?? null;
}

function d1SchemaVars() {
  if (!expectedD1Migration) {
    throw new Error(`${service} does not resolve an expected D1 migration`);
  }
  return { D1_EXPECTED_MIGRATION: expectedD1Migration };
}

function baseConfig() {
  const accountId = cloudflareAccountId(target, process.env, {
    required: false,
  });
  const requiredSecrets = requiredSecretNamesForService();
  return {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: target.workers[service][environment],
    ...(accountId ? { account_id: accountId } : {}),
    // Pin to the newest date supported by the current Wrangler/workerd toolchain.
    compatibility_date: "2026-08-08",
    compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
    workers_dev: false,
    preview_urls: false,
    observability: {
      enabled: true,
      logs: { enabled: true, head_sampling_rate: 1, invocation_logs: true },
      traces: { enabled: true, head_sampling_rate: 0.1 },
    },
    ...(requiredSecrets.length
      ? { secrets: { required: requiredSecrets } }
      : {}),
    ...(service === "observability"
      ? {}
      : {
          tail_consumers: [
            { service: target.workers.observability[environment] },
          ],
        }),
  };
}

function requiredSecretNamesForService() {
  const requirement = requiredSecretInventory(target, environment).find(
    (entry) => entry.service === service,
  );
  if (!requirement) return [];
  return [
    ...requirement.names,
    ...requirement.alternatives.map(({ oneOf }) =>
      oneOf.includes("STORE_CREDENTIALS_ENCRYPTION_KEYS")
        ? "STORE_CREDENTIALS_ENCRYPTION_KEYS"
        : oneOf[0],
    ),
  ].sort();
}

function apiConfig() {
  const appUrl = publicDashboardUrl(target);
  const config = {
    ...baseConfig(),
    main: "../../workers/api/src/index.ts",
    vars: {
      OPENGROW_TARGET: targetName,
      ...d1SchemaVars(),
      OPENGROW_RELEASE:
        process.env.OPENGROW_RELEASE || process.env.GITHUB_SHA || "local",
      PUBLIC_ROUTING_MODE: resources.publicRouting,
      ENVIRONMENT: environment,
      SHORTLINK_DOMAIN: target.domains.shortlinks,
      API_DOMAIN: target.domains.api,
      SDK_DOMAIN: target.domains.sdk,
      FILES_DOMAIN: target.domains.files,
      MCP_DOMAIN: target.domains.mcp,
      PUBLIC_SURFACES_JSON: JSON.stringify(publicSurfaceMonitors(target)),
      CORS_ORIGIN: publicDashboardUrl(target),
      CORS_ORIGINS_JSON: JSON.stringify([
        publicDashboardUrl(target),
        ...target.applicationIdentity.webOrigins,
      ]),
      APP_URL: appUrl,
      DASHBOARD_CLIENT_ID: target.oauth.dashboardClientId,
      REGISTRATION_MODE: target.registrationMode,
      REGISTRATION_REALM: `${target.target}:${environment}`,
      SSO_ENABLED: String(target.ssoEnabled),
      FEATURES_JSON: JSON.stringify(target.features),
      BILLING_EXECUTION_MODE: resources.billingExecutionMode,
      BILLING_RELEASE_STALE_MINUTES: "15",
      BILLING_CATALOG_STALE_HOURS: "24",
      EVENT_QUEUE_NAME: resources.queues.events,
      EVENT_DLQ_NAME: resources.queues.eventsDlq,
      PUSH_QUEUE_NAME: resources.queues.push,
      PUSH_DLQ_NAME: resources.queues.pushDlq,
      MAINTENANCE_QUEUE_NAME: resources.queues.maintenance,
      MAINTENANCE_DLQ_NAME: resources.queues.maintenanceDlq,
      AUTH_GATEWAY_ISSUER: target.authGateway.issuer,
      AUTH_GATEWAY_AUDIENCE: target.authGateway.audience,
      AUTH_GATEWAY_JWKS_URL: target.authGateway.jwksUrl,
      MAIL_PROVIDER: "email-service",
      MAIL_FROM: `${target.mail.fromName} <${target.mail.fromAddress}>`,
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: resources.d1.name,
        database_id: resourceId(resources.d1, "d1"),
        migrations_dir: "../../workers/api/migrations",
        migrations_table: "d1_migrations",
      },
    ],
    kv_namespaces: [{ binding: "KV", id: resourceId(resources.kv, "kv") }],
    r2_buckets: [{ binding: "R2", bucket_name: resources.r2.name }],
    queues: {
      producers: [
        { binding: "EVENT_QUEUE", queue: resources.queues.events },
        { binding: "PUSH_QUEUE", queue: resources.queues.push },
        { binding: "MAINTENANCE_QUEUE", queue: resources.queues.maintenance },
        ...(target.features.billing
          ? [{ binding: "BILLING_QUEUE", queue: resources.queues.billing }]
          : []),
      ],
    },
    services: [
      ...(target.features.messaging
        ? [
            {
              binding: "MESSAGING",
              service: target.workers.messaging[environment],
            },
          ]
        : []),
      ...(target.features.billing
        ? [{ binding: "BILLING", service: target.workers.billing[environment] }]
        : []),
      { binding: "EMAIL_SERVICE", service: target.workers.email[environment] },
      {
        binding: "IDENTITY_SERVICE",
        service: target.workers.identity[environment],
      },
      { binding: "FILES_SERVICE", service: target.workers.files[environment] },
      {
        binding: "OBSERVABILITY",
        service: target.workers.observability[environment],
      },
      ...(target.customWorker
        ? [
            {
              binding: "CUSTOM_WORKER",
              service: target.workers.custom[environment],
            },
          ]
        : []),
      ...DOMAIN_SERVICES.filter(
        (domainService) => target.features[domainService],
      ).map((domainService) => ({
        binding: DOMAIN_SERVICE_BINDINGS[domainService],
        service: target.workers[domainService][environment],
      })),
    ],
  };
  if (!preflight) {
    config.triggers = { crons: ["*/10 * * * *"] };
    config.queues.consumers = [
      queueConsumer(
        resources.queues.events,
        resources.queues.eventsDlq,
        25,
        10,
        5,
      ),
      queueConsumer(resources.queues.push, resources.queues.pushDlq, 10, 5, 5),
      queueConsumer(
        resources.queues.maintenance,
        resources.queues.maintenanceDlq,
        5,
        10,
        3,
      ),
      queueConsumer(resources.queues.eventsDlq, null, 10, 5, 100),
      queueConsumer(resources.queues.pushDlq, null, 10, 5, 100),
      queueConsumer(resources.queues.maintenanceDlq, null, 10, 5, 100),
    ];
    if (target.features.billing && resources.billingExecutionMode === "local") {
      config.queues.consumers.push(
        queueConsumer(
          resources.queues.billing,
          resources.queues.billingDlq,
          10,
          5,
          8,
        ),
      );
    }
  }
  if (publicRoutesEnabled) {
    config.routes = [
      { pattern: target.domains.api, custom_domain: true },
      { pattern: target.domains.shortlinks, custom_domain: true },
      { pattern: target.domains.sdk, custom_domain: true },
      { pattern: target.domains.files, custom_domain: true },
    ];
  }
  return config;
}

function domainConfig() {
  const definition = DOMAIN_SERVICE_REGISTRY[service];
  const resourceKey = definition.resourceKey;
  const config = {
    ...baseConfig(),
    workers_dev: false,
    main: definition.main,
    vars: {
      ENVIRONMENT: environment,
      SERVICE_NAME: service,
      ...d1SchemaVars(),
      AUTH_GATEWAY_ISSUER: target.authGateway.issuer,
      AUTH_GATEWAY_AUDIENCE: target.authGateway.audience,
      AUTH_GATEWAY_JWKS_URL: target.authGateway.jwksUrl,
      ...(definition.vars.includes("CORS_ORIGIN")
        ? {
            CORS_ORIGIN: publicDashboardUrl(target),
          }
        : {}),
      ...(definition.vars.includes("PUBLIC_API_URL")
        ? {
            PUBLIC_API_URL: publicApiUrl(target),
          }
        : {}),
      ...(definition.vars.includes("ALLOWED_PROJECT_IDS")
        ? {
            ALLOWED_PROJECT_IDS: resources.supportProjectIds.join(","),
          }
        : {}),
      ...(definition.queue
        ? {
            QUEUE_NAME:
              resources.moduleQueues[definition.queue.resourceKey].name,
            DLQ_NAME: resources.moduleQueues[definition.queue.resourceKey].dlq,
          }
        : {}),
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: resources.moduleD1[resourceKey].name,
        database_id: resourceId(resources.moduleD1[resourceKey], "d1"),
        migrations_dir: definition.migrationsDir,
        migrations_table: "d1_migrations",
      },
    ],
  };
  if (definition.r2.length) {
    config.r2_buckets = definition.r2.map((binding) => ({
      binding: binding.binding,
      bucket_name: resources.moduleR2[binding.resourceKey].name,
    }));
  }
  if (definition.queue) {
    const queue = resources.moduleQueues[definition.queue.resourceKey];
    config.queues = {
      producers: [{ binding: definition.queue.binding, queue: queue.name }],
    };
    if (!preflight) {
      config.queues.consumers = [
        queueConsumer(
          queue.name,
          queue.dlq,
          definition.queue.maxBatchSize,
          definition.queue.maxBatchTimeout,
          definition.queue.maxRetries,
        ),
        queueConsumer(queue.dlq, null, 10, 5, 100),
      ];
    }
  }
  if (!preflight && definition.crons.length)
    config.triggers = { crons: [...definition.crons] };
  if (definition.durableObjects.length) {
    config.durable_objects = {
      bindings: definition.durableObjects.map((durableObject) => ({
        name: durableObject.name,
        class_name: durableObject.className,
      })),
    };
    config.migrations = definition.durableObjectMigrations.map((migration) => ({
      tag: migration.tag,
      new_sqlite_classes: [...migration.newSqliteClasses],
    }));
  }
  return config;
}

function billingConfig() {
  const apiDomain = target.domains.api;
  const config = {
    ...baseConfig(),
    workers_dev: false,
    main: "../../workers/billing/src/index.ts",
    vars: {
      ENVIRONMENT: environment,
      API_DOMAIN: apiDomain,
      SDK_DOMAIN: target.domains.sdk,
      CREDENTIAL_KEY_SCOPE: "billing",
      BILLING_RELEASE_STALE_MINUTES: "15",
      BILLING_CATALOG_STALE_HOURS: "24",
      BILLING_QUEUE_NAME: resources.queues.billing,
      BILLING_DLQ_NAME: resources.queues.billingDlq,
      AUTH_GATEWAY_ISSUER: target.authGateway.issuer,
      AUTH_GATEWAY_AUDIENCE: target.authGateway.audience,
      AUTH_GATEWAY_JWKS_URL: target.authGateway.jwksUrl,
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: resources.d1.name,
        database_id: resourceId(resources.d1, "d1"),
      },
    ],
    kv_namespaces: [{ binding: "KV", id: resourceId(resources.kv, "kv") }],
    r2_buckets: [{ binding: "R2", bucket_name: resources.r2.name }],
    queues: {
      producers: [
        { binding: "BILLING_QUEUE", queue: resources.queues.billing },
      ],
    },
  };
  if (!preflight) {
    config.queues.consumers = [
      queueConsumer(resources.queues.billingDlq, null, 10, 5, 8),
    ];
    if (resources.billingExecutionMode === "service") {
      config.triggers = { crons: ["*/10 * * * *"] };
      config.queues.consumers.unshift(
        queueConsumer(
          resources.queues.billing,
          resources.queues.billingDlq,
          10,
          5,
          8,
        ),
      );
    }
  }
  return config;
}

function messagingConfig() {
  const config = {
    ...baseConfig(),
    main: "../../workers/messaging/src/index.ts",
    vars: {
      ENVIRONMENT: environment,
      ...d1SchemaVars(),
      AUTH_GATEWAY_ISSUER: target.authGateway.issuer,
      AUTH_GATEWAY_AUDIENCE: target.authGateway.audience,
      AUTH_GATEWAY_JWKS_URL: target.authGateway.jwksUrl,
      ALLOWED_PROJECT_IDS: resources.messagingProjectIds.join(","),
      CORS_ORIGIN: publicDashboardUrl(target),
      QUEUE_NAME: resources.queues.messaging,
      DLQ_NAME: resources.queues.messagingDlq,
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: resources.messagingD1.name,
        database_id: resourceId(resources.messagingD1, "d1"),
        migrations_dir: "../../workers/messaging/migrations",
        migrations_table: "d1_migrations",
      },
    ],
    r2_buckets: [
      { binding: "ATTACHMENTS", bucket_name: resources.messagingR2.name },
    ],
    queues: {
      producers: [
        { binding: "MESSAGING_QUEUE", queue: resources.queues.messaging },
      ],
    },
    durable_objects: {
      bindings: [{ name: "CONVERSATIONS", class_name: "ConversationRoom" }],
    },
    migrations: [{ tag: "v1", new_sqlite_classes: ["ConversationRoom"] }],
  };
  if (!preflight) {
    config.queues.consumers = [
      queueConsumer(
        resources.queues.messaging,
        resources.queues.messagingDlq,
        10,
        5,
        8,
      ),
      queueConsumer(resources.queues.messagingDlq, null, 10, 5, 100),
    ];
  }
  if (publicRoutesEnabled) {
    config.routes = [
      { pattern: target.domains.messaging, custom_domain: true },
    ];
  }
  return config;
}

function emailConfig() {
  const config = {
    ...baseConfig(),
    workers_dev: false,
    main: "../../workers/email/src/index.ts",
    vars: {
      ENVIRONMENT: environment,
      ...d1SchemaVars(),
      MAIL_TRANSPORT: target.mail.transport,
      MAIL_FROM_NAME: target.mail.fromName,
      MAIL_FROM_ADDRESS: target.mail.fromAddress,
      MAIL_REPLY_TO: target.mail.replyToAddress || "",
      EMAIL_QUEUE_NAME: resources.queues.email,
      EMAIL_DLQ_NAME: resources.queues.emailDlq,
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: resources.emailD1.name,
        database_id: resourceId(resources.emailD1, "d1"),
        migrations_dir: "../../workers/email/migrations",
        migrations_table: "d1_migrations",
      },
    ],
    queues: {
      producers: [{ binding: "EMAIL_QUEUE", queue: resources.queues.email }],
    },
  };
  if (!preflight) {
    config.queues.consumers = [
      queueConsumer(
        resources.queues.email,
        resources.queues.emailDlq,
        10,
        5,
        8,
      ),
      queueConsumer(resources.queues.emailDlq, null, 10, 5, 100),
    ];
  }
  if (target.domains.mailPreview && publicRoutesEnabled) {
    config.routes = [
      { pattern: target.domains.mailPreview, custom_domain: true },
    ];
  }
  return config;
}

function identityConfig() {
  return {
    ...baseConfig(),
    workers_dev: false,
    main: "../../workers/identity/src/index.ts",
    vars: {
      ENVIRONMENT: environment,
      ...d1SchemaVars(),
      REGISTRATION_MODE: target.applicationIdentity.registrationMode,
      APPLICATION_AUDIENCE: target.applicationIdentity.applicationAudience,
      OPENGROW_IDENTITY_ISSUER: target.authGateway.issuer,
      OPENGROW_IDENTITY_AUDIENCE: target.authGateway.audience,
      OPENGROW_IDENTITY_TOKEN_TTL: "300",
      ACCESS_TOKEN_TTL: "900",
      REFRESH_TOKEN_TTL: "2592000",
      GOOGLE_AUDIENCES_JSON: JSON.stringify(
        target.applicationIdentity.googleAudiences,
      ),
      APPLE_AUDIENCES_JSON: JSON.stringify(
        target.applicationIdentity.appleAudiences,
      ),
      PUBLIC_API_URL: publicApiUrl(target),
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: resources.identityD1.name,
        database_id: resourceId(resources.identityD1, "identityD1"),
        migrations_dir: "../../workers/identity/migrations",
        migrations_table: "d1_migrations",
      },
    ],
    services: [
      { binding: "EMAIL_SERVICE", service: target.workers.email[environment] },
      { binding: "FILES_SERVICE", service: target.workers.files[environment] },
    ],
  };
}

function filesConfig() {
  return {
    ...baseConfig(),
    workers_dev: false,
    main: "../../workers/files/src/index.ts",
    vars: {
      ENVIRONMENT: environment,
      ...d1SchemaVars(),
      AUTH_GATEWAY_ISSUER: target.authGateway.issuer,
      APPLICATION_AUDIENCE: target.applicationIdentity.applicationAudience,
      AUTH_GATEWAY_JWKS_URL: target.authGateway.jwksUrl,
      MAX_FILE_BYTES: String(target.filePolicy.maxBytes),
      FILES_PUBLIC_ORIGIN: `https://${target.domains.files}`,
      DOWNLOAD_TICKET_TTL_SECONDS: String(
        target.filePolicy.downloadTicketTtlSeconds,
      ),
      ALLOWED_FILE_CONTENT_TYPES_JSON: JSON.stringify(
        target.filePolicy.allowedContentTypes,
      ),
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: resources.filesD1.name,
        database_id: resourceId(resources.filesD1, "filesD1"),
        migrations_dir: "../../workers/files/migrations",
        migrations_table: "d1_migrations",
      },
    ],
    r2_buckets: [{ binding: "FILES", bucket_name: resources.r2.name }],
  };
}

function customConfig() {
  if (!target.customWorker)
    throw new Error(`${targetName} does not declare a custom Worker`);
  const config = {
    ...baseConfig(),
    workers_dev: false,
    main: `../../${target.customWorker.source}`,
    vars: {
      APP_KEY: target.target,
      ENVIRONMENT: environment,
      CUSTOM_WORKER_CAPABILITIES: target.customWorker.capabilities.join(","),
      ...(target.customWorker.d1Binding ? d1SchemaVars() : {}),
      ...(target.customWorker.vars ?? {}),
    },
  };
  if (target.customWorker.d1Binding) {
    config.d1_databases = [
      {
        binding: target.customWorker.d1Binding.binding,
        database_name: resources.customD1.name,
        database_id: resourceId(resources.customD1, "customD1"),
        migrations_dir: `../../${target.customWorker.d1Binding.migrationsDir}`,
        migrations_table: "d1_migrations",
      },
    ];
  }
  if (target.customWorker.serviceBindings?.length) {
    config.services = target.customWorker.serviceBindings.map(
      ({ binding, workers }) => ({
        binding,
        service: workers[environment],
      }),
    );
  }
  if (!preflight && target.customWorker.crons?.length) {
    config.triggers = { crons: [...target.customWorker.crons] };
  }
  return config;
}

function observabilityConfig() {
  return {
    ...baseConfig(),
    workers_dev: false,
    main: "../../workers/observability/src/index.ts",
    vars: {
      ENVIRONMENT: environment,
      ANALYTICS_DATASET: resources.analyticsDataset,
    },
    analytics_engine_datasets: [
      { binding: "ANALYTICS", dataset: resources.analyticsDataset },
    ],
  };
}

function mcpConfig() {
  return {
    ...baseConfig(),
    workers_dev: false,
    main: "../../workers/mcp/src/index.ts",
    vars: {
      ENVIRONMENT: environment,
      OPENGROW_TARGET: targetName,
      MCP_DOMAIN: target.domains.mcp,
      PUBLIC_API_URL: publicApiUrl(target),
      PUBLIC_MCP_URL: publicMcpUrl(target),
    },
    services: [
      { binding: "API_SERVICE", service: target.workers.api[environment] },
    ],
    ...(publicRoutesEnabled
      ? { routes: [{ pattern: target.domains.mcp, custom_domain: true }] }
      : {}),
  };
}

function dashboardConfig() {
  const apiUrl = publicApiUrl(target);
  const appUrl = publicDashboardUrl(target);
  const config = {
    ...baseConfig(),
    main: "../../apps/dashboard/.open-next/worker.js",
    assets: {
      directory: "../../apps/dashboard/.open-next/assets",
      binding: "ASSETS",
      run_worker_first: false,
    },
    services: [
      {
        binding: "WORKER_SELF_REFERENCE",
        service: target.workers.dashboard[environment],
      },
    ],
    images: { binding: "IMAGES" },
    r2_buckets: [
      {
        binding: "NEXT_INC_CACHE_R2_BUCKET",
        bucket_name: resources.dashboardCache.name,
      },
    ],
    vars: {
      NEXT_PUBLIC_API_URL: apiUrl,
      NEXT_PUBLIC_API_PATH: "/api/v1",
      NEXT_PUBLIC_CLIENT_ID: target.oauth.dashboardClientId,
      NEXT_PUBLIC_APP_URL: appUrl,
      NEXT_PUBLIC_SDK_URL: publicSdkUrl(target),
      NEXT_PUBLIC_SHORTLINK_URL: publicShortlinkUrl(target),
      NEXT_PUBLIC_MCP_URL: publicMcpUrl(target),
      NEXT_PUBLIC_DOCS_URL: target.operator.docsUrl,
      ...(target.operator.supportEmail
        ? { NEXT_PUBLIC_SUPPORT_EMAIL: target.operator.supportEmail }
        : {}),
      NEXT_PUBLIC_ENV: environment,
      NEXT_PUBLIC_REGISTRATION_MODE: target.registrationMode,
      NEXT_PUBLIC_SSO_ENABLED: String(target.ssoEnabled),
    },
  };
  if (publicRoutesEnabled) {
    config.routes = [
      { pattern: target.domains.dashboard, custom_domain: true },
    ];
  }
  return config;
}

function publicSurfaceMonitors(selectedTarget) {
  const origin = (hostname) => `https://${hostname}`;
  const monitored = [
    {
      id: "api",
      url: origin(selectedTarget.domains.api),
      healthUrl: `${origin(selectedTarget.domains.api)}/health`,
      description: "Public authenticated API gateway",
    },
    {
      id: "sdk",
      url: origin(selectedTarget.domains.sdk),
      healthUrl: `${origin(selectedTarget.domains.sdk)}/health`,
      description: "Public mobile and FlutterFlow SDK surface",
    },
    {
      id: "shortlinks",
      url: origin(selectedTarget.domains.shortlinks),
      healthUrl: `${origin(selectedTarget.domains.shortlinks)}/health`,
      description: "Public short-link and attribution surface",
    },
    {
      id: "files",
      url: origin(selectedTarget.domains.files),
      healthUrl: `${origin(selectedTarget.domains.files)}/health`,
      description: "Public controlled file-delivery surface",
    },
    {
      id: "dashboard",
      url: origin(selectedTarget.domains.dashboard),
      healthUrl: `${origin(selectedTarget.domains.dashboard)}/`,
      description: "OpenGrow operator back office",
    },
    {
      id: "mcp",
      url: origin(selectedTarget.domains.mcp),
      healthUrl: `${origin(selectedTarget.domains.mcp)}/health`,
      description: "Authenticated OpenGrow MCP operator endpoint",
    },
    ...(selectedTarget.domains.mailPreview
      ? [
          {
            id: "mail-preview",
            url: origin(selectedTarget.domains.mailPreview),
            healthUrl: `${origin(selectedTarget.domains.mailPreview)}/`,
            description: "Protected development email capture",
          },
        ]
      : []),
    ...(selectedTarget.publicSurfaceMonitors ?? []),
  ];
  const ids = new Set();
  for (const surface of monitored) {
    if (ids.has(surface.id)) {
      throw new Error(
        `Public surface monitor ${surface.id} is declared more than once`,
      );
    }
    ids.add(surface.id);
  }
  return monitored;
}

function queueConsumer(
  queue,
  deadLetterQueue,
  maxBatchSize,
  maxBatchTimeout,
  maxRetries,
) {
  const consumer = {
    queue,
    max_batch_size: maxBatchSize,
    max_batch_timeout: maxBatchTimeout,
    max_retries: maxRetries,
  };
  if (deadLetterQueue) consumer.dead_letter_queue = deadLetterQueue;
  return consumer;
}

function resourceId(resource, kind) {
  if (resource?.id) return resource.id;
  if (!allowUnprovisioned)
    throw new Error(
      `Missing provisioned ${kind} id for ${resource?.name || "resource"}`,
    );
  return kind === "kv"
    ? "00000000000000000000000000000000"
    : "00000000-0000-4000-8000-000000000000";
}
