import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  cloudflareAccountId,
  loadTarget,
  parseArgs,
  publicApiUrl,
  publicAuthUrl,
  publicDashboardUrl,
  publicMcpUrl,
  publicSdkUrl,
  publicShortlinkUrl,
  root,
  targetSelectionFromArgs,
} from "./cloudflare-target.mjs";
import {
  ALL_SERVICES,
  DOMAIN_SERVICES,
  DOMAIN_SERVICE_REGISTRY,
  DOMAIN_SERVICE_BINDINGS,
  assertServiceForTarget,
  isServiceEnabled,
  managedWorkerDefinition,
  managedWorkerDefinitions,
  managedWorkerOperationalBinding,
  managedWorkerService,
  moduleResourceKey,
  workerNameForService,
} from "./cloudflare-services.mjs";
import { requiredSecretInventory } from "./cloudflare-secret-inventory.mjs";
import { assertTargetPhysicalResourceNames } from "./cloudflare-resource-identity.mjs";
import { superboardEnvironmentValue } from "./superboard-environment.mjs";
import { assertPublicRoutingReady } from "./public-routing-gate.mjs";
import {
  resolveSitePreviewRoute,
  resolveSiteReleaseOperations,
} from "./cloudflare-site-preview.mjs";
import {
  D1_SCHEMA_OWNERS,
  d1Descriptor,
  localMigrationFiles,
} from "./cloudflare-d1-registry.mjs";
import {
  assertTargetServiceConfiguration,
  compiledTargetFromArgs,
} from "./target-compiler.mjs";

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
const { target } = await loadTarget(targetName);
const compiledTarget = await compiledTargetFromArgs(target, environment, args);
const sitePreviewRoute = resolveSitePreviewRoute({
  requested: Boolean(args["site-preview-route"]),
  service,
  environment,
  hostname: target.domains.site,
  noRoutes: Boolean(args["no-routes"]),
  preflight,
});
const siteReleaseOperations = resolveSiteReleaseOperations({
  requested: Boolean(args["release-operations"]),
  service,
  environment,
  sitePreviewRoute,
});
assertTargetPhysicalResourceNames(target, environment);
assertServiceForTarget(target, service);
const managedWorker = managedWorkerDefinition(target, service);
if (!isServiceEnabled(target, service) && !args["allow-disabled"]) {
  throw new Error(`${service} is disabled for target ${targetName}`);
}
const resources = target.environments[environment];
if (!resources || !workerNameForService(target, service, environment)) {
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
  (service === "site" &&
    (!resources.siteD1.id ||
      !resources.siteSessionKv.id ||
      !resources.siteReleaseKv.id)) ||
  (service === "messaging" && !resources.messagingD1.id) ||
  (service === "email" && !resources.emailD1.id) ||
  (service === "identity" && !resources.identityD1.id) ||
  (service === "files" && !resources.filesD1.id) ||
  (service === "custom" &&
    target.customWorker?.d1Binding &&
    !resources.customD1?.id) ||
  (managedWorker && !resources.customD1?.id) ||
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
    : service === "site"
      ? siteConfig()
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
                      : managedWorker
                        ? managedWorkerConfig()
                        : domainConfig();
assertTargetServiceConfiguration(compiledTarget, service, config, {
  routesEnabled: publicRoutesEnabled,
  sitePreviewRoute: Boolean(sitePreviewRoute),
  preflight,
});
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
    name: workerNameForService(target, service, environment),
    ...(accountId ? { account_id: accountId } : {}),
    // Pin to the newest date supported by the current Wrangler/workerd toolchain.
    compatibility_date: "2026-08-08",
    compatibility_flags:
      service === "site"
        ? ["nodejs_compat"]
        : ["nodejs_compat", "global_fetch_strictly_public"],
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

function siteConfig() {
  return {
    ...baseConfig(),
    main: "../../apps/site/dist/server/entry.mjs",
    no_bundle: true,
    rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
    assets: { binding: "ASSETS", directory: "../../apps/site/dist/client" },
    vars: {
      SUPERBOARD_INSTANCE_ID: target.target,
      SUPERBOARD_ENVIRONMENT: environment,
      SUPERBOARD_PLUGIN_IDS: JSON.stringify(
        compiledTarget.graph.plugins
          .filter(({ pluginId }) => !pluginId.includes("*"))
          .map(({ pluginId }) => pluginId),
      ),
      SUPERBOARD_RELEASE_OPERATIONS: siteReleaseOperations.value,
      TARGET_ARTIFACT_CHECKSUM: compiledTarget.checksum,
      ...d1SchemaVars(),
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: resources.siteD1.name,
        database_id: resourceId(resources.siteD1, "d1"),
        migrations_dir: "../../apps/site/migrations",
        migrations_table: "d1_migrations",
      },
    ],
    r2_buckets: [
      { binding: "MEDIA", bucket_name: resources.siteMedia.name },
    ],
    kv_namespaces: [
      { binding: "SESSION", id: resourceId(resources.siteSessionKv, "kv") },
      {
        binding: "RELEASE_CACHE",
        id: resourceId(resources.siteReleaseKv, "kv"),
      },
    ],
    worker_loaders: [{ binding: target.siteRuntime.workerLoaderBinding }],
    services: [{ binding: "API_SERVICE", service: target.workers.api[environment] }],
    images: { binding: "IMAGES" },
    send_email: [
      {
        name: "EMAIL",
        allowed_destination_addresses: [target.operator.email],
        allowed_sender_addresses: [target.mail.fromAddress],
      },
    ],
    ...(sitePreviewRoute ? { routes: sitePreviewRoute.routes } : {}),
    ...(preflight ? {} : { triggers: { crons: [...target.siteRuntime.crons] } }),
    observability: target.siteRuntime.observability,
  };
}

function apiConfig() {
  const appUrl = publicDashboardUrl(target);
  const config = {
    ...baseConfig(),
    main: "../../workers/api/src/index.ts",
    vars: {
      SUPERBOARD_TARGET: targetName,
      OPENGROW_TARGET: targetName,
      ...d1SchemaVars(),
      SUPERBOARD_RELEASE:
        superboardEnvironmentValue("SUPERBOARD_RELEASE") ||
        process.env.GITHUB_SHA ||
        "local",
      OPENGROW_RELEASE:
        superboardEnvironmentValue("SUPERBOARD_RELEASE") ||
        process.env.GITHUB_SHA ||
        "local",
      PUBLIC_ROUTING_MODE: resources.publicRouting,
      ENVIRONMENT: environment,
      SHORTLINK_DOMAIN: target.domains.shortlinks,
      API_DOMAIN: target.domains.api,
      AUTH_DOMAIN: target.domains.auth,
      SDK_DOMAIN: target.domains.sdk,
      FILES_DOMAIN: target.domains.files,
      MCP_DOMAIN: target.domains.mcp,
      PUBLIC_SURFACES_JSON: JSON.stringify(publicSurfaceMonitors(target)),
      PLATFORM_WORKERS_JSON: JSON.stringify(platformWorkerTopology(target)),
      CORS_ORIGIN: publicDashboardUrl(target),
      CORS_ORIGINS_JSON: JSON.stringify([
        publicDashboardUrl(target),
        publicAuthUrl(target),
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
      ...managedWorkerDefinitions(target).map((component) => ({
        binding: managedWorkerOperationalBinding(component),
        service: component.workers[environment],
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
    if (environment === "production" && resources.supportRouting) {
      if (resources.supportRouting.mode === "active") {
        config.routes = [
          {
            pattern: resources.supportRouting.pattern,
            zone_name: target.zoneName,
          },
        ];
      }
    } else {
      config.routes = [
        { pattern: target.domains.api, custom_domain: true },
        { pattern: target.domains.auth, custom_domain: true },
        { pattern: target.domains.shortlinks, custom_domain: true },
        { pattern: target.domains.sdk, custom_domain: true },
        { pattern: target.domains.files, custom_domain: true },
      ];
    }
  }
  return config;
}

function domainConfig() {
  const definition = DOMAIN_SERVICE_REGISTRY[service];
  const resourceKey = definition.resourceKey;
  const domainQueues = definition.queues.map((queueDefinition) => ({
    definition: queueDefinition,
    resource: resources.moduleQueues[queueDefinition.resourceKey],
  }));
  const primaryQueue = domainQueues[0] ?? null;
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
      ...(definition.vars.includes("PUBLIC_DASHBOARD_URL")
        ? {
            PUBLIC_DASHBOARD_URL: publicDashboardUrl(target),
          }
        : {}),
      ...(definition.vars.includes("EMAIL_PROVIDER")
        ? { EMAIL_PROVIDER: target.mail.provider }
        : {}),
      ...(definition.vars.includes("AWS_REGION")
        ? { AWS_REGION: target.mail.awsRegion || "" }
        : {}),
      ...(definition.vars.includes("ALLOWED_PROJECT_IDS")
        ? {
            ALLOWED_PROJECT_IDS: resources.supportProjectIds.join(","),
          }
        : {}),
      ...definition.staticVars,
      ...(primaryQueue
        ? {
            QUEUE_NAME: primaryQueue.resource.name,
            DLQ_NAME: primaryQueue.resource.dlq,
          }
        : {}),
      ...Object.fromEntries(
        domainQueues.flatMap(({ definition: queue, resource }) => [
          ...(queue.nameVar ? [[queue.nameVar, resource.name]] : []),
          ...(queue.dlqVar ? [[queue.dlqVar, resource.dlq]] : []),
        ]),
      ),
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
  if (definition.ai) {
    config.ai = { binding: definition.ai.binding };
  }
  if (definition.vectorize.length) {
    config.vectorize = definition.vectorize.map((binding) => ({
      binding: binding.binding,
      index_name: resources.moduleVectorize[binding.resourceKey].name,
    }));
  }
  if (definition.services.length) {
    config.services = definition.services.map((binding) => ({
      binding: binding.binding,
      service: target.workers[binding.service][environment],
    }));
  }
  if (definition.workflows.length) {
    config.workflows = definition.workflows.map((workflow) => ({
      name: `${workerNameForService(target, service, environment)}-${workflow.nameSuffix}`,
      binding: workflow.binding,
      class_name: workflow.className,
    }));
  }
  if (domainQueues.length) {
    config.queues = {
      producers: domainQueues.map(({ definition: queue, resource }) => ({
        binding: queue.binding,
        queue: resource.name,
      })),
    };
    if (!preflight) {
      config.queues.consumers = [
        ...domainQueues.map(({ definition: queue, resource }) =>
          queueConsumer(
            resource.name,
            resource.dlq,
            queue.maxBatchSize,
            queue.maxBatchTimeout,
            queue.maxRetries,
          ),
        ),
        ...domainQueues.map(({ resource }) =>
          queueConsumer(resource.dlq, null, 10, 5, 100),
        ),
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
    ...(target.features.analytics
      ? {
          services: [
            {
              binding: "ANALYTICS_MODULE",
              service: target.workers.analytics[environment],
            },
          ],
        }
      : {}),
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
      MAIL_PROVIDER: target.mail.provider,
      MAIL_FROM_NAME: target.mail.fromName,
      MAIL_FROM_ADDRESS: target.mail.fromAddress,
      MAIL_REPLY_TO: target.mail.replyToAddress || "",
      EMAIL_QUEUE_NAME: resources.queues.email,
      EMAIL_DLQ_NAME: resources.queues.emailDlq,
      ...(target.mail.provider === "aws-ses"
        ? {
            AWS_REGION: target.mail.awsRegion,
            AWS_SES_CONFIGURATION_SET: target.mail.configurationSet,
          }
        : {}),
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
  if (
    target.mail.transport === "capture" &&
    target.domains.mailPreview &&
    publicRoutesEnabled
  ) {
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
    alias: melodyAliases("./workers/identity/src/melody"),
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
      AUTH_SERVER_URL: publicAuthUrl(target),
      IDENTITY_REALM: `${target.target}:${environment}`,
      MELODY_ENVIRONMENT: "prod",
      COMPANY_LOGO_URL: `${publicDashboardUrl(target)}/superboard-mark.svg`,
      COMPANY_EMAIL_LOGO_URL: `${publicDashboardUrl(target)}/superboard-email-logo.png`,
      EMAIL_SENDER_NAME: target.mail.fromName,
      SMTP_SENDER_ADDRESS: target.mail.fromAddress,
      EMAIL_PROVIDER_NAME: "superboard",
      DEV_EMAIL_RECEIVER: "",
      DEV_SMS_RECEIVER: "",
      TERMS_LINK: "",
      PRIVACY_POLICY_LINK: "",
      SUPPORTED_LOCALES: ["en", "fr"],
      ENABLE_LOCALE_SELECTOR: true,
      ENABLE_SIGN_UP: true,
      ENABLE_PASSWORD_SIGN_IN: true,
      ENABLE_PASSWORD_RESET: true,
      ENABLE_NAMES: true,
      NAMES_IS_REQUIRED: false,
      ENABLE_USER_APP_CONSENT: true,
      ENABLE_EMAIL_VERIFICATION: true,
      REPLACE_EMAIL_VERIFICATION_WITH_WELCOME_EMAIL: false,
      ENABLE_ORG: true,
      ALLOW_USER_SWITCH_ORG_ON_SIGN_IN: true,
      ENABLE_USER_ATTRIBUTE: true,
      BLOCKED_POLICIES: ["__none__"],
      ENABLE_PASSWORDLESS_SIGN_IN: false,
      USE_PASSWORDLESS_AS_MAGIC_LINK: true,
      EMBEDDED_AUTH_ORIGINS: [
        publicDashboardUrl(target),
        ...target.applicationIdentity.webOrigins,
      ],
      ENABLE_SAML_SSO_AS_SP: true,
      ENABLE_APP_BANNER: true,
      AUTHORIZATION_CODE_EXPIRES_IN: 300,
      SPA_ACCESS_TOKEN_EXPIRES_IN: 1_800,
      SPA_REFRESH_TOKEN_EXPIRES_IN: 2_592_000,
      S2S_ACCESS_TOKEN_EXPIRES_IN: 3_600,
      ID_TOKEN_EXPIRES_IN: 1_800,
      SERVER_SESSION_EXPIRES_IN: 1_800,
      OTP_MFA_IS_REQUIRED: false,
      EMAIL_MFA_IS_REQUIRED: false,
      SMS_MFA_IS_REQUIRED: false,
      ENFORCE_ONE_MFA_ENROLLMENT: ["__none__"],
      ALLOW_EMAIL_MFA_AS_BACKUP: true,
      ALLOW_PASSKEY_ENROLLMENT: true,
      ENABLE_RECOVERY_CODE: true,
      ENABLE_MFA_REMEMBER_DEVICE: true,
      UNLOCK_ACCOUNT_VIA_PASSWORD_RESET: true,
      PASSWORD_RESET_EMAIL_THRESHOLD: 5,
      PASSWORD_RESET_CODE_THRESHOLD: 5,
      ACCOUNT_LOCKOUT_THRESHOLD: 5,
      EMAIL_MFA_EMAIL_THRESHOLD: 10,
      CHANGE_EMAIL_EMAIL_THRESHOLD: 5,
      CHANGE_EMAIL_CODE_THRESHOLD: 5,
      EMAIL_VERIFICATION_CODE_THRESHOLD: 5,
      ACCOUNT_LOCKOUT_EXPIRES_IN: 86_400,
      SMS_MFA_MESSAGE_THRESHOLD: 5,
      MFA_CODE_VERIFY_THRESHOLD: 10,
      AUTH_CODE_VERIFIER_THRESHOLD: 5,
      GOOGLE_AUTH_CLIENT_ID: "",
      FACEBOOK_AUTH_CLIENT_ID: "",
      GITHUB_AUTH_CLIENT_ID: "",
      GITHUB_AUTH_APP_NAME: "",
      DISCORD_AUTH_CLIENT_ID: "",
      APPLE_AUTH_CLIENT_ID: "",
      TWILIO_ACCOUNT_ID: "",
      TWILIO_SENDER_NUMBER: "",
      LOG_LEVEL: "info",
      ENABLE_EMAIL_LOG: true,
      ENABLE_SMS_LOG: true,
      ENABLE_SIGN_IN_LOG: true,
      SENDGRID_API_KEY: "",
      SENDGRID_SENDER_ADDRESS: "",
      BREVO_API_KEY: "",
      BREVO_SENDER_ADDRESS: "",
      MAILGUN_API_KEY: "",
      MAILGUN_SENDER_ADDRESS: "",
      RESEND_API_KEY: "",
      RESEND_SENDER_ADDRESS: "",
      POSTMARK_API_KEY: "",
      POSTMARK_SENDER_ADDRESS: "",
      PG_CONNECTION_STRING: "",
      REDIS_CONNECTION_STRING: "",
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
    assets: {
      directory: "../../workers/identity/dist",
      binding: "ASSETS",
      run_worker_first: true,
    },
  };
}

function melodyAliases(base) {
  return Object.fromEntries([
    "configs",
    "dtos",
    "handlers",
    "hooks",
    "middlewares",
    "models",
    "pages",
    "routes",
    "services",
    "templates",
    "utils",
  ].map((name) => [name, `${base}/${name}`]).concat([
    ["router", `${base}/router.tsx`],
  ]));
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
      ...(target.customWorker.runtimeBridge
        ? {
            FILES_INPUT_ORIGIN:
              target.customWorker.runtimeBridge.filesInputOrigin,
          }
        : {}),
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

function managedWorkerConfig() {
  if (!managedWorker) {
    throw new Error(`${service} is not a managed Worker for ${targetName}`);
  }
  const accountId = cloudflareAccountId(target, process.env, {
    required: !allowUnprovisioned,
  });
  if (!accountId && !allowUnprovisioned) {
    throw new Error(
      `CLOUDFLARE_ACCOUNT_ID is required to derive the R2 endpoint for ${service}`,
    );
  }
  const commonVars = {
    SUPERBOARD_TARGET: targetName,
    OPENGROW_TARGET: targetName,
    ENVIRONMENT: environment,
    GATEWAY_URL: target.customWorker.runtimeBridge.gatewayOrigin,
    FILES_INPUT_ORIGIN: target.customWorker.runtimeBridge.filesInputOrigin,
    FILES_INPUT_MAX_BYTES: String(target.filePolicy.maxBytes),
    OUTPUT_FILE_ORIGIN: target.customWorker.runtimeBridge.outputFileOrigin,
    R2_ENDPOINT_URL: accountId
      ? `https://${accountId}.r2.cloudflarestorage.com`
      : "https://validation.invalid",
    R2_BUCKET_NAME: resources[managedWorker.r2Resource].name,
    ...Object.fromEntries(
      managedWorker.containers.map((container) => [
        `${container.binding}_MAX_INSTANCES`,
        String(container.maxInstances),
      ]),
    ),
    ...(managedWorker.watermarkPath
      ? {
          WATERMARK_URL: `${target.customWorker.runtimeBridge.outputFileOrigin}${managedWorker.watermarkPath}`,
        }
      : {}),
  };
  return {
    ...baseConfig(),
    main: `../../${managedWorker.source}`,
    vars: {
      ...commonVars,
      ...(managedWorker.vars ?? {}),
    },
    d1_databases: [
      {
        binding: managedWorker.d1Binding,
        database_name: resources.customD1.name,
        database_id: resourceId(resources.customD1, "customD1"),
      },
    ],
    workflows: [
      {
        binding: managedWorker.workflow.binding,
        name: managedWorker.workflow.names[environment],
        class_name: managedWorker.workflow.className,
      },
    ],
    containers: managedWorker.containers.map((container) => ({
      class_name: container.className,
      image: `../../${container.dockerfile}`,
      max_instances: container.maxInstances,
      instance_type: container.instanceType,
    })),
    durable_objects: {
      bindings: [
        ...managedWorker.containers.map((container) => ({
          name: container.binding,
          class_name: container.className,
        })),
        ...managedWorker.durableObjects.map((durableObject) => ({
          name: durableObject.binding,
          class_name: durableObject.className,
        })),
      ],
    },
    migrations: managedWorker.migrations.map((migration) => ({
      tag: migration.tag,
      ...(migration.newClasses?.length
        ? { new_classes: migration.newClasses }
        : {}),
      ...(migration.newSqliteClasses?.length
        ? { new_sqlite_classes: migration.newSqliteClasses }
        : {}),
    })),
  };
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
      SUPERBOARD_TARGET: targetName,
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

function platformWorkerTopology(selectedTarget) {
  const publicSurfaceIds = {
    api: ["api", "sdk", "shortlinks"],
    site: ["site-preview"],
    dashboard: ["dashboard"],
    email: selectedTarget.domains.mailPreview ? ["mail-preview"] : [],
    files: ["files"],
    mcp: ["mcp"],
  };
  return {
    schemaVersion: 1,
    target: targetName,
    environment,
    workers: [
      ...ALL_SERVICES.map((id) => ({
        id,
        workerName: selectedTarget.workers[id]?.[environment] ?? null,
        enabled: isServiceEnabled(selectedTarget, id),
        publicSurfaceIds: publicSurfaceIds[id] ?? [],
      })),
      ...managedWorkerDefinitions(selectedTarget).map((component) => ({
        id: managedWorkerService(component),
        workerName: component.workers[environment],
        enabled: true,
        publicSurfaceIds: [],
        managed: {
          binding: managedWorkerOperationalBinding(component),
          description: component.description,
          workflow: component.workflow.names[environment],
          workflowClass: component.workflow.className,
          containers: component.containers.map(
            ({ className, instanceType }) => ({
              className,
              instanceType,
            }),
          ),
          durableObjects: component.durableObjects.map(
            ({ className, storage }) => ({
              className,
              storage,
            }),
          ),
          stores: [component.d1Binding, component.r2Resource],
        },
      })),
    ],
    customDependencies: (
      selectedTarget.customWorker?.serviceBindings ?? []
    ).map(({ binding, workers }) => ({
      binding,
      workerName: workers[environment],
    })),
  };
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
