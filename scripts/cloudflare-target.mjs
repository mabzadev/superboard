import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv from "ajv/dist/2020.js";
import { validateCustomWorkerBindings } from "./superboard-target-options.mjs";
import { DOMAIN_SERVICE_REGISTRY } from "./cloudflare-services.mjs";
import {
  assertTargetPhysicalResourceNames,
  resourceIdentity,
} from "./cloudflare-resource-identity.mjs";
import { superboardEnvironmentValue } from "./superboard-environment.mjs";

export const root = resolve(new URL("..", import.meta.url).pathname);

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      args[key] = argv[index + 1];
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export async function loadTarget(targetName) {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(targetName ?? "")) {
    throw new Error(
      "--target must contain only lowercase letters, numbers and hyphens",
    );
  }
  const path = resolve(root, "deploy", "targets", `${targetName}.json`);
  const target = JSON.parse(await readFile(path, "utf8"));
  await validateTarget(target);
  return { path, target };
}

export async function validateTarget(target) {
  const schemaPath = resolve(root, "deploy", "targets", "schema.json");
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  if (!validate(target)) {
    const details = validate.errors
      ?.map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    throw new Error(`Invalid target manifest: ${details}`);
  }
  const environments = Object.keys(target.environments ?? {});
  if (environments.length === 0) {
    throw new Error(
      "Invalid target manifest: at least one environment is required",
    );
  }
  resourceIdentity(target);
  const activeDomains = new Set(
    Object.values(target.domains ?? {}).map((hostname) =>
      String(hostname).toLowerCase(),
    ),
  );
  const zoneName = String(target.zoneName).toLowerCase();
  const apiDomain = String(target.domains?.api ?? "").toLowerCase();
  if (apiDomain !== zoneName && !apiDomain.endsWith(`.${zoneName}`)) {
    throw new Error(
      `Invalid target manifest: domains.api must belong to zoneName ${zoneName}`,
    );
  }
  const retiredDomains = new Set();
  for (const retired of target.retiredDomains ?? []) {
    const hostname = String(retired.hostname).toLowerCase();
    if (activeDomains.has(hostname)) {
      throw new Error(
        `Invalid target manifest: retired domain ${hostname} is still active`,
      );
    }
    if (retiredDomains.has(hostname)) {
      throw new Error(
        `Invalid target manifest: retired domain ${hostname} is declared more than once`,
      );
    }
    retiredDomains.add(hostname);
  }
  const requiredWorkers = [
    "api",
    "dashboard",
    "email",
    "identity",
    "files",
    "observability",
    "mcp",
    ...Object.entries(target.features ?? {})
      .filter(([, enabled]) => enabled)
      .map(([service]) => service),
  ];
  for (const service of requiredWorkers) {
    if (!target.workers?.[service]) {
      throw new Error(
        `Invalid target manifest: workers.${service} is required because the feature is enabled`,
      );
    }
  }
  for (const environment of environments) {
    assertTargetPhysicalResourceNames(target, environment);
    for (const [service, workerNames] of Object.entries(target.workers ?? {})) {
      if (!workerNames?.[environment]) {
        throw new Error(
          `Invalid target manifest: workers.${service}.${environment} is required when environments.${environment} exists`,
        );
      }
    }
    for (const [service, definition] of Object.entries(
      DOMAIN_SERVICE_REGISTRY,
    )) {
      if (!target.features?.[service]) continue;
      const resources = target.environments[environment];
      if (!resources.moduleD1?.[definition.resourceKey]) {
        throw new Error(
          `Invalid target manifest: environments.${environment}.moduleD1.${definition.resourceKey} is required because ${service} is enabled`,
        );
      }
      for (const resource of definition.r2) {
        if (!resources.moduleR2?.[resource.resourceKey]) {
          throw new Error(
            `Invalid target manifest: environments.${environment}.moduleR2.${resource.resourceKey} is required because ${service} is enabled`,
          );
        }
      }
      for (const queue of definition.queues) {
        if (!resources.moduleQueues?.[queue.resourceKey]) {
          throw new Error(
            `Invalid target manifest: environments.${environment}.moduleQueues.${queue.resourceKey} is required because ${service} is enabled`,
          );
        }
      }
      for (const vectorize of definition.vectorize) {
        if (!resources.moduleVectorize?.[vectorize.resourceKey]) {
          throw new Error(
            `Invalid target manifest: environments.${environment}.moduleVectorize.${vectorize.resourceKey} is required because ${service} is enabled`,
          );
        }
      }
    }
  }
  if (target.features?.flows && !target.features?.products) {
    throw new Error(
      "Invalid target manifest: Products must be enabled when Flows is enabled",
    );
  }
  if (Boolean(target.customWorker) !== Boolean(target.workers?.custom)) {
    throw new Error(
      "Invalid target manifest: customWorker and workers.custom must be declared together",
    );
  }
  for (const monitor of target.publicSurfaceMonitors ?? []) {
    const publicUrl = strictPublicHttpsUrl(monitor.url);
    const healthUrl = strictPublicHttpsUrl(monitor.healthUrl ?? monitor.url);
    if (!publicUrl || !healthUrl || publicUrl.origin !== healthUrl.origin) {
      throw new Error(
        `Invalid target manifest: public surface monitor ${monitor.id} requires credential-free public HTTPS URLs on one origin`,
      );
    }
  }
  if (target.features?.messaging) {
    if (!target.domains?.messaging || !target.workers?.messaging) {
      throw new Error(
        "Invalid target manifest: legacy Messaging requires its domain and Worker names",
      );
    }
    for (const environment of environments) {
      const resources = target.environments[environment];
      if (
        !resources.messagingD1 ||
        !resources.messagingR2 ||
        !Array.isArray(resources.messagingProjectIds) ||
        !resources.queues?.messaging ||
        !resources.queues?.messagingDlq
      ) {
        throw new Error(
          `Invalid target manifest: legacy Messaging resources are incomplete in ${environment}`,
        );
      }
    }
  }
  for (const environment of environments) {
    const resources = target.environments[environment];
    const enabledModuleQueueKeys = new Set(
      Object.entries(DOMAIN_SERVICE_REGISTRY)
        .filter(([service]) => target.features?.[service])
        .flatMap(([, definition]) =>
          definition.queues.map((queue) => queue.resourceKey),
        ),
    );
    const queueNames = [
      resources.queues.events,
      resources.queues.eventsDlq,
      resources.queues.push,
      resources.queues.pushDlq,
      resources.queues.maintenance,
      resources.queues.maintenanceDlq,
      resources.queues.email,
      resources.queues.emailDlq,
      ...(target.features.billing
        ? [resources.queues.billing, resources.queues.billingDlq]
        : []),
      ...(target.features.messaging
        ? [resources.queues.messaging, resources.queues.messagingDlq]
        : []),
      ...Object.entries(resources.moduleQueues ?? {})
        .filter(([moduleName]) => enabledModuleQueueKeys.has(moduleName))
        .flatMap(([, queue]) => [queue.name, queue.dlq]),
    ];
    if (new Set(queueNames).size !== queueNames.length) {
      throw new Error(
        `Invalid target manifest: enabled queue names must be unique in ${environment}`,
      );
    }
    if (target.features?.support) {
      const routing = resources.supportRouting;
      const expectedPattern = `${target.domains.api}/api/v1/support*`;
      const expectedWorker = target.workers.api[environment];
      if (
        routing.pattern !== expectedPattern ||
        routing.worker !== expectedWorker
      ) {
        throw new Error(
          `Invalid target manifest: environments.${environment}.supportRouting must route ${expectedPattern} to ${expectedWorker}`,
        );
      }
      if (
        routing.mode === "active" &&
        resources.publicRouting !== "active"
      ) {
        throw new Error(
          `Invalid target manifest: environments.${environment}.supportRouting cannot be active while publicRouting is staged`,
        );
      }
    }
  }
  if (target.customWorker) {
    validateCustomWorkerBindings(target.customWorker);
    const managedWorkers = target.customWorker.managedWorkers ?? [];
    const runtimeBridge = target.customWorker.runtimeBridge;
    if (managedWorkers.length > 0 && !runtimeBridge) {
      throw new Error(
        "Invalid target manifest: customWorker.runtimeBridge is required by managed Workers",
      );
    }
    if (
      runtimeBridge &&
      runtimeBridge.filesInputOrigin !== `https://${target.domains.files}`
    ) {
      throw new Error(
        "Invalid target manifest: runtimeBridge.filesInputOrigin must match the Files public target origin",
      );
    }
    for (const environment of environments) {
      if (
        target.customWorker.d1Binding &&
        !target.environments[environment].customD1
      ) {
        throw new Error(
          `Invalid target manifest: environments.${environment}.customD1 is required by customWorker.d1Binding`,
        );
      }
      for (const binding of target.customWorker.serviceBindings ?? []) {
        if (!binding.workers?.[environment]) {
          throw new Error(
            `Invalid target manifest: customWorker service binding ${binding.binding} needs a ${environment} Worker name`,
          );
        }
      }
      const declaredServiceNames = new Set(
        (target.customWorker.serviceBindings ?? []).map(
          (binding) => binding.workers[environment],
        ),
      );
      for (const component of target.customWorker.managedWorkers ?? []) {
        if (!target.environments[environment][component.r2Resource]) {
          throw new Error(
            `Invalid target manifest: managed Worker ${component.id} needs environments.${environment}.${component.r2Resource}`,
          );
        }
        if (!component.workers?.[environment]) {
          throw new Error(
            `Invalid target manifest: managed Worker ${component.id} needs a ${environment} Worker name`,
          );
        }
        if (!component.workflow.names?.[environment]) {
          throw new Error(
            `Invalid target manifest: managed Worker ${component.id} needs a ${environment} Workflow name`,
          );
        }
        if (!declaredServiceNames.has(component.workers[environment])) {
          throw new Error(
            `Invalid target manifest: managed Worker ${component.id} is not connected to the custom Worker in ${environment}`,
          );
        }
      }
    }
  }
  return target;
}

function strictPublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const unsafeHostname =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.startsWith("[") ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);
    return url.protocol === "https:" &&
      hostname &&
      !unsafeHostname &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443")
      ? url
      : null;
  } catch {
    return null;
  }
}

export function environmentFromArgs(args, env = process.env) {
  const environment =
    args.environment ??
    superboardEnvironmentValue("SUPERBOARD_ENVIRONMENT", env) ??
    "development";
  if (!new Set(["local", "development", "production"]).has(environment)) {
    throw new Error("--environment must be local, development or production");
  }
  return environment;
}

export function targetNameFromArgs(args, env = process.env) {
  const targetName = String(
    args.target ?? superboardEnvironmentValue("SUPERBOARD_TARGET", env) ?? "",
  ).trim();
  if (!targetName) {
    throw new Error(
      "--target or SUPERBOARD_TARGET (fallback OPENGROW_TARGET) is required",
    );
  }
  return targetName;
}

export async function targetSelectionFromArgs(
  args,
  env = process.env,
  { allowReference = false } = {},
) {
  if (args.reference) {
    if (!allowReference)
      throw new Error(
        "--reference is valid only for local/CI validation commands",
      );
    if (
      args.target ||
      args.environment ||
      superboardEnvironmentValue("SUPERBOARD_TARGET", env) ||
      superboardEnvironmentValue("SUPERBOARD_ENVIRONMENT", env)
    ) {
      throw new Error(
        "--reference cannot be combined with an operational target or environment",
      );
    }
    const project = JSON.parse(
      await readFile(resolve(root, "superboard.project.json"), "utf8"),
    );
    const targetName = String(project.development?.target || "").trim();
    if (!targetName)
      throw new Error(
        "superboard.project.json does not define development.target",
      );
    return { targetName, environment: "development", reference: true };
  }
  return {
    targetName: targetNameFromArgs(args, env),
    environment: environmentFromArgs(args, env),
    reference: false,
  };
}

export function cloudflareAccountEnvName(target) {
  const suffix = String(target.accountAlias || target.target || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  return suffix ? `CLOUDFLARE_ACCOUNT_ID_${suffix}` : "CLOUDFLARE_ACCOUNT_ID";
}

export function cloudflareAccountId(target, env = process.env, options = {}) {
  const scopedName = cloudflareAccountEnvName(target);
  const accountId = String(
    env[scopedName] || env.CLOUDFLARE_ACCOUNT_ID || "",
  ).trim();
  if (!accountId && options.required === false) return undefined;
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error(
      `${scopedName} (or CLOUDFLARE_ACCOUNT_ID) must contain the 32-character Cloudflare account id for ${target.target}`,
    );
  }
  return accountId;
}

export function cloudflareEnv(target, env = process.env) {
  const childEnv = { ...env };
  delete childEnv.WRANGLER_CI_OVERRIDE_NAME;
  return {
    ...childEnv,
    CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId(target, env),
  };
}

export function publicApiUrl(target) {
  return `https://${target.domains.api}`;
}

export function publicAuthUrl(target) {
  return `https://${target.domains.auth}`;
}

export function publicDashboardUrl(target) {
  return `https://${target.domains.dashboard}`;
}

export function publicMcpUrl(target) {
  return `https://${target.domains.mcp}`;
}

export function publicSdkUrl(target) {
  return `https://${target.domains.sdk}`;
}

export function publicShortlinkUrl(target) {
  return `https://${target.domains.shortlinks}`;
}
