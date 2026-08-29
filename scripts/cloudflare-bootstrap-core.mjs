import { createHash } from "node:crypto";
import {
  DOMAIN_SERVICES,
  DOMAIN_SERVICE_REGISTRY,
} from "./cloudflare-services.mjs";
import {
  resourceIdentity,
  resourceNameContract,
} from "./cloudflare-resource-identity.mjs";

const KIND = {
  d1: {
    endpoint: "/d1/database",
    nameField: "name",
    idField: "uuid",
    createBody: (resource) => ({ name: resource.name }),
  },
  kv: {
    endpoint: "/storage/kv/namespaces",
    nameField: "title",
    idField: "id",
    createBody: (resource) => ({ title: resource.name }),
  },
  r2: {
    endpoint: "/r2/buckets",
    nameField: "name",
    idField: null,
    createBody: (resource) => ({ name: resource.name }),
  },
  queue: {
    endpoint: "/queues",
    nameField: "queue_name",
    idField: "queue_id",
    createBody: (resource) => ({ queue_name: resource.name }),
  },
  vectorize: {
    endpoint: "/vectorize/v2/indexes",
    nameField: "name",
    idField: null,
    createBody: (resource) => ({
      name: resource.name,
      config: {
        dimensions: resource.configuration.dimensions,
        metric: resource.configuration.metric,
      },
      ...(resource.configuration.description
        ? { description: resource.configuration.description }
        : {}),
    }),
  },
};

export function desiredCloudflareResources(target, environment) {
  const resources = target.environments?.[environment];
  if (!resources) {
    throw new Error(`${target.target} does not define ${environment}`);
  }
  const desired = [
    idResource("d1", "d1", "Central API D1", resources.d1, ["d1", "id"]),
    idResource("kv", "kv", "API KV", resources.kv, ["kv", "id"]),
    idResource("emailD1", "d1", "Email D1", resources.emailD1, [
      "emailD1",
      "id",
    ]),
    idResource("identityD1", "d1", "Identity D1", resources.identityD1, [
      "identityD1",
      "id",
    ]),
    idResource("filesD1", "d1", "Files D1", resources.filesD1, [
      "filesD1",
      "id",
    ]),
  ];
  if (target.features.messaging) {
    desired.push(
      idResource(
        "messagingD1",
        "d1",
        "Legacy Messaging D1",
        resources.messagingD1,
        ["messagingD1", "id"],
      ),
    );
  }
  if (target.customWorker?.d1Binding) {
    desired.push(
      idResource("customD1", "d1", "Custom Worker D1", resources.customD1, [
        "customD1",
        "id",
      ]),
    );
  }
  if (
    (target.customWorker?.managedWorkers ?? []).some(
      ({ r2Resource }) => r2Resource === "customR2",
    )
  ) {
    desired.push(
      namedResource("customR2", "r2", "Custom Worker R2", resources.customR2),
    );
  }
  const enabledModuleKeys = new Set(
    DOMAIN_SERVICES.filter((service) => target.features[service]).map(
      (service) => DOMAIN_SERVICE_REGISTRY[service].resourceKey,
    ),
  );
  for (const [moduleName, resource] of Object.entries(
    resources.moduleD1 ?? {},
  ).filter(([moduleName]) => enabledModuleKeys.has(moduleName))) {
    desired.push(
      idResource(`moduleD1.${moduleName}`, "d1", `${moduleName} D1`, resource, [
        "moduleD1",
        moduleName,
        "id",
      ]),
    );
  }
  desired.push(
    namedResource("r2", "r2", "Application files R2", resources.r2),
    namedResource(
      "dashboardCache",
      "r2",
      "Dashboard cache R2",
      resources.dashboardCache,
    ),
  );
  if (target.features.messaging) {
    desired.push(
      namedResource(
        "messagingR2",
        "r2",
        "Legacy Messaging R2",
        resources.messagingR2,
      ),
    );
  }
  for (const [moduleName, resource] of Object.entries(
    resources.moduleR2 ?? {},
  ).filter(([moduleName]) => target.features[moduleName])) {
    desired.push(
      namedResource(
        `moduleR2.${moduleName}`,
        "r2",
        `${moduleName} R2`,
        resource,
      ),
    );
  }
  for (const [resourceKey, resource] of Object.entries(
    resources.moduleVectorize ?? {},
  ).filter(([resourceKey]) =>
    DOMAIN_SERVICES.some(
      (service) =>
        target.features[service] &&
        DOMAIN_SERVICE_REGISTRY[service].vectorize.some(
          (binding) => binding.resourceKey === resourceKey,
        ),
    ),
  )) {
    desired.push(
      vectorizeResource(
        `moduleVectorize.${resourceKey}`,
        `${resourceKey} Vectorize index`,
        resource,
      ),
    );
  }
  const queueKeys = [
    "events",
    "eventsDlq",
    "push",
    "pushDlq",
    "maintenance",
    "maintenanceDlq",
    "email",
    "emailDlq",
    ...(target.features.billing ? ["billing", "billingDlq"] : []),
    ...(target.features.messaging ? ["messaging", "messagingDlq"] : []),
  ];
  for (const key of queueKeys) {
    desired.push(
      namedResource(`queues.${key}`, "queue", `${key} Queue`, {
        name: resources.queues[key],
      }),
    );
  }
  const enabledModuleQueueKeys = new Set(
    DOMAIN_SERVICES.filter((service) => target.features[service]).flatMap(
      (service) =>
        DOMAIN_SERVICE_REGISTRY[service].queues.map(
          (queue) => queue.resourceKey,
        ),
    ),
  );
  for (const [moduleName, queue] of Object.entries(
    resources.moduleQueues ?? {},
  ).filter(([moduleName]) => enabledModuleQueueKeys.has(moduleName))) {
    desired.push(
      namedResource(
        `moduleQueues.${moduleName}.name`,
        "queue",
        `${moduleName} Queue`,
        { name: queue.name },
      ),
      namedResource(
        `moduleQueues.${moduleName}.dlq`,
        "queue",
        `${moduleName} dead-letter Queue`,
        { name: queue.dlq },
      ),
    );
  }
  const contracted = desired.map((resource) => ({
    ...resource,
    ...resourceNameContract(target, resource.name, {
      allowLegacyName: resource.legacyName,
    }),
  }));
  assertUniqueDesiredResources(contracted);
  return contracted;
}

export function buildCloudflareBootstrapPlan({
  target,
  environment,
  accountId,
  inventories,
  freshSupportInstall = false,
}) {
  if (freshSupportInstall && !target.features?.support) {
    throw new Error("fresh-support-install requires Support to be enabled");
  }
  const desired = desiredCloudflareResources(target, environment).filter(
    (resource) => !freshSupportInstall || isFreshSupportResource(resource),
  );
  const resources = [];
  const operations = [];
  const blockers = [];
  for (const resource of desired) {
    const inventory = inventories[resource.kind];
    if (!Array.isArray(inventory)) {
      throw new Error(`Missing ${resource.kind} remote inventory`);
    }
    const definition = KIND[resource.kind];
    const named = inventory.filter(
      (item) => String(item?.[definition.nameField] ?? "") === resource.name,
    );
    if (named.length > 1) {
      blockers.push({
        type: "ambiguous-resource-name",
        key: resource.key,
        kind: resource.kind,
        name: resource.name,
        matches: named.length,
      });
      resources.push(resourceState(resource, "blocked", null));
      continue;
    }
    const remoteByName = named[0] ?? null;
    if (freshSupportInstall && resource.manifestId) {
      blockers.push({
        type: "fresh-resource-id-already-configured",
        key: resource.key,
        kind: resource.kind,
        name: resource.name,
      });
      resources.push(resourceState(resource, "blocked", resource.manifestId));
      continue;
    }
    if (freshSupportInstall && !resource.name.includes("-support-v2-")) {
      blockers.push({
        type: "fresh-resource-name-not-v2",
        key: resource.key,
        kind: resource.kind,
        name: resource.name,
      });
      resources.push(resourceState(resource, "blocked", null));
      continue;
    }
    if (freshSupportInstall && remoteByName) {
      blockers.push({
        type: "fresh-resource-already-exists",
        key: resource.key,
        kind: resource.kind,
        name: resource.name,
      });
      resources.push(resourceState(resource, "blocked", null));
      continue;
    }
    if (
      remoteByName &&
      resource.kind === "vectorize" &&
      !sameVectorizeConfiguration(resource.configuration, remoteByName.config)
    ) {
      blockers.push({
        type: "configured-resource-shape-mismatch",
        key: resource.key,
        kind: resource.kind,
        name: resource.name,
        expected: resource.configuration,
        remote: remoteByName.config ?? null,
      });
      resources.push(resourceState(resource, "blocked", null));
      continue;
    }
    const remoteId =
      remoteByName && definition.idField
        ? String(remoteByName[definition.idField] ?? "") || null
        : null;
    if (resource.manifestId) {
      const remoteById = definition.idField
        ? (inventory.find(
            (item) =>
              String(item?.[definition.idField] ?? "") === resource.manifestId,
          ) ?? null)
        : null;
      if (!remoteById) {
        blockers.push({
          type: "configured-resource-missing",
          key: resource.key,
          kind: resource.kind,
          name: resource.name,
          manifestId: resource.manifestId,
        });
        resources.push(resourceState(resource, "blocked", remoteId));
        continue;
      }
      const remoteName = String(remoteById[definition.nameField] ?? "");
      if (remoteName !== resource.name) {
        blockers.push({
          type: "configured-resource-name-mismatch",
          key: resource.key,
          kind: resource.kind,
          expectedName: resource.name,
          remoteName,
          manifestId: resource.manifestId,
        });
        resources.push(resourceState(resource, "blocked", resource.manifestId));
        continue;
      }
      if (remoteByName && remoteId !== resource.manifestId) {
        blockers.push({
          type: "configured-resource-id-mismatch",
          key: resource.key,
          kind: resource.kind,
          name: resource.name,
          manifestId: resource.manifestId,
          remoteId,
        });
        resources.push(resourceState(resource, "blocked", remoteId));
        continue;
      }
      resources.push(resourceState(resource, "reused", resource.manifestId));
      continue;
    }
    if (remoteByName) {
      if (resource.idPath && remoteId) {
        const operation = operationFor("adopt", resource, remoteId);
        operations.push(operation);
        resources.push(resourceState(resource, "adopt", remoteId));
      } else {
        resources.push(resourceState(resource, "reused", remoteId));
      }
      continue;
    }
    const operation = operationFor("create", resource, null);
    operations.push(operation);
    resources.push(resourceState(resource, "create", null));
  }
  const plan = {
    schemaVersion: 1,
    mode: freshSupportInstall
      ? "remote-read-only-fresh-support"
      : "remote-read-only",
    target: target.target,
    resourceIdentity: resourceIdentity(target),
    accountAlias: target.accountAlias,
    accountFingerprint: accountFingerprint(accountId),
    environment,
    ready: operations.length === 0 && blockers.length === 0,
    applicable: blockers.length === 0,
    resources,
    operations,
    blockers,
  };
  return { ...plan, confirmation: cloudflareBootstrapConfirmation(plan) };
}

function isFreshSupportResource(resource) {
  return (
    resource.key === "moduleD1.support" ||
    resource.key === "moduleR2.support" ||
    resource.key === "moduleVectorize.supportKnowledge" ||
    resource.key.startsWith("moduleQueues.support.") ||
    resource.key.startsWith("moduleQueues.supportAi.") ||
    resource.key.startsWith("moduleQueues.supportBulk.")
  );
}

export function cloudflareBootstrapConfirmation(plan) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: plan.schemaVersion,
        target: plan.target,
        accountAlias: plan.accountAlias,
        accountFingerprint: plan.accountFingerprint,
        environment: plan.environment,
        operations: plan.operations,
        blockers: plan.blockers,
      }),
    )
    .digest("hex")
    .slice(0, 12);
  return `CLOUDFLARE:BOOTSTRAP:${plan.target}:${plan.environment}:${digest}`;
}

export async function applyCloudflareBootstrapPlan(
  plan,
  target,
  { confirm, create },
) {
  const expected = cloudflareBootstrapConfirmation(plan);
  if (confirm !== expected) {
    throw new Error(
      `Refusing Cloudflare bootstrap: pass --confirm ${expected}`,
    );
  }
  if (plan.blockers.length > 0) {
    throw new Error(
      "Refusing Cloudflare bootstrap while drift blockers remain",
    );
  }
  if (typeof create !== "function") {
    throw new Error("Cloudflare bootstrap create adapter is required");
  }
  const resources = target.environments[plan.environment];
  const applied = [];
  for (const operation of plan.operations) {
    let remoteId = operation.remoteId;
    if (operation.type === "create") {
      const created = await create(operation);
      remoteId = operation.idField
        ? String(created?.[operation.idField] ?? "") || null
        : null;
      if (operation.idPath && !remoteId) {
        throw new Error(
          `Cloudflare did not return an id for ${operation.kind} ${operation.name}`,
        );
      }
    }
    if (operation.idPath) {
      setPath(resources, operation.idPath, remoteId);
    }
    applied.push({
      type: operation.type,
      key: operation.key,
      kind: operation.kind,
      name: operation.name,
      idRecorded: Boolean(operation.idPath && remoteId),
    });
  }
  return applied;
}

export function cloudflareResourceKind(kind) {
  const definition = KIND[kind];
  if (!definition)
    throw new Error(`Unsupported Cloudflare resource kind ${kind}`);
  return definition;
}

function idResource(key, kind, label, resource, idPath) {
  if (!resource?.name) throw new Error(`${key} must declare a resource name`);
  return {
    key,
    kind,
    label,
    name: resource.name,
    manifestId: resource.id ?? null,
    legacyName: resource.legacyName === true,
    idPath,
  };
}

function namedResource(key, kind, label, resource) {
  if (!resource?.name) throw new Error(`${key} must declare a resource name`);
  return {
    key,
    kind,
    label,
    name: resource.name,
    manifestId: null,
    legacyName: resource.legacyName === true,
    idPath: null,
  };
}

function vectorizeResource(key, label, resource) {
  if (!resource?.name) throw new Error(`${key} must declare a resource name`);
  return {
    key,
    kind: "vectorize",
    label,
    name: resource.name,
    configuration: {
      dimensions: resource.dimensions,
      metric: resource.metric,
      ...(resource.description ? { description: resource.description } : {}),
    },
    manifestId: null,
    legacyName: resource.legacyName === true,
    idPath: null,
  };
}

function operationFor(type, resource, remoteId) {
  const definition = KIND[resource.kind];
  return {
    type,
    key: resource.key,
    kind: resource.kind,
    label: resource.label,
    name: resource.name,
    logicalName: resource.logicalName,
    physicalName: resource.physicalName,
    previousNames: resource.previousNames,
    migrationStrategy: resource.migrationStrategy,
    remoteId,
    idPath: resource.idPath,
    endpoint: definition.endpoint,
    idField: definition.idField,
    body: definition.createBody(resource),
  };
}

function sameVectorizeConfiguration(expected, actual) {
  return (
    Number(actual?.dimensions) === expected.dimensions &&
    String(actual?.metric ?? "") === expected.metric
  );
}

function resourceState(resource, state, remoteId) {
  return {
    key: resource.key,
    kind: resource.kind,
    label: resource.label,
    name: resource.name,
    logicalName: resource.logicalName,
    physicalName: resource.physicalName,
    previousNames: resource.previousNames,
    migrationStrategy: resource.migrationStrategy,
    ...(resource.configuration
      ? { configuration: { ...resource.configuration } }
      : {}),
    state,
    manifestIdConfigured: Boolean(resource.manifestId),
    remoteId: remoteId ?? null,
  };
}

function assertUniqueDesiredResources(resources) {
  const keys = new Set();
  const namesByKind = new Set();
  for (const resource of resources) {
    if (keys.has(resource.key)) {
      throw new Error(`Duplicate Cloudflare resource key ${resource.key}`);
    }
    keys.add(resource.key);
    const identity = `${resource.kind}:${resource.name}`;
    if (namesByKind.has(identity)) {
      throw new Error(`Duplicate desired Cloudflare resource ${identity}`);
    }
    namesByKind.add(identity);
  }
}

function accountFingerprint(accountId) {
  if (!/^[a-f0-9]{32}$/iu.test(String(accountId ?? ""))) {
    throw new Error(
      "A valid Cloudflare account id is required for a remote plan",
    );
  }
  return createHash("sha256").update(accountId).digest("hex").slice(0, 12);
}

function setPath(root, path, value) {
  let current = root;
  for (const segment of path.slice(0, -1)) {
    current = current[segment];
  }
  current[path.at(-1)] = value;
}
