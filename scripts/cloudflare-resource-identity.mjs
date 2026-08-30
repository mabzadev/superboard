const NAME = /^[a-z][a-z0-9-]{1,62}$/u;
const MIGRATION_STRATEGIES = new Set(["canonical", "retain-physical-name"]);

export function resourceIdentity(target) {
  const identity = target?.resourceIdentity;
  if (!identity || typeof identity !== "object") {
    throw new Error("Target resourceIdentity is required");
  }
  const logicalName = String(identity.logicalName ?? "");
  const physicalName = String(identity.physicalName ?? "");
  const previousNames = identity.previousNames;
  const migrationStrategy = String(identity.migrationStrategy ?? "");
  if (!NAME.test(logicalName) || !NAME.test(physicalName)) {
    throw new Error(
      "Target resourceIdentity logicalName and physicalName must be safe lowercase names",
    );
  }
  if (
    !Array.isArray(previousNames) ||
    previousNames.some((name) => !NAME.test(String(name))) ||
    new Set(previousNames).size !== previousNames.length
  ) {
    throw new Error(
      "Target resourceIdentity previousNames must contain unique safe lowercase names",
    );
  }
  if (!MIGRATION_STRATEGIES.has(migrationStrategy)) {
    throw new Error(
      `Unsupported resourceIdentity migrationStrategy: ${migrationStrategy || "<empty>"}`,
    );
  }
  if (
    migrationStrategy === "canonical" &&
    (logicalName !== physicalName || previousNames.length !== 0)
  ) {
    throw new Error(
      "Canonical resourceIdentity requires identical logical/physical names and no previous names",
    );
  }
  if (
    migrationStrategy === "retain-physical-name" &&
    (logicalName === physicalName || !previousNames.includes(physicalName))
  ) {
    throw new Error(
      "retain-physical-name requires distinct names and the physical name in previousNames",
    );
  }
  return {
    logicalName,
    physicalName,
    previousNames: [...previousNames],
    migrationStrategy,
  };
}

export function resourceNameContract(target, physicalName, options = {}) {
  const identity = resourceIdentity(target);
  const name = String(physicalName ?? "");
  if (!name) throw new Error("Cloudflare physical resource name is required");
  const namespaceOwned = namespaceName(name, identity.physicalName);
  if (!namespaceOwned && options.allowLegacyName !== true) {
    throw new Error(
      `Cloudflare physical resource ${name} is outside the declared ${identity.physicalName} namespace`,
    );
  }
  const logicalName = namespaceOwned
    ? `${identity.logicalName}${name.slice(identity.physicalName.length)}`
    : `${identity.logicalName}-${name}`;
  return {
    logicalName,
    physicalName: name,
    previousNames:
      identity.migrationStrategy === "retain-physical-name" ? [name] : [],
    migrationStrategy: identity.migrationStrategy,
  };
}

export function assertTargetPhysicalResourceNames(target, environment) {
  const resources = target.environments?.[environment];
  if (!resources) {
    throw new Error(`${target.target} does not define ${environment}`);
  }
  const contracts = [];
  const add = (key, value, options = {}) => {
    if (!value) return;
    const physicalName =
      typeof value === "string" ? value : String(value.name ?? "");
    contracts.push({
      key,
      ...resourceNameContract(target, physicalName, {
        allowLegacyName: options.allowLegacyName || value?.legacyName === true,
      }),
    });
  };

  for (const [service, names] of Object.entries(target.workers ?? {})) {
    add(`workers.${service}`, names?.[environment]);
  }
  for (const key of [
    "d1",
    "kv",
    "r2",
    "dashboardCache",
    "messagingD1",
    "messagingR2",
    "emailD1",
    "identityD1",
    "filesD1",
    "customD1",
    "customR2",
  ]) {
    add(key, resources[key]);
  }
  for (const [key, value] of Object.entries(resources.moduleD1 ?? {})) {
    add(`moduleD1.${key}`, value);
  }
  for (const [key, value] of Object.entries(resources.moduleR2 ?? {})) {
    add(`moduleR2.${key}`, value);
  }
  for (const [key, value] of Object.entries(
    resources.moduleVectorize ?? {},
  )) {
    add(`moduleVectorize.${key}`, value);
  }
  for (const [key, value] of Object.entries(resources.queues ?? {})) {
    add(`queues.${key}`, value);
  }
  for (const [key, value] of Object.entries(resources.moduleQueues ?? {})) {
    add(`moduleQueues.${key}.name`, value.name);
    add(`moduleQueues.${key}.dlq`, value.dlq);
  }
  add("analyticsDataset", resources.analyticsDataset);
  return contracts;
}

function namespaceName(name, namespace) {
  return (
    name === namespace ||
    name.startsWith(`${namespace}-`) ||
    name.startsWith(`${namespace}_`)
  );
}
