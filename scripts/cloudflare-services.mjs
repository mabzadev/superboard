export const DOMAIN_SERVICE_REGISTRY = Object.freeze({
  app: domainService("APP_MODULE", "app"),
  products: domainService("PRODUCTS_MODULE", "products"),
  paywalls: domainService("PAYWALLS_MODULE", "paywalls"),
  "dynamic-links": domainService("DYNAMIC_LINKS_MODULE", "dynamicLinks"),
  support: domainService("SUPPORT_MODULE", "support", {
    secrets: [
      "INTERNAL_API_TOKEN",
      "INTERNAL_API_TOKEN_PREVIOUS",
      "EMAIL_INTERNAL_TOKEN",
      "SUPPORT_CREDENTIAL_ENCRYPTION_KEY",
      "SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS",
      "SUPPORT_WEBHOOK_ENCRYPTION_KEY",
    ],
    vars: ["CORS_ORIGIN", "ALLOWED_PROJECT_IDS"],
    staticVars: {
      SUPPORT_EMBEDDING_MODEL: "@cf/qwen/qwen3-embedding-0.6b",
      SUPPORT_GENERATION_MODEL: "@cf/zai-org/glm-4.7-flash",
    },
    r2: [{ binding: "ATTACHMENTS", resourceKey: "support" }],
    queues: [
      {
        binding: "SUPPORT_QUEUE",
        resourceKey: "support",
        nameVar: "SUPPORT_EVENTS_QUEUE_NAME",
        dlqVar: "SUPPORT_EVENTS_DLQ_NAME",
        maxBatchSize: 10,
        maxBatchTimeout: 5,
        maxRetries: 8,
      },
      {
        binding: "SUPPORT_AI_QUEUE",
        resourceKey: "supportAi",
        nameVar: "SUPPORT_AI_QUEUE_NAME",
        dlqVar: "SUPPORT_AI_DLQ_NAME",
        maxBatchSize: 5,
        maxBatchTimeout: 5,
        maxRetries: 5,
      },
      {
        binding: "SUPPORT_BULK_QUEUE",
        resourceKey: "supportBulk",
        nameVar: "SUPPORT_BULK_QUEUE_NAME",
        dlqVar: "SUPPORT_BULK_DLQ_NAME",
        maxBatchSize: 5,
        maxBatchTimeout: 5,
        maxRetries: 8,
      },
    ],
    crons: ["* * * * *"],
    ai: { binding: "AI" },
    vectorize: [
      { binding: "SUPPORT_KNOWLEDGE", resourceKey: "supportKnowledge" },
    ],
    durableObjects: [{ name: "CONVERSATIONS", className: "ConversationRoom" }],
    durableObjectMigrations: [
      { tag: "v1", newSqliteClasses: ["ConversationRoom"] },
    ],
    services: [
      { binding: "EMAIL_SERVICE", service: "email" },
      { binding: "API_SERVICE", service: "api" },
    ],
  }),
  analytics: domainService("ANALYTICS_MODULE", "analytics", {
    secrets: [
      "INTERNAL_API_TOKEN",
      "INTERNAL_API_TOKEN_PREVIOUS",
      "EMAIL_INTERNAL_TOKEN",
      "ANALYTICS_ID_HASH_KEY",
      "ANALYTICS_ID_HASH_KEY_PREVIOUS",
      "ANALYTICS_CONFIG_ENCRYPTION_KEY",
    ],
    r2: [{ binding: "EVENT_ARCHIVE", resourceKey: "analytics" }],
    queue: {
      binding: "ANALYTICS_INGEST_QUEUE",
      resourceKey: "analytics",
      maxBatchSize: 25,
      maxBatchTimeout: 5,
      maxRetries: 8,
    },
    crons: ["* * * * *"],
    workflows: [
      {
        binding: "ANALYTICS_OPERATIONS_WORKFLOW",
        className: "AnalyticsOperationsWorkflow",
        nameSuffix: "operations",
      },
    ],
    services: [
      { binding: "MARKETING_MODULE", service: "marketing" },
      { binding: "EMAIL_SERVICE", service: "email" },
    ],
  }),
  marketing: domainService("MARKETING_MODULE", "marketing", {
    secrets: [
      "INTERNAL_API_TOKEN",
      "INTERNAL_API_TOKEN_PREVIOUS",
      "EMAIL_INTERNAL_TOKEN",
      "ANALYTICS_ID_HASH_KEY",
      "ANALYTICS_ID_HASH_KEY_PREVIOUS",
      "SMTP_ENCRYPTION_KEY",
      "TRACKING_SIGNING_KEY",
    ],
    vars: ["PUBLIC_API_URL", "EMAIL_PROVIDER", "AWS_REGION"],
    r2: [{ binding: "MEDIA", resourceKey: "marketing" }],
    queue: {
      binding: "MARKETING_QUEUE",
      resourceKey: "marketing",
      maxBatchSize: 10,
      maxBatchTimeout: 5,
      maxRetries: 5,
    },
    crons: ["* * * * *"],
    services: [{ binding: "EMAIL_SERVICE", service: "email" }],
  }),
  onboardings: domainService("ONBOARDINGS_MODULE", "onboardings"),
  flows: domainService("FLOWS_MODULE", "flows", {
    secrets: [
      "INTERNAL_API_TOKEN",
      "INTERNAL_API_TOKEN_PREVIOUS",
      "FLOW_USER_ENCRYPTION_KEY",
      "FLOW_USER_ENCRYPTION_KEY_PREVIOUS",
      "FLOW_USER_HASH_KEY",
    ],
    vars: ["PUBLIC_API_URL"],
    r2: [{ binding: "ARCHIVE", resourceKey: "flows" }],
    queue: {
      binding: "FLOW_EVENTS",
      resourceKey: "flows",
      maxBatchSize: 25,
      maxBatchTimeout: 5,
      maxRetries: 8,
    },
    crons: ["17 2 * * *"],
    durableObjects: [
      { name: "FLOW_USER_RUNTIME", className: "FlowUserRuntime" },
      { name: "FLOW_REALTIME_HUB", className: "FlowRealtimeHub" },
    ],
    durableObjectMigrations: [
      {
        tag: "v1",
        newSqliteClasses: ["FlowUserRuntime", "FlowRealtimeHub"],
      },
    ],
    workflows: [
      {
        binding: "FLOW_DELAY_EXECUTION",
        className: "FlowDelayExecution",
        nameSuffix: "delay",
      },
      {
        binding: "FLOW_MAINTENANCE_EXECUTION",
        className: "FlowMaintenanceExecution",
        nameSuffix: "maintenance",
      },
    ],
    services: [{ binding: "PRODUCTS_MODULE", service: "products" }],
  }),
});

export const DOMAIN_SERVICES = Object.freeze(
  Object.keys(DOMAIN_SERVICE_REGISTRY),
);

export const PLATFORM_SERVICES = Object.freeze([
  "api",
  "site",
  "dashboard",
  "billing",
  "messaging",
  "email",
  "identity",
  "files",
  "observability",
  "mcp",
  "custom",
]);

const BILLING_SECRETS = Object.freeze([
  "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
  "STORE_CREDENTIALS_ENCRYPTION_KEY",
  "STORE_CREDENTIALS_ENCRYPTION_KEYS",
  "STORE_CREDENTIALS_ACTIVE_KEY_VERSION",
  "PURCHASES_SIGNING_KEYSET",
  "OPENGROW_ENTITLEMENT_WEBHOOK_SECRET",
  "APPLE_ROOT_CERTIFICATES_B64",
]);

export const PLATFORM_SERVICE_SECRETS = Object.freeze({
  api: Object.freeze([
    "JWT_SECRET",
    "MODULE_INTERNAL_TOKEN",
    "FLOWS_INTERNAL_TOKEN",
    "EMAIL_INTERNAL_TOKEN",
    "OPENGROW_CUTOVER_TOKEN",
    "SENT_QUOTAS_WEBHOOK_KEY",
    "PUSH_PROCESS_KEY",
    "IAP_PROCESS_KEY",
    "GOOGLE_PUBSUB_VERIFICATION_TOKEN",
    "MESSAGING_INTERNAL_TOKEN",
    "BILLING_CREDENTIALS_REWRAP_KEY",
    "GOOGLE_CLIENT_SECRET",
    "MICROSOFT_CLIENT_SECRET",
    "ADMIN_API_KEY",
    "MAINTENANCE_PROCESS_KEY",
    "DIAGNOSTICS_API_KEY",
    "MAIL_WEBHOOK_TOKEN",
    "RESEND_API_KEY",
    "POSTMARK_SERVER_TOKEN",
    "SENDGRID_API_KEY",
    "CUSTOM_WORKER_TOKEN",
    "OBSERVABILITY_INTERNAL_TOKEN",
    ...BILLING_SECRETS,
  ]),
  dashboard: Object.freeze(["CLIENT_SECRET"]),
  site: Object.freeze([
    "EMDASH_ENCRYPTION_KEY",
    "SUPERBOARD_RELEASE_PRIVATE_JWK",
    "MODULE_INTERNAL_TOKEN",
  ]),
  billing: Object.freeze([
    ...BILLING_SECRETS,
    "INTERNAL_API_TOKEN",
    "INTERNAL_API_TOKEN_PREVIOUS",
  ]),
  messaging: Object.freeze([
    "INTERNAL_API_TOKEN",
    "INTERNAL_API_TOKEN_PREVIOUS",
  ]),
  email: Object.freeze([
    "EMAIL_INTERNAL_TOKEN",
    "EMAIL_INTERNAL_TOKEN_PREVIOUS",
    "MAIL_PREVIEW_TOKEN",
    "AWS_SES_SMTP_USERNAME",
    "AWS_SES_SMTP_PASSWORD",
    "AWS_SES_SNS_TOPIC_ARN",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURITY",
    "SMTP_USERNAME",
    "SMTP_PASSWORD",
  ]),
  identity: Object.freeze([
    "IDENTITY_KEYSET",
    "MELODY_AUTH_SECRETS",
    "EMAIL_INTERNAL_TOKEN",
    "FILES_INTERNAL_TOKEN",
    "INTERNAL_API_TOKEN",
    "INTERNAL_API_TOKEN_PREVIOUS",
  ]),
  files: Object.freeze([
    "FILES_INTERNAL_TOKEN",
    "FILES_INTERNAL_TOKEN_PREVIOUS",
    "FILES_DOWNLOAD_SIGNING_KEY",
    "FILES_DOWNLOAD_SIGNING_KEY_PREVIOUS",
  ]),
  observability: Object.freeze([
    "OBSERVABILITY_INTERNAL_TOKEN",
    "OBSERVABILITY_INTERNAL_TOKEN_PREVIOUS",
    "CLOUDFLARE_ANALYTICS_ACCOUNT_ID",
    "CLOUDFLARE_ANALYTICS_TOKEN",
  ]),
  mcp: Object.freeze([]),
});

export const ALL_SERVICES = Object.freeze([
  ...PLATFORM_SERVICES,
  ...DOMAIN_SERVICES,
]);

const MANAGED_WORKER_SERVICE_PREFIX = "managed-";

export function managedWorkerService(component) {
  const id = String(component?.id ?? "");
  if (!/^[a-z][a-z0-9-]{1,21}$/u.test(id)) {
    throw new Error(`Invalid managed Worker id: ${id || "<empty>"}`);
  }
  return `${MANAGED_WORKER_SERVICE_PREFIX}${id}`;
}

export function managedWorkerOperationalBinding(component) {
  return managedWorkerService(component).replaceAll("-", "_").toUpperCase();
}

export function managedWorkerDefinitions(target) {
  return target.customWorker?.managedWorkers ?? [];
}

export function managedWorkerDefinition(target, service) {
  return (
    managedWorkerDefinitions(target).find(
      (component) => managedWorkerService(component) === service,
    ) ?? null
  );
}

export function managedWorkerServices(target) {
  return managedWorkerDefinitions(target).map(managedWorkerService);
}

export function assertServiceForTarget(target, service) {
  if (
    !ALL_SERVICES.includes(service) &&
    !managedWorkerDefinition(target, service)
  ) {
    throw new Error(
      `--service must be a platform service or a managed Worker declared by ${target.target}`,
    );
  }
}

export function workerNamesForService(target, service) {
  return (
    managedWorkerDefinition(target, service)?.workers ??
    target.workers?.[service]
  );
}

export function workerNameForService(target, service, environment) {
  return workerNamesForService(target, service)?.[environment] ?? null;
}

export const DOMAIN_SERVICE_BINDINGS = Object.freeze({
  ...Object.fromEntries(
    Object.entries(DOMAIN_SERVICE_REGISTRY).map(([service, definition]) => [
      service,
      definition.binding,
    ]),
  ),
});

export function assertService(service) {
  if (!ALL_SERVICES.includes(service)) {
    throw new Error(`--service must be one of: ${ALL_SERVICES.join(", ")}`);
  }
}

export function isServiceEnabled(target, service) {
  if (managedWorkerDefinition(target, service)) return true;
  if (
    [
      "api",
      "site",
      "dashboard",
      "email",
      "identity",
      "files",
      "observability",
      "mcp",
    ].includes(service)
  )
    return true;
  if (service === "custom") return Boolean(target.customWorker);
  return target.features?.[service] === true;
}

export function moduleResourceKey(service) {
  if (!DOMAIN_SERVICES.includes(service)) {
    throw new Error(`${service} is not a domain service`);
  }
  return DOMAIN_SERVICE_REGISTRY[service].resourceKey;
}

export function isOptionalSecretBinding(name) {
  return typeof name === "string" && name.endsWith("_PREVIOUS");
}

function domainService(binding, resourceKey, options = {}) {
  const queues = options.queues ?? (options.queue ? [options.queue] : []);
  return Object.freeze({
    binding,
    resourceKey,
    main: `../../workers/${resourceKey === "dynamicLinks" ? "dynamic-links" : resourceKey}/src/index.ts`,
    migrationsDir: `../../workers/${resourceKey === "dynamicLinks" ? "dynamic-links" : resourceKey}/migrations`,
    secrets: Object.freeze(
      options.secrets ?? ["INTERNAL_API_TOKEN", "INTERNAL_API_TOKEN_PREVIOUS"],
    ),
    vars: Object.freeze(options.vars ?? []),
    staticVars: Object.freeze({ ...(options.staticVars ?? {}) }),
    r2: Object.freeze(options.r2 ?? []),
    // `queue` remains as a compatibility alias while callers migrate to the
    // complete `queues` collection.
    queue: queues[0] ? Object.freeze({ ...queues[0] }) : null,
    queues: Object.freeze(queues.map((queue) => Object.freeze({ ...queue }))),
    ai: options.ai ? Object.freeze({ ...options.ai }) : null,
    vectorize: Object.freeze(
      (options.vectorize ?? []).map((binding) =>
        Object.freeze({ ...binding }),
      ),
    ),
    crons: Object.freeze(options.crons ?? []),
    durableObjects: Object.freeze(options.durableObjects ?? []),
    services: Object.freeze(options.services ?? []),
    workflows: Object.freeze(options.workflows ?? []),
    durableObjectMigrations: Object.freeze(
      options.durableObjectMigrations ?? [],
    ),
    internalRoute: "/internal/v1",
  });
}
