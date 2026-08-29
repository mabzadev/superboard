import {
  ALL_SERVICES,
  DOMAIN_SERVICES,
  DOMAIN_SERVICE_REGISTRY,
} from "./cloudflare-services.mjs";
import {
  customTargetOptions,
  dashboardCacheResourceName,
} from "./superboard-target-options.mjs";

export function newTargetManifest({ args, target, selectedEnvironment }) {
  const platformName = "superboard";
  const prefix = `${platformName}-${target}`;
  const suffix = selectedEnvironment === "production" ? "prod" : "dev";
  const resourcePrefix = () => `${prefix}-${suffix}`;
  const disabledFeatures = new Set(
    String(args["disable-features"] || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const legacyMessagingEnabled = Boolean(args["enable-legacy-messaging"]);
  const featureServices = ["billing", "messaging", ...DOMAIN_SERVICES];
  for (const feature of disabledFeatures) {
    if (!featureServices.includes(feature)) {
      throw new Error(`Unknown disabled feature: ${feature}`);
    }
  }
  const features = Object.fromEntries(
    featureServices.map((service) => [
      service,
      service === "messaging"
        ? legacyMessagingEnabled && !disabledFeatures.has(service)
        : !disabledFeatures.has(service),
    ]),
  );
  const customOptions = customTargetOptions(args, {
    target,
    environment: selectedEnvironment,
    baseResourceName: resourcePrefix(),
  });
  const enabledServices = ALL_SERVICES.filter(
    (service) =>
      [
        "api",
        "dashboard",
        "email",
        "identity",
        "files",
        "observability",
        "mcp",
      ].includes(service) ||
      (service === "custom" ? Boolean(customOptions) : features[service]),
  );
  const queues = () => ({
    events: `${resourcePrefix()}-events`,
    eventsDlq: `${resourcePrefix()}-events-dlq`,
    push: `${resourcePrefix()}-push`,
    pushDlq: `${resourcePrefix()}-push-dlq`,
    maintenance: `${resourcePrefix()}-maintenance`,
    maintenanceDlq: `${resourcePrefix()}-maintenance-dlq`,
    billing: `${resourcePrefix()}-billing`,
    billingDlq: `${resourcePrefix()}-billing-dlq`,
    messaging: `${resourcePrefix()}-messaging-events`,
    messagingDlq: `${resourcePrefix()}-messaging-events-dlq`,
    email: `${resourcePrefix()}-email-delivery`,
    emailDlq: `${resourcePrefix()}-email-delivery-dlq`,
  });
  const environmentResources = {
    d1: { name: `${resourcePrefix()}-db`, id: null },
    kv: { name: resourcePrefix(), id: null },
    r2: { name: resourcePrefix() },
    dashboardCache: {
      name: dashboardCacheResourceName(resourcePrefix()),
    },
    ...(legacyMessagingEnabled
      ? {
          messagingD1: {
            name: `${resourcePrefix()}-messaging-db`,
            id: null,
          },
          messagingR2: { name: `${resourcePrefix()}-messaging` },
          messagingProjectIds: [],
        }
      : {}),
    emailD1: { name: `${resourcePrefix()}-email-db`, id: null },
    identityD1: { name: `${resourcePrefix()}-identity-db`, id: null },
    filesD1: { name: `${resourcePrefix()}-files-db`, id: null },
    ...(customOptions?.environmentResources ?? {}),
    analyticsDataset: `${resourcePrefix().replaceAll("-", "_")}_runtime`,
    supportProjectIds: csv(args["support-project-ids"])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0),
    moduleD1: Object.fromEntries(
      DOMAIN_SERVICES.map((service) => {
        const key = DOMAIN_SERVICE_REGISTRY[service].resourceKey;
        return [
          key,
          {
            name:
              service === "support"
                ? `${resourcePrefix()}-support-v2-db`
                : `${resourcePrefix()}-${service}-db`,
            id: null,
          },
        ];
      }),
    ),
    moduleR2: {
      support: { name: `${resourcePrefix()}-support-v2-attachments` },
      analytics: { name: `${resourcePrefix()}-analytics-events` },
      marketing: { name: `${resourcePrefix()}-marketing-media` },
      flows: { name: `${resourcePrefix()}-flows-archive` },
    },
    moduleVectorize: {
      supportKnowledge: {
        name: `${resourcePrefix()}-support-v2-knowledge`,
        dimensions: 1024,
        metric: "cosine",
        description: "SuperBoard Support knowledge index",
      },
    },
    moduleQueues: {
      support: {
        name: `${resourcePrefix()}-support-v2-events`,
        dlq: `${resourcePrefix()}-support-v2-events-dlq`,
      },
      supportAi: {
        name: `${resourcePrefix()}-support-v2-ai`,
        dlq: `${resourcePrefix()}-support-v2-ai-dlq`,
      },
      supportBulk: {
        name: `${resourcePrefix()}-support-v2-bulk`,
        dlq: `${resourcePrefix()}-support-v2-bulk-dlq`,
      },
      analytics: {
        name: `${resourcePrefix()}-analytics-ingest`,
        dlq: `${resourcePrefix()}-analytics-ingest-dlq`,
      },
      marketing: {
        name: `${resourcePrefix()}-marketing-delivery`,
        dlq: `${resourcePrefix()}-marketing-delivery-dlq`,
      },
      flows: {
        name: `${resourcePrefix()}-flows-events`,
        dlq: `${resourcePrefix()}-flows-events-dlq`,
      },
    },
    supportRouting: {
      pattern: `${args["api-domain"]}/api/v1/support*`,
      worker: `${prefix}-api-${suffix}`,
      mode: selectedEnvironment === "production" ? "staged" : "active",
    },
    publicRouting: selectedEnvironment === "production" ? "staged" : "active",
    billingExecutionMode: "local",
    queues: {
      ...queues(),
      ...(!legacyMessagingEnabled
        ? { messaging: undefined, messagingDlq: undefined }
        : {}),
    },
  };

  return {
    $schema: "./schema.json",
    schemaVersion: 17,
    target,
    accountAlias: args["account-alias"],
    resourceIdentity: {
      logicalName: platformName,
      physicalName: platformName,
      previousNames: [],
      migrationStrategy: "canonical",
    },
    workersDevSubdomain: args["workers-dev-subdomain"],
    zoneName: args["zone-name"] || registrableZone(args["api-domain"]),
    registrationMode: "allowlist",
    ssoEnabled: false,
    features,
    applicationIdentity: {
      registrationMode: args["application-registration-mode"] || "open",
      applicationAudience:
        args["application-audience"] || `${target}.application`,
      googleAudiences: csv(args["google-audiences"]),
      appleAudiences: csv(args["apple-audiences"]),
      webOrigins: csv(args["application-web-origins"]),
    },
    filePolicy: {
      maxBytes: Number(args["max-file-bytes"]),
      downloadTicketTtlSeconds: Number(
        args["download-ticket-ttl-seconds"] ?? 600,
      ),
      allowedContentTypes: csv(args["allowed-file-content-types"]),
    },
    mail: {
      transport:
        args["mail-transport"] ??
        (selectedEnvironment === "development" ? "capture" : "smtp"),
      provider: args["mail-provider"] ?? "aws-ses",
      awsRegion: args["aws-region"] ?? "eu-central-1",
      configurationSet:
        args["mail-configuration-set"] ?? `superboard-${selectedEnvironment}`,
      fromName: "SuperBoard",
      fromAddress: args["mail-from-address"],
    },
    operator: {
      docsUrl: args["operator-docs-url"],
      ...(args["operator-support-email"]
        ? { supportEmail: args["operator-support-email"] }
        : {}),
    },
    domains: {
      api: args["api-domain"],
      auth: args["auth-domain"],
      shortlinks: args["shortlinks-domain"],
      sdk: args["sdk-domain"],
      dashboard: args["dashboard-domain"],
      files: args["files-domain"],
      mcp: args["mcp-domain"],
      ...(args["mail-preview-domain"]
        ? { mailPreview: args["mail-preview-domain"] }
        : {}),
      ...(legacyMessagingEnabled
        ? { messaging: args["messaging-domain"] }
        : {}),
    },
    retiredDomains: [],
    workers: Object.fromEntries(
      enabledServices.map((service) => [
        service,
        { [selectedEnvironment]: `${prefix}-${service}-${suffix}` },
      ]),
    ),
    ...(customOptions ? { customWorker: customOptions.worker } : {}),
    oauth: { dashboardClientId: `${prefix}-dashboard` },
    authGateway: {
      issuer: args["auth-gateway-issuer"],
      audience: args["auth-gateway-audience"],
      jwksUrl: args["auth-gateway-jwks-url"],
    },
    environments: { [selectedEnvironment]: environmentResources },
  };
}

function csv(value) {
  return [
    ...new Set(
      String(value ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function registrableZone(hostname) {
  const labels = String(hostname ?? "")
    .toLowerCase()
    .split(".")
    .filter(Boolean);
  if (labels.length < 2) {
    throw new Error("--zone-name is required when the API domain has no parent zone");
  }
  return labels.slice(-2).join(".");
}
