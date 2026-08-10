#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

import { loadTarget } from "./cloudflare-target.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const registryPath = resolve(root, "config/flutterflow-applications.json");
const libraryPath = resolve(root, "config/flutterflow-library.json");
const controlPlanePath = resolve(root, "config/github-control-plane.json");
const outputPath = resolve(
  root,
  "config/flutterflow-application-bindings.json",
);
const registrySchemaPath = resolve(
  root,
  "schemas/flutterflow-applications.schema.json",
);
const outputSchemaPath = resolve(
  root,
  "schemas/flutterflow-application-bindings.schema.json",
);

export async function resolveFlutterFlowApplications({
  registry = null,
  library = null,
  controlPlane = null,
  loadApplicationTarget = async (name) => (await loadTarget(name)).target,
} = {}) {
  const [resolvedRegistry, resolvedLibrary, resolvedControlPlane] =
    await Promise.all([
      registry ?? readJson(registryPath),
      library ?? readJson(libraryPath),
      controlPlane ?? readJson(controlPlanePath),
    ]);
  await validateSchema(
    resolvedRegistry,
    registrySchemaPath,
    "FlutterFlow application registry",
  );

  const ids = new Set();
  const environments = new Set();
  const applications = [];
  for (const application of resolvedRegistry.applications) {
    if (ids.has(application.id)) {
      throw new Error(`Duplicate FlutterFlow application ${application.id}`);
    }
    ids.add(application.id);
    if (environments.has(application.remoteProject.githubEnvironment)) {
      throw new Error(
        `GitHub Environment ${application.remoteProject.githubEnvironment} is shared by multiple FlutterFlow applications`,
      );
    }
    environments.add(application.remoteProject.githubEnvironment);

    const target = await loadApplicationTarget(application.target);
    applications.push(
      await resolveFlutterFlowApplication({
        application,
        target,
        library: resolvedLibrary,
        controlPlane: resolvedControlPlane,
      }),
    );
  }

  const output = {
    $schema: "../schemas/flutterflow-application-bindings.schema.json",
    schemaVersion: 2,
    owner: "superboard-platform",
    generatedFrom: "config/flutterflow-applications.json",
    applications,
  };
  await validateSchema(
    output,
    outputSchemaPath,
    "resolved FlutterFlow application bindings",
  );
  return output;
}

export async function resolveFlutterFlowApplication({
  application,
  target,
  library,
  controlPlane,
}) {
  const environment = target.environments?.[application.environment];
  if (!environment) {
    throw new Error(
      `${application.id} target ${target.target} has no ${application.environment} environment`,
    );
  }
  if (target.target !== application.target) {
    throw new Error(`${application.id} target identity does not match`);
  }
  if (
    target.productionCutover?.application &&
    target.productionCutover.application !== application.id
  ) {
    throw new Error(
      `${application.id} production cutover belongs to another app`,
    );
  }
  if (!target.features?.support) {
    throw new Error(`${application.id} requires the common Support feature`);
  }
  if (
    !environment.supportProjectIds?.includes(
      application.client.supportProjectId,
    )
  ) {
    throw new Error(
      `${application.id} Support project ${application.client.supportProjectId} is not allowlisted`,
    );
  }
  if (
    !target.applicationIdentity?.appleAudiences?.includes(
      application.client.applicationIdentifier,
    )
  ) {
    throw new Error(
      `${application.id} identifier is not an application Identity audience`,
    );
  }

  const githubEnvironment =
    controlPlane.repositories?.platform?.environments?.[
      application.remoteProject.githubEnvironment
    ];
  if (!githubEnvironment) {
    throw new Error(
      `${application.id} GitHub Environment ${application.remoteProject.githubEnvironment} is missing`,
    );
  }
  for (const variable of [
    application.remoteProject.projectIdVariable,
    application.libraryProjectIdVariable,
  ]) {
    if (!String(githubEnvironment.variables?.[variable] || "").trim()) {
      throw new Error(
        `${application.id} GitHub variable ${variable} is missing`,
      );
    }
  }
  if (
    !githubEnvironment.secrets?.includes(application.remoteProject.apiKeySecret)
  ) {
    throw new Error(
      `${application.id} GitHub secret ${application.remoteProject.apiKeySecret} is missing`,
    );
  }
  if (
    !githubEnvironment.secrets?.includes(application.client.projectKeySecret)
  ) {
    throw new Error(
      `${application.id} GitHub secret ${application.client.projectKeySecret} is missing`,
    );
  }

  await Promise.all([
    requireRepositoryFile(application.sourceSnapshot),
    requireRepositoryFile(application.migrationPlan),
  ]);
  const [snapshot, migration] = await Promise.all([
    readJson(resolve(root, application.sourceSnapshot)),
    readJson(resolve(root, application.migrationPlan)),
  ]);
  if (snapshot.application !== application.id) {
    throw new Error(
      `${application.id} source snapshot identity does not match`,
    );
  }
  if (
    migration.application !== application.id ||
    migration.target !== application.target ||
    migration.environment !== application.environment ||
    migration.snapshotManifest !== application.sourceSnapshot
  ) {
    throw new Error(`${application.id} migration plan identity does not match`);
  }

  const values = {
    projectKey: {
      source: "github-environment-secret",
      name: application.client.projectKeySecret,
    },
    uriScheme: application.client.uriScheme,
    useTestEnvironment: application.environment !== "production",
    sdkBaseUrl: httpsOrigin(target.domains.sdk),
    authGatewayBaseUrl: httpsOrigin(target.domains.api),
    filesBaseUrl: httpsOrigin(target.domains.files),
    applicationIdentifier: application.client.applicationIdentifier,
    applicationEnvironment: application.environment,
    supportBaseUrl: `${httpsOrigin(target.domains.api)}/api/v1/support-client`,
    supportProjectId: application.client.supportProjectId,
    shortLinkHost: target.domains.shortlinks,
  };
  const declaredValues = library.libraryValues.map(({ name }) => name).sort();
  const resolvedValues = Object.keys(values).sort();
  if (canonical(declaredValues) !== canonical(resolvedValues)) {
    throw new Error(
      `${application.id} bindings do not cover the exact SuperBoard Library Values`,
    );
  }

  return {
    id: application.id,
    displayName: application.displayName,
    target: application.target,
    environment: application.environment,
    sourceSnapshot: application.sourceSnapshot,
    migrationPlan: application.migrationPlan,
    remoteProject: {
      githubEnvironment: application.remoteProject.githubEnvironment,
      projectIdVariable: application.remoteProject.projectIdVariable,
      apiKeySecret: application.remoteProject.apiKeySecret,
      libraryProjectIdVariable: application.libraryProjectIdVariable,
    },
    library: {
      displayName: library.displayName,
      dependencies: library.dependencies.map(
        ({ catalogId, packageName, sourceVersion, requiredRef }) => ({
          catalogId,
          packageName,
          sourceVersion,
          requiredRef,
        }),
      ),
      parameters: library.libraryValues.map(({ name, key, type }) => ({
        name,
        key,
        type,
      })),
    },
    values,
  };
}

function httpsOrigin(hostname) {
  if (!/^[a-z0-9.-]+$/u.test(hostname || "")) {
    throw new Error(`Invalid target hostname ${String(hostname)}`);
  }
  return `https://${hostname}`;
}

async function requireRepositoryFile(value) {
  if (
    typeof value !== "string" ||
    value.startsWith("/") ||
    value.split(/[\\/]/u).includes("..")
  ) {
    throw new Error(`${String(value)} must stay inside the repository`);
  }
  await stat(resolve(root, value));
}

async function validateSchema(value, path, label) {
  const schema = await readJson(path);
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    schema,
  );
  if (!validate(value)) {
    const detail = (validate.errors || [])
      .map(({ instancePath, message }) => `${instancePath || "/"} ${message}`)
      .join("; ");
    throw new Error(`Invalid ${label}: ${detail}`);
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function canonical(value) {
  return JSON.stringify(value);
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1] || null;
}

async function main() {
  const output = await resolveFlutterFlowApplications();
  const applicationId = argument("application");
  const filtered = applicationId
    ? {
        ...output,
        applications: output.applications.filter(
          ({ id }) => id === applicationId,
        ),
      }
    : output;
  if (applicationId && filtered.applications.length !== 1) {
    throw new Error(`Unknown FlutterFlow application ${applicationId}`);
  }
  const serialized = `${JSON.stringify(filtered, null, 2)}\n`;
  if (process.argv.includes("--write")) {
    if (applicationId) throw new Error("--write cannot be application-scoped");
    await writeFile(outputPath, serialized, "utf8");
    process.stdout.write(`${outputPath}\n`);
    return;
  }
  if (process.argv.includes("--check")) {
    const current = await readFile(outputPath, "utf8");
    if (current !== serialized) {
      throw new Error(
        "config/flutterflow-application-bindings.json is stale; run npm run flutterflow-applications:generate",
      );
    }
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: 2, status: "ok", applications: output.applications.length }, null, 2)}\n`,
    );
    return;
  }
  process.stdout.write(serialized);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
