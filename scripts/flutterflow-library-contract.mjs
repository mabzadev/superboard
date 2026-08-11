#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultManifestPath = resolve(root, "config/flutterflow-library.json");
const defaultCatalogPath = resolve(root, "config/sdk-libraries.json");
const defaultControlPlanePath = resolve(root, "config/github-control-plane.json");

export async function validateFlutterFlowLibraryContract({
  manifestPath = defaultManifestPath,
  catalogPath = defaultCatalogPath,
  controlPlanePath = defaultControlPlanePath,
  schemaPath = resolve(root, "schemas/flutterflow-library.schema.json"),
  sourceOverride = null,
} = {}) {
  const [manifest, catalog, controlPlane, schema] = await Promise.all([
    readJson(manifestPath),
    readJson(catalogPath),
    readJson(controlPlanePath),
    readJson(schemaPath),
  ]);
  const errors = [];
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    schema,
  );
  if (!validate(manifest)) {
    errors.push(
      ...(validate.errors || []).map(
        ({ instancePath, message }) =>
          `${instancePath || "/"} ${message || "is invalid"}`,
      ),
    );
    return result(errors, manifest);
  }

  const sourcePath = repositoryPath(manifest.source.path, errors);
  const testPath = repositoryPath(manifest.source.testPath, errors);
  const workflowPath = repositoryPath(manifest.source.workflow, errors);
  const [source, testSource, workflow] = await Promise.all([
    sourceOverride ?? readRequired(sourcePath, "library DSL", errors),
    readRequired(testPath, "library DSL test", errors),
    readRequired(workflowPath, "library sync workflow", errors),
  ]);

  validateDependencies({ manifest, catalog, source, errors });
  validateActions({ manifest, source, errors });
  validateWidgets({ manifest, source, errors });
  validatePages({ manifest, source, errors });
  validateLibraryValues({ manifest, source, errors });
  validateSecretState({ manifest, source, testSource, errors });
  validateWorkflow({ manifest, workflow, errors });
  validateGitHubEnvironment({ manifest, controlPlane, errors });

  return result(errors, manifest);
}

function validateWidgets({ manifest, source, errors }) {
  const declared = unique(
    [...source.matchAll(/app\.customWidget\(\s*['"]([^'"]+)/g)].map(
      (match) => match[1],
    ),
    "DSL custom widget",
    errors,
  );
  const expected = unique(manifest.widgets, "manifest custom widget", errors);
  exactSet(expected, declared, "custom widget", errors);
}

function validatePages({ manifest, source, errors }) {
  const declared = unique(
    [...source.matchAll(/app\.ensurePage\(\s*['"]([^'"]+)/g)].map(
      (match) => match[1],
    ),
    "DSL library page",
    errors,
  );
  const expected = unique(manifest.pages, "manifest library page", errors);
  exactSet(expected, declared, "library page", errors);
}

function validateDependencies({ manifest, catalog, source, errors }) {
  const catalogById = new Map(
    (catalog.libraries || []).map((library) => [library.id, library]),
  );
  for (const dependency of manifest.dependencies) {
    const library = catalogById.get(dependency.catalogId);
    if (!library) {
      errors.push(`Unknown SDK catalogue entry ${dependency.catalogId}`);
      continue;
    }
    const packageName = library.candidatePackageName ?? library.packageName;
    const sourceVersion = library.candidatePackageName
      ? library.sourceVersion
      : library.latestReleaseVersion;
    const requiredRef = library.candidatePackageName
      ? candidateRef(library)
      : library.releaseRef;
    if (packageName !== dependency.packageName) {
      errors.push(`${dependency.catalogId} package name does not match catalogue`);
    }
    if (sourceVersion !== dependency.sourceVersion) {
      errors.push(
        `${dependency.catalogId} source version does not match catalogue candidate`,
      );
    }
    if (requiredRef !== dependency.requiredRef) {
      errors.push(
        `${dependency.catalogId} immutable ref does not match catalogue candidate`,
      );
    }
    if (!source.includes(`name: '${dependency.packageName}'`)) {
      errors.push(`${dependency.packageName} dependency is absent from the DSL`);
    }
    if (!source.includes(`ref: ${dependency.requiredRef}`)) {
      errors.push(`${dependency.packageName} does not use ${dependency.requiredRef}`);
    }
  }
  if (/git@|ssh:\/\//i.test(source)) {
    errors.push("FlutterFlow dependencies must use public HTTPS Git URLs");
  }
  if (/ref:\s*(?:main|dev)\s*$/m.test(source)) {
    errors.push("FlutterFlow dependencies must use immutable release refs");
  }
}

function candidateRef(library) {
  const prefix = library.id === "flutterflow"
    ? "sdk-flutterflow-v"
    : `sdk-${library.id}-v`;
  return `${prefix}${library.sourceVersion}`;
}

function validateActions({ manifest, source, errors }) {
  const declared = unique(
    [...source.matchAll(/app\.customAction\(\s*['\"]([^'\"]+)/g)].map(
      (match) => match[1],
    ),
    "DSL custom action",
    errors,
  );
  const expected = unique(
    Object.values(manifest.actions).flat(),
    "manifest custom action",
    errors,
  );
  exactSet(expected, declared, "custom action", errors);
}

function validateLibraryValues({ manifest, source, errors }) {
  const identifiers = new Map(
    [...source.matchAll(
      /final\s+(\w+Id)\s*=\s*FFIdentifier\(\s*name:\s*'([^']+)',\s*key:\s*'([^']+)'/g,
    )].map((match) => [match[1], { name: match[2], key: match[3] }]),
  );
  const configuredSymbols = [
    ...source.matchAll(/ensureLibraryParameter\(\s*project,\s*(\w+Id)/g),
  ].map((match) => match[1]);
  const configured = unique(
    configuredSymbols.map(
      (symbol) => identifiers.get(symbol)?.name || `<${symbol}>`,
    ),
    "DSL library value",
    errors,
  );
  const expected = unique(
    manifest.libraryValues.map(({ name }) => name),
    "manifest library value",
    errors,
  );
  exactSet(expected, configured, "library value", errors);
  for (const value of manifest.libraryValues) {
    const declared = [...identifiers.values()].find(
      ({ name }) => name === value.name,
    );
    if (declared && declared.key !== value.key) {
      errors.push(
        `library value ${value.name} key ${declared.key} does not match ${value.key}`,
      );
    }
  }
}

function validateSecretState({ manifest, source, testSource, errors }) {
  for (const name of manifest.forbiddenAppState) {
    if (source.includes(`app.state('${name}'`)) {
      errors.push(`${name} must not be created in FlutterFlow App State`);
    }
    if (!source.includes(`removeAppStateField(\n        project,\n        name: '${name}'`)) {
      errors.push(`${name} legacy App State removal is missing`);
    }
    if (!testSource.includes(`isNot(contains('${name}'))`)) {
      errors.push(`${name} absence is not asserted by the DSL test`);
    }
  }
}

function validateWorkflow({ manifest, workflow, errors }) {
  for (const value of [
    manifest.remoteProject.projectIdVariable,
    manifest.remoteProject.apiKeySecret,
    manifest.remoteProject.githubEnvironment,
    dirname(dirname(manifest.source.path)),
    "flutterflow ai test",
    "flutterflow ai run",
  ]) {
    if (!workflow.includes(value)) {
      errors.push(`Library sync workflow is missing ${value}`);
    }
  }
  const testIndex = workflow.indexOf("flutterflow ai test");
  const runIndex = workflow.indexOf("flutterflow ai run");
  if (testIndex >= 0 && runIndex >= 0 && testIndex > runIndex) {
    errors.push("Library sync workflow must test before pushing");
  }
}

function validateGitHubEnvironment({ manifest, controlPlane, errors }) {
  const environment =
    controlPlane.repositories?.platform?.environments?.[
      manifest.remoteProject.githubEnvironment
    ];
  if (!environment) {
    errors.push(
      `GitHub Environment ${manifest.remoteProject.githubEnvironment} is not declared`,
    );
    return;
  }
  const projectId = environment.variables?.[
    manifest.remoteProject.projectIdVariable
  ];
  if (!String(projectId || "").trim()) {
    errors.push(
      `GitHub variable ${manifest.remoteProject.projectIdVariable} is not configured`,
    );
  }
  if (!environment.secrets?.includes(manifest.remoteProject.apiKeySecret)) {
    errors.push(
      `GitHub secret ${manifest.remoteProject.apiKeySecret} is not declared`,
    );
  }
}

function exactSet(expected, observed, label, errors) {
  const expectedSet = new Set(expected);
  const observedSet = new Set(observed);
  for (const name of expectedSet) {
    if (!observedSet.has(name)) errors.push(`${label} ${name} is not implemented`);
  }
  for (const name of observedSet) {
    if (!expectedSet.has(name)) errors.push(`${label} ${name} is not declared`);
  }
}

function unique(values, label, errors) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) errors.push(`${label} ${value} is duplicated`);
    seen.add(value);
  }
  return [...seen];
}

function repositoryPath(value, errors) {
  const path = resolve(root, value);
  const child = relative(root, path);
  if (!child || child === ".." || child.startsWith(`..${sep}`)) {
    errors.push(`${value} must stay inside the repository`);
  }
  return path;
}

async function readRequired(path, label, errors) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    errors.push(`${label} is unavailable: ${error.message}`);
    return "";
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function result(errors, manifest) {
  return {
    schemaVersion: 1,
    status: errors.length === 0 ? "ok" : "blocked",
    displayName: manifest?.displayName || null,
    dependencies: manifest?.dependencies?.length || 0,
    libraryValues: manifest?.libraryValues?.length || 0,
    widgets: manifest?.widgets?.length || 0,
    pages: manifest?.pages?.length || 0,
    actions: Object.values(manifest?.actions || {}).flat().length,
    errors,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const validation = await validateFlutterFlowLibraryContract();
  process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
  if (validation.status !== "ok") process.exitCode = 1;
}
