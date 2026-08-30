import {
  ALL_SERVICES,
  DOMAIN_SERVICES,
  isServiceEnabled,
  managedWorkerDefinition,
  managedWorkerServices,
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
    ...managedWorkerServices(target),
    ...(target.customWorker ? ["custom"] : []),
    "api",
    "mcp",
    "site",
    "dashboard",
  ];
}

export function runtimeBridgeDeploymentBlockers({
  target,
  environment,
  services,
  uploadOnly = false,
}) {
  if (uploadOnly || !target.customWorker?.managedWorkers?.length) return [];
  const managed = new Set(managedWorkerServices(target));
  const selected = new Set(services);
  const bridgeSelected =
    selected.has("custom") ||
    [...managed].some((service) => selected.has(service));
  const activeApiCutover =
    selected.has("api") &&
    target.environments[environment].publicRouting === "active";
  if (!bridgeSelected && !activeApiCutover) return [];

  const bridge = target.customWorker.runtimeBridge;
  if (!bridge) {
    return [
      {
        id: "runtime-bridge-missing",
        action:
          "Declare and verify the managed Worker Files/output/gateway runtime bridge before active deployment.",
      },
    ];
  }
  const blockers = [];
  if (bridge.deploymentStatus !== "verified") {
    blockers.push({
      id: "runtime-bridge-unverified",
      action: bridge.blockedReason,
    });
  }
  if (target.environments[environment].publicRouting !== "active") {
    blockers.push({
      id: "files-input-routing-inactive",
      action: `Activate and verify ${bridge.filesInputOrigin} before Workers consume Files download tickets.`,
    });
  }
  if (bridge.gatewayWorker !== target.workers.api[environment]) {
    blockers.push({
      id: "gateway-callback-owner-mismatch",
      action: `Port and test ${bridge.callbackPaths.join(", ")} on ${target.workers.api[environment]} before ${target.domains.api} leaves ${bridge.gatewayWorker}.`,
    });
  }
  return blockers;
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
    if (
      (!ALL_SERVICES.includes(service) &&
        !managedWorkerDefinition(target, service)) ||
      !order.includes(service)
    ) {
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
  const identityCutover =
    services.includes("identity") && !uploadOnly && !preflight;
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
  const blockers = runtimeBridgeDeploymentBlockers({
    target,
    environment,
    services,
    uploadOnly: uploadOnly || preflight,
  });
  return {
    target: target.target,
    environment,
    services,
    schemaServices,
    identityCutover,
    fullDeployment,
    migrationStrategy: batchBeforeWorkers
      ? "backup-and-migrate-all-before-workers"
      : uploadOnly || preflight
        ? "none"
        : "per-service-before-worker",
    blockers,
    phases: batchBeforeWorkers
      ? [
          {
            id: "d1-batch",
            description:
              "Back up every D1 database, then migrate and verify every D1 database",
            services: schemaServices,
          },
          {
            id: "identity-cutover",
            description:
              "Prove the remote Identity migration and zero unscoped legacy rows, then bind a receipt to this exact deployment revision",
            services: ["identity"],
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
                : identityCutover
                  ? "Converge each selected schema and verify the Identity project cutover receipt immediately before its Worker"
                  : "Converge each selected schema immediately before its Worker",
            services,
          },
        ],
  };
}
