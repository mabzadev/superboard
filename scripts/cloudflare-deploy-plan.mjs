import {
  ALL_SERVICES,
  DOMAIN_SERVICES,
  isServiceEnabled,
} from "./cloudflare-services.mjs";
import { D1_SCHEMA_OWNERS } from "./cloudflare-d1-registry.mjs";

export function deploymentOrder(target) {
  return [
    "observability",
    "email",
    "files",
    "identity",
    ...DOMAIN_SERVICES.filter((service) => isServiceEnabled(target, service)),
    ...(target.features.billing ? ["billing"] : []),
    ...(target.features.messaging ? ["messaging"] : []),
    ...(target.customWorker ? ["custom"] : []),
    "api",
    "mcp",
    "dashboard",
  ];
}

export function buildDeploymentExecutionPlan({
  target,
  environment,
  requestedServices,
  uploadOnly = false,
  preflight = false,
  skipMigrations = false,
}) {
  const order = deploymentOrder(target);
  const requested = requestedServices
    ? [
        ...new Set(
          String(requestedServices)
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ]
    : order;
  for (const service of requested) {
    if (!ALL_SERVICES.includes(service) || !order.includes(service)) {
      throw new Error(`Unknown or disabled service: ${service}`);
    }
  }
  if (environment === "production" && skipMigrations) {
    throw new Error(
      "Production deployment cannot skip migrations for the selected topology",
    );
  }
  const services = order.filter((service) => requested.includes(service));
  const schemaServices = services.filter((service) =>
    D1_SCHEMA_OWNERS.includes(service),
  );
  const fullDeployment =
    services.length === order.length &&
    services.every((service, index) => service === order[index]);
  const batchBeforeWorkers =
    environment === "production" &&
    !uploadOnly &&
    !preflight &&
    fullDeployment &&
    schemaServices.length > 0;
  if (
    environment === "production" &&
    !uploadOnly &&
    !preflight &&
    !fullDeployment &&
    schemaServices.length > 0 &&
    services.length !== 1
  ) {
    throw new Error(
      "A partial production recovery may deploy only one D1 schema owner at a time; use the full batch rollout for multiple services",
    );
  }
  return {
    target: target.target,
    environment,
    services,
    schemaServices,
    fullDeployment,
    migrationStrategy: batchBeforeWorkers
      ? "backup-and-migrate-all-before-workers"
      : uploadOnly || preflight
        ? "none"
        : "per-service-before-worker",
    phases: batchBeforeWorkers
      ? [
          {
            id: "d1-batch",
            description:
              "Back up every D1 database, then migrate and verify every D1 database",
            services: schemaServices,
          },
          {
            id: "workers",
            description:
              "Deploy enabled Workers only after the complete D1 batch receipt exists",
            services,
          },
        ]
      : [
          {
            id: uploadOnly || preflight ? "worker-versions" : "workers",
            description:
              uploadOnly || preflight
                ? "Upload isolated Worker versions without migrations"
                : "Converge each selected schema immediately before its Worker",
            services,
          },
        ],
  };
}
