const CUSTOM_RESERVED_VARS = new Set([
  "APP_KEY",
  "ENVIRONMENT",
  "CUSTOM_WORKER_CAPABILITIES",
  "FILES_INPUT_ORIGIN",
]);
const SENSITIVE_VAR_NAME =
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|ACCESS_KEY)$/;
const MANAGED_RESERVED_VARS = new Set([
  "SUPERBOARD_TARGET",
  "OPENGROW_TARGET",
  "ENVIRONMENT",
  "GATEWAY_URL",
  "FILES_INPUT_ORIGIN",
  "FILES_INPUT_MAX_BYTES",
  "OUTPUT_FILE_ORIGIN",
  "R2_ENDPOINT_URL",
  "R2_BUCKET_NAME",
  "WATERMARK_URL",
]);

export function dashboardCacheResourceName(baseResourceName) {
  const base = nonEmpty(baseResourceName, "base resource name");
  return `${base}-dashboard-cache`;
}

export function customTargetOptions(
  args,
  { target, environment, baseResourceName },
) {
  const source = optional(args["custom-source"]);
  const customOptionNames = [
    "custom-package",
    "custom-description",
    "custom-capabilities",
    "custom-secrets",
    "custom-vars-json",
    "custom-crons-json",
    "custom-d1-binding",
    "custom-d1-name",
    "custom-migrations-dir",
    "custom-service-bindings-json",
  ];
  if (!source) {
    const unexpected = customOptionNames.find(
      (name) => args[name] !== undefined,
    );
    if (unexpected) {
      throw new Error(`--${unexpected} requires --custom-source`);
    }
    return null;
  }

  const d1Binding = optional(args["custom-d1-binding"]);
  const migrationsDir = optional(args["custom-migrations-dir"]);
  if (Boolean(d1Binding) !== Boolean(migrationsDir)) {
    throw new Error(
      "--custom-d1-binding and --custom-migrations-dir must be supplied together",
    );
  }
  if (args["custom-d1-name"] !== undefined && !d1Binding) {
    throw new Error("--custom-d1-name requires --custom-d1-binding");
  }

  const secrets = unique([
    "CUSTOM_WORKER_TOKEN",
    ...csv(args["custom-secrets"]),
  ]);
  const vars = stringMap(args["custom-vars-json"], "--custom-vars-json");
  for (const name of Object.keys(vars)) {
    if (CUSTOM_RESERVED_VARS.has(name)) {
      throw new Error(`${name} is generated and cannot be overridden`);
    }
    if (secrets.includes(name)) {
      throw new Error(`${name} cannot be both a custom var and secret`);
    }
    if (SENSITIVE_VAR_NAME.test(name)) {
      throw new Error(`${name} looks sensitive and must be a custom secret`);
    }
  }
  const crons = stringArray(args["custom-crons-json"], "--custom-crons-json");
  const serviceBindings = objectArray(
    args["custom-service-bindings-json"],
    "--custom-service-bindings-json",
  );

  const worker = {
    source,
    packagePath:
      optional(args["custom-package"]) ||
      source.replace(/\/src\/index\.ts$/, ""),
    description:
      optional(args["custom-description"]) ||
      `${nonEmpty(target, "target")} app-specific SuperBoard extension`,
    capabilities: csv(args["custom-capabilities"]),
    secrets,
    ...(Object.keys(vars).length ? { vars } : {}),
    ...(crons.length ? { crons } : {}),
    ...(d1Binding ? { d1Binding: { binding: d1Binding, migrationsDir } } : {}),
    ...(serviceBindings.length ? { serviceBindings } : {}),
  };
  const environmentResources = d1Binding
    ? {
        customD1: {
          name:
            optional(args["custom-d1-name"]) ||
            `${nonEmpty(baseResourceName, "base resource name")}-custom-db`,
          id: null,
        },
      }
    : {};

  nonEmpty(environment, "environment");
  return { worker, environmentResources };
}

export function validateCustomWorkerBindings(customWorker) {
  if (!customWorker) return;
  const bindings = [
    ...[...CUSTOM_RESERVED_VARS].map((name) => [name, "generated var"]),
    ...Object.keys(customWorker.vars ?? {}).map((name) => [name, "custom var"]),
    ...(customWorker.secrets ?? []).map((name) => [name, "secret"]),
    ...(customWorker.d1Binding ? [[customWorker.d1Binding.binding, "D1"]] : []),
    ...(customWorker.serviceBindings ?? []).map(({ binding }) => [
      binding,
      "service",
    ]),
  ];
  const occupied = new Map();
  for (const [name, owner] of bindings) {
    const existing = occupied.get(name);
    if (existing) {
      throw new Error(
        `Invalid target manifest: custom Worker binding ${name} is declared as both ${existing} and ${owner}`,
      );
    }
    occupied.set(name, owner);
  }
  for (const name of Object.keys(customWorker.vars ?? {})) {
    if (SENSITIVE_VAR_NAME.test(name)) {
      throw new Error(
        `Invalid target manifest: customWorker.vars.${name} looks sensitive and must be declared as a secret`,
      );
    }
  }
  validateManagedWorkers(customWorker);
}

export function validateManagedWorkers(customWorker) {
  const workers = customWorker?.managedWorkers ?? [];
  const ids = new Set();
  const packages = new Set();
  for (const worker of workers) {
    if (ids.has(worker.id)) {
      throw new Error(
        `Invalid target manifest: duplicate managed Worker id ${worker.id}`,
      );
    }
    ids.add(worker.id);
    if (packages.has(worker.packagePath)) {
      throw new Error(
        `Invalid target manifest: managed Worker package ${worker.packagePath} has multiple owners`,
      );
    }
    packages.add(worker.packagePath);
    if (worker.source !== `${worker.packagePath}/src/index.ts`) {
      throw new Error(
        `Invalid target manifest: managed Worker ${worker.id} source must belong to its package`,
      );
    }
    const dockerfiles = new Set(
      worker.containers.map(({ dockerfile }) => dockerfile),
    );
    for (const dockerfile of dockerfiles) {
      if (!dockerfile.startsWith(`${worker.packagePath}/container/`)) {
        throw new Error(
          `Invalid target manifest: managed Worker ${worker.id} Dockerfile must belong to its package`,
        );
      }
    }
    const bindings = [
      ...[...MANAGED_RESERVED_VARS].map((name) => [name, "generated var"]),
      ...worker.containers.map(({ binding }) => [
        `${binding}_MAX_INSTANCES`,
        "generated var",
      ]),
      ...Object.keys(worker.vars ?? {}).map((name) => [name, "managed var"]),
      ...worker.secrets.map((name) => [name, "secret"]),
      [worker.d1Binding, "D1"],
      [worker.workflow.binding, "Workflow"],
      ...worker.containers.map(({ binding }) => [binding, "Container"]),
      ...worker.durableObjects.map(({ binding }) => [
        binding,
        "Durable Object",
      ]),
    ];
    const occupied = new Map();
    for (const [name, owner] of bindings) {
      const existing = occupied.get(name);
      if (existing) {
        throw new Error(
          `Invalid target manifest: managed Worker ${worker.id} binding ${name} is declared as both ${existing} and ${owner}`,
        );
      }
      occupied.set(name, owner);
    }
    for (const name of Object.keys(worker.vars ?? {})) {
      if (SENSITIVE_VAR_NAME.test(name)) {
        throw new Error(
          `Invalid target manifest: managed Worker ${worker.id} var ${name} looks sensitive and must be declared as a secret`,
        );
      }
    }
    const expectedClasses = new Set([
      ...worker.containers.map(({ className }) => className),
      ...worker.durableObjects.map(({ className }) => className),
    ]);
    const migratedClasses = new Set(
      worker.migrations.flatMap((migration) => [
        ...(migration.newClasses ?? []),
        ...(migration.newSqliteClasses ?? []),
      ]),
    );
    if (
      expectedClasses.size !== migratedClasses.size ||
      [...expectedClasses].some((className) => !migratedClasses.has(className))
    ) {
      throw new Error(
        `Invalid target manifest: managed Worker ${worker.id} migrations must declare every local Durable Object class exactly once`,
      );
    }
  }
}

function parseJson(value, label) {
  if (value === undefined || value === null || value === "") return undefined;
  const source = String(value);
  if (source.length > 20_000) throw new Error(`${label} is too large`);
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function stringMap(value, label) {
  const parsed = parseJson(value, label);
  if (parsed === undefined) return {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object of string values`);
  }
  const result = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (!/^[A-Z][A-Z0-9_]+$/.test(key) || typeof entry !== "string") {
      throw new Error(
        `${label} must contain uppercase names and string values`,
      );
    }
    result[key] = entry;
  }
  return result;
}

function stringArray(value, label) {
  const parsed = parseJson(value, label);
  if (parsed === undefined) return [];
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    throw new Error(`${label} must be a JSON array of non-empty strings`);
  }
  return unique(parsed.map((entry) => entry.trim()));
}

function objectArray(value, label) {
  const parsed = parseJson(value, label);
  if (parsed === undefined) return [];
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (entry) => !entry || typeof entry !== "object" || Array.isArray(entry),
    )
  ) {
    throw new Error(`${label} must be a JSON array of objects`);
  }
  return parsed;
}

function csv(value) {
  return unique(
    String(value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function unique(values) {
  return [...new Set(values)];
}

function optional(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nonEmpty(value, label) {
  const result = optional(value);
  if (!result) throw new Error(`${label} is required`);
  return result;
}
