import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DOMAIN_SERVICES,
  DOMAIN_SERVICE_REGISTRY,
  isServiceEnabled,
} from "./cloudflare-services.mjs";
import { root } from "./cloudflare-target.mjs";

export const D1_SCHEMA_OWNERS = Object.freeze([
  "api",
  "site",
  "messaging",
  "email",
  "identity",
  "files",
  "custom",
  ...DOMAIN_SERVICES,
]);

export function d1Descriptor(
  target,
  targetName,
  environment,
  service,
  { includeDisabled = false } = {},
) {
  if (!D1_SCHEMA_OWNERS.includes(service)) {
    throw new Error(
      `D1 schema owner must be one of: ${D1_SCHEMA_OWNERS.join(", ")}`,
    );
  }
  const resources = target.environments?.[environment];
  if (!resources)
    throw new Error(`${targetName} does not define ${environment}`);
  if (!includeDisabled && !isServiceEnabled(target, service)) return null;

  const common = {
    target: targetName,
    environment,
    service,
    configPath: resolve(
      root,
      "deploy",
      "generated",
      `${targetName}-${service}-${environment}.jsonc`,
    ),
  };
  if (service === "api") {
    return descriptor(common, resources.d1, "DB", "workers/api/migrations");
  }
  if (service === "site") {
    return descriptor(common, resources.siteD1, "DB", "apps/site/migrations");
  }
  if (service === "messaging") {
    return descriptor(
      common,
      resources.messagingD1,
      "DB",
      "workers/messaging/migrations",
    );
  }
  if (service === "email") {
    return descriptor(
      common,
      resources.emailD1,
      "DB",
      "workers/email/migrations",
    );
  }
  if (service === "identity") {
    return descriptor(
      common,
      resources.identityD1,
      "DB",
      "workers/identity/migrations",
    );
  }
  if (service === "files") {
    return descriptor(
      common,
      resources.filesD1,
      "DB",
      "workers/files/migrations",
    );
  }
  if (service === "custom") {
    if (!target.customWorker?.d1Binding) return null;
    return descriptor(
      common,
      resources.customD1,
      target.customWorker.d1Binding.binding,
      target.customWorker.d1Binding.migrationsDir,
    );
  }
  const definition = DOMAIN_SERVICE_REGISTRY[service];
  return descriptor(
    common,
    resources.moduleD1?.[definition.resourceKey],
    "DB",
    `workers/${definition.resourceKey === "dynamicLinks" ? "dynamic-links" : definition.resourceKey}/migrations`,
  );
}

export function targetD1Descriptors(
  target,
  targetName,
  environment,
  requested = "all",
) {
  const services =
    requested === "all"
      ? D1_SCHEMA_OWNERS
      : String(requested)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
  if (services.length === 0)
    throw new Error("At least one D1 schema owner is required");
  const unknown = services.filter(
    (service) => !D1_SCHEMA_OWNERS.includes(service),
  );
  if (unknown.length)
    throw new Error(`Unknown D1 schema owner: ${unknown.join(", ")}`);
  return [...new Set(services)]
    .map((service) => d1Descriptor(target, targetName, environment, service))
    .filter(Boolean);
}

export async function localMigrationFiles(value) {
  const entries = await readdir(value.migrationsPath, { withFileTypes: true });
  const files = entries
    .filter(
      (entry) => entry.isFile() && /^\d+[a-z0-9_-]*\.sql$/iu.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
  if (files.length === 0)
    throw new Error(`${value.service} has no D1 migration files`);
  return files;
}

function descriptor(common, resource, binding, migrationsDirectory) {
  if (!resource?.name)
    throw new Error(`${common.service} does not define its D1 resource`);
  return Object.freeze({
    ...common,
    binding,
    databaseName: resource.name,
    databaseId: resource.id ?? null,
    migrationsDirectory,
    migrationsPath: resolve(root, migrationsDirectory),
  });
}
