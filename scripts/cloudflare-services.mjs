export const DOMAIN_SERVICE_REGISTRY = Object.freeze({
  app: domainService("APP_MODULE", "app"),
  products: domainService("PRODUCTS_MODULE", "products"),
  paywalls: domainService("PAYWALLS_MODULE", "paywalls"),
  "dynamic-links": domainService("DYNAMIC_LINKS_MODULE", "dynamicLinks"),
  support: domainService("SUPPORT_MODULE", "support", {
    secrets: [
      "INTERNAL_API_TOKEN",
      "INTERNAL_API_TOKEN_PREVIOUS",
      "SUPPORT_WEBHOOK_ENCRYPTION_KEY",
    ],
    vars: ["CORS_ORIGIN", "ALLOWED_PROJECT_IDS"],
    r2: [{ binding: "ATTACHMENTS", resourceKey: "support" }],
    queue: {
      binding: "SUPPORT_QUEUE",
      resourceKey: "support",
      maxBatchSize: 10,
      maxBatchTimeout: 5,
      maxRetries: 8,
    },
    durableObjects: [{ name: "CONVERSATIONS", className: "ConversationRoom" }],
    durableObjectMigrations: [
      { tag: "v1", newSqliteClasses: ["ConversationRoom"] },
    ],
  }),
  analytics: domainService("ANALYTICS_MODULE", "analytics", {
    secrets: [
      "INTERNAL_API_TOKEN",
      "INTERNAL_API_TOKEN_PREVIOUS",
      "ANALYTICS_ID_HASH_KEY",
      "ANALYTICS_ID_HASH_KEY_PREVIOUS",
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
    services: [{ binding: "MARKETING_MODULE", service: "marketing" }],
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
    vars: ["PUBLIC_API_URL"],
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
});

export const DOMAIN_SERVICES = Object.freeze(
  Object.keys(DOMAIN_SERVICE_REGISTRY),
);

export const PLATFORM_SERVICES = Object.freeze([
  "api",
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
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURITY",
    "SMTP_USERNAME",
    "SMTP_PASSWORD",
  ]),
  identity: Object.freeze([
    "IDENTITY_KEYSET",
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
  return Object.freeze({
    binding,
    resourceKey,
    main: `../../workers/${resourceKey === "dynamicLinks" ? "dynamic-links" : resourceKey}/src/index.ts`,
    migrationsDir: `../../workers/${resourceKey === "dynamicLinks" ? "dynamic-links" : resourceKey}/migrations`,
    secrets: Object.freeze(
      options.secrets ?? ["INTERNAL_API_TOKEN", "INTERNAL_API_TOKEN_PREVIOUS"],
    ),
    vars: Object.freeze(options.vars ?? []),
    r2: Object.freeze(options.r2 ?? []),
    queue: options.queue ? Object.freeze(options.queue) : null,
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
