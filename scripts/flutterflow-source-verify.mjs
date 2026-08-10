import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const snapshotSchema = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../schemas/flutterflow-source-snapshot.schema.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
);
const validateSnapshot = new Ajv2020({
  allErrors: true,
  strict: false,
}).compile(snapshotSchema);

export function verifyFlutterFlowSource({ manifestPath, sourcePath }) {
  if (!manifestPath) throw new Error("--manifest is required");
  if (!sourcePath) throw new Error("--source is required");

  const manifest = readJson(resolve(manifestPath), "snapshot manifest");
  if (!validateSnapshot(manifest)) {
    const details = (validateSnapshot.errors || [])
      .map(
        ({ instancePath, message: errorMessage }) =>
          `${instancePath || "/"} ${errorMessage}`,
      )
      .join("; ");
    throw new Error(`Invalid FlutterFlow snapshot manifest: ${details}`);
  }

  const sourceRoot = resolve(sourcePath);
  const lastRun = readSourceJson(sourceRoot, ".flutterflow/last_run.json");
  const generatedState = readSourceJson(
    sourceRoot,
    ".flutterflow/generated_code_state.json",
  );
  const sdkMeta = readSourceJson(
    sourceRoot,
    ".flutterflow/project_sdk_meta.json",
  );

  equal(lastRun.projectId, manifest.project?.id, "last run project id");
  equal(sdkMeta.projectId, manifest.project?.id, "SDK project id");
  equal(sdkMeta.projectName, manifest.project?.name, "SDK project name");
  equal(generatedState.projectId, manifest.project?.id, "generated project id");
  equal(lastRun.timestamp, manifest.export?.timestamp, "last run timestamp");
  equal(lastRun.commitId, manifest.export?.commitId, "FlutterFlow commit id");
  equal(
    lastRun.commitMessage,
    manifest.export?.commitMessage,
    "commit message",
  );
  equal(lastRun.success, manifest.export?.success, "last run success");
  equal(lastRun.pushed, manifest.export?.pushed, "last run pushed flag");
  equal(lastRun.dryRun, manifest.export?.dryRun, "last run dry-run flag");
  equal(
    sdkMeta.generatedAt,
    manifest.export?.generatedAt,
    "SDK generation time",
  );
  equal(
    generatedState.lastExportedAt,
    manifest.export?.lastExportedAt,
    "generated-code export time",
  );
  equal(
    sdkMeta.projectUpdatedAtMs,
    manifest.export?.projectUpdatedAtMs,
    "FlutterFlow project update timestamp",
  );
  equal(generatedState.status, "fresh", "generated-code state");

  const fingerprints = manifest.fingerprints;
  if (!fingerprints || typeof fingerprints !== "object") {
    throw new Error("Snapshot manifest has no fingerprints");
  }
  for (const [relativePath, expected] of Object.entries(fingerprints)) {
    const path = safeSourcePath(sourceRoot, relativePath);
    equal(sha256File(path), expected, `${relativePath} fingerprint`);
  }

  const generatedFiles = Object.values(sdkMeta.files || {});
  if (generatedFiles.length === 0) {
    throw new Error("FlutterFlow SDK metadata references no generated file");
  }
  for (const descriptor of generatedFiles) {
    if (
      !descriptor ||
      typeof descriptor.path !== "string" ||
      !isSha(descriptor.sha)
    ) {
      throw new Error(
        "FlutterFlow SDK metadata has an invalid file descriptor",
      );
    }
    const path = safeSourcePath(sourceRoot, descriptor.path);
    equal(
      sha256File(path),
      descriptor.sha,
      `${descriptor.path} generated hash`,
    );
  }

  const schemas = readSource(
    sourceRoot,
    "lib/flutterflow_project/schemas.dart",
  );
  const appState = readSource(
    sourceRoot,
    "lib/flutterflow_project/app_state.dart",
  );
  const apis = readSource(sourceRoot, "lib/flutterflow_project/apis.dart");
  const inventory = {
    pages: Object.keys(sdkMeta.files).filter((key) => key.startsWith("page:"))
      .length,
    components: Object.keys(sdkMeta.files).filter((key) =>
      key.startsWith("component:"),
    ).length,
    actionBlocks: stringArray(
      classBody(apis, "ActionBlocks"),
      "static const all = <String>[",
    ).length,
    appEventsReported: manifest.inventory?.appEventsReported,
    apiCallsReported: manifest.inventory?.apiCallsReported,
    customActions: stringArray(schemas, "static const actions = <String>[")
      .length,
    customFunctions: stringArray(schemas, "static const functions = <String>[")
      .length,
    customWidgets: stringArray(schemas, "static const widgets = <String>[")
      .length,
    dataStructs: countMatches(schemas, /static final ffai\.StructHandle\s+/gu),
    appStateFields: countMatches(
      appState,
      /= ffai\.ProjectAppStateFieldHandle\(/gu,
    ),
  };
  equal(inventory, manifest.inventory, "FlutterFlow inventory");

  const diagnostics = Array.isArray(lastRun.diagnostics)
    ? lastRun.diagnostics
    : [];
  const byCode = {};
  for (const diagnostic of diagnostics) {
    const code = String(diagnostic?.code || "unknown");
    byCode[code] = (byCode[code] || 0) + 1;
  }
  const diagnosticSummary = {
    total: diagnostics.length,
    validationErrors: (lastRun.tasks || []).reduce(
      (total, task) =>
        total +
        (Array.isArray(task.validationErrors)
          ? task.validationErrors.length
          : 0),
      0,
    ),
    byCode: Object.fromEntries(Object.entries(byCode).sort()),
  };
  equal(diagnosticSummary, manifest.diagnostics, "diagnostic inventory");

  const convergence = manifest.convergence
    ? evaluateFlutterFlowConvergence({
        sourceRoot,
        policy: manifest.convergence,
        diagnostics: diagnosticSummary,
      })
    : null;

  return {
    schemaVersion: 1,
    ready: convergence?.ready ?? true,
    snapshotVerified: true,
    application: manifest.application,
    project: manifest.project,
    export: manifest.export,
    inventory,
    diagnostics: diagnosticSummary,
    convergence,
    generatedFilesVerified: generatedFiles.length,
    note: "Only FlutterFlow metadata and generated files were read; environment files were not accessed.",
  };
}

export function flutterFlowSourceEnvironmentName(application) {
  const normalized = String(application || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, "_");
  if (!normalized) {
    throw new Error("FlutterFlow application cannot resolve a source variable");
  }
  return `SUPERBOARD_CLIENT_SOURCE_${normalized}`;
}

export function legacyFlutterFlowSourceEnvironmentName(application) {
  return flutterFlowSourceEnvironmentName(application).replace(
    /^SUPERBOARD_/u,
    "OPENGROW_",
  );
}

export function resolveFlutterFlowSourcePath({
  manifestPath,
  explicitSource,
  env = process.env,
}) {
  if (explicitSource) return explicitSource;
  if (!manifestPath) throw new Error("--manifest is required");
  const manifest = readJson(resolve(manifestPath), "snapshot manifest");
  const application = manifest?.application;
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(application || "")) {
    throw new Error(
      "FlutterFlow snapshot application cannot resolve a source variable",
    );
  }
  const environmentName = flutterFlowSourceEnvironmentName(application);
  const legacyEnvironmentName =
    legacyFlutterFlowSourceEnvironmentName(application);
  const sourcePath = String(
    env[environmentName] || env[legacyEnvironmentName] || "",
  ).trim();
  if (!sourcePath) {
    throw new Error(
      `--source or ${environmentName} is required (${legacyEnvironmentName} remains a migration alias)`,
    );
  }
  return sourcePath;
}

export function evaluateFlutterFlowConvergence({
  sourceRoot,
  policy,
  diagnostics,
}) {
  if (policy?.schemaVersion !== 1 || !Array.isArray(policy.checks)) {
    throw new Error("FlutterFlow convergence policy is invalid");
  }
  const ids = new Set();
  const checks = policy.checks.map((rule) => {
    if (!rule || typeof rule.id !== "string" || !rule.id.trim()) {
      throw new Error("FlutterFlow convergence check has no id");
    }
    if (ids.has(rule.id)) {
      throw new Error(`Duplicate FlutterFlow convergence check: ${rule.id}`);
    }
    ids.add(rule.id);
    if (
      rule.kind === "diagnostics-max" ||
      rule.kind === "validation-errors-max" ||
      rule.kind === "diagnostics-unwaived-max"
    ) {
      if (!Number.isSafeInteger(rule.maximum) || rule.maximum < 0) {
        throw new Error(`Invalid diagnostic maximum for ${rule.id}`);
      }
      if (rule.kind === "diagnostics-unwaived-max") {
        const allowedByCode = rule.allowedByCode;
        if (
          !allowedByCode ||
          typeof allowedByCode !== "object" ||
          Array.isArray(allowedByCode) ||
          Object.keys(allowedByCode).length === 0 ||
          Object.values(allowedByCode).some(
            (value) => !Number.isSafeInteger(value) || value < 0,
          )
        ) {
          throw new Error(`Invalid diagnostic allowance for ${rule.id}`);
        }
        const observedByCode = diagnostics?.byCode || {};
        const waivedByCode = Object.fromEntries(
          Object.entries(allowedByCode)
            .map(([code, allowance]) => [
              code,
              Math.min(Number(observedByCode[code] || 0), allowance),
            ])
            .filter(([, count]) => count > 0),
        );
        const waived = Object.values(waivedByCode).reduce(
          (total, count) => total + count,
          0,
        );
        const actual = Math.max(0, Number(diagnostics?.total || 0) - waived);
        return {
          id: rule.id,
          kind: rule.kind,
          ready: actual <= rule.maximum,
          actual,
          maximum: rule.maximum,
          observedByCode,
          allowedByCode,
          waivedByCode,
          files: [],
          missingPaths: [],
        };
      }
      const actual =
        rule.kind === "validation-errors-max"
          ? diagnostics?.validationErrors
          : diagnostics?.total;
      const ready = Number.isSafeInteger(actual) && actual <= rule.maximum;
      return {
        id: rule.id,
        kind: rule.kind,
        ready,
        actual,
        maximum: rule.maximum,
        files: [],
        missingPaths: [],
      };
    }
    if (
      !["literal-absent", "symbol-absent", "symbol-present"].includes(rule.kind)
    ) {
      throw new Error(
        `Unsupported FlutterFlow convergence check kind: ${rule.kind}`,
      );
    }
    if (typeof rule.value !== "string" || !rule.value) {
      throw new Error(`FlutterFlow convergence check ${rule.id} has no value`);
    }
    if (!Array.isArray(rule.paths) || rule.paths.length === 0) {
      throw new Error(`FlutterFlow convergence check ${rule.id} has no paths`);
    }
    const scanned = scanConvergencePaths(sourceRoot, rule.paths, rule.value, {
      symbol: rule.kind.startsWith("symbol-"),
    });
    const expectsAbsent = rule.kind.endsWith("-absent");
    const ready =
      scanned.missingPaths.length === 0 &&
      (expectsAbsent ? scanned.matches === 0 : scanned.matches > 0);
    return {
      id: rule.id,
      kind: rule.kind,
      ready,
      matches: scanned.matches,
      files: scanned.files,
      missingPaths: scanned.missingPaths,
    };
  });
  const blockers = checks.filter(({ ready }) => !ready).map(({ id }) => id);
  return {
    schemaVersion: 1,
    ready: blockers.length === 0,
    checks,
    blockers,
    note: "Only relative paths and match counts are reported; matched source values are never returned.",
  };
}

export function flutterFlowSourceEvidence({ sourceRoot, policy }) {
  if (policy?.schemaVersion !== 1 || !Array.isArray(policy.checks)) {
    throw new Error("FlutterFlow convergence policy is invalid");
  }
  const source = resolve(sourceRoot);
  const declaredPaths = [
    ...new Set(
      policy.checks.flatMap((rule) =>
        Array.isArray(rule.paths) ? rule.paths : [],
      ),
    ),
  ].sort();
  if (declaredPaths.length === 0) {
    throw new Error("FlutterFlow convergence policy contains no source path");
  }
  const evidence = new Map();
  for (const relativePath of declaredPaths) {
    const path = safeSourcePath(source, relativePath);
    let descriptor;
    try {
      descriptor = lstatSync(path);
    } catch {
      throw new Error(
        `FlutterFlow convergence path is missing: ${relativePath}`,
      );
    }
    const candidates = descriptor.isDirectory()
      ? convergenceFiles(path)
      : descriptor.isFile()
        ? [path]
        : [];
    if (candidates.length === 0) {
      throw new Error(
        `FlutterFlow convergence path has no source: ${relativePath}`,
      );
    }
    for (const candidate of candidates) {
      const relativePathToSource = relative(source, candidate);
      evidence.set(relativePathToSource, sha256File(candidate));
    }
  }
  const entries = [...evidence.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const sha256 = createHash("sha256")
    .update(entries.map(([path, hash]) => `${path}\0${hash}\n`).join(""))
    .digest("hex");
  return { files: entries.length, sha256 };
}

function scanConvergencePaths(sourceRoot, paths, needle, { symbol }) {
  const files = [];
  const missingPaths = [];
  let matches = 0;
  for (const relativePath of paths) {
    const path = safeSourcePath(sourceRoot, relativePath);
    let descriptor;
    try {
      descriptor = lstatSync(path);
    } catch {
      missingPaths.push(relativePath);
      continue;
    }
    const candidates = descriptor.isDirectory()
      ? convergenceFiles(path)
      : descriptor.isFile()
        ? [path]
        : [];
    for (const candidate of candidates) {
      const source = readFileSync(candidate, "utf8");
      const count = symbol
        ? countSymbol(source, needle)
        : countLiteral(source, needle);
      if (count === 0) continue;
      matches += count;
      files.push(relative(sourceRoot, candidate));
    }
  }
  return {
    matches,
    files: [...new Set(files)].sort().slice(0, 500),
    missingPaths: [...new Set(missingPaths)].sort(),
  };
}

function convergenceFiles(root) {
  const result = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (
          [
            ".dart_tool",
            ".git",
            ".flutterflow",
            "build",
            "node_modules",
          ].includes(entry.name)
        ) {
          continue;
        }
        pending.push(resolve(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const path = resolve(directory, entry.name);
      if (![".dart", ".json", ".yaml", ".yml"].includes(extname(path)))
        continue;
      if (lstatSync(path).size > 4 * 1024 * 1024) {
        throw new Error(
          `FlutterFlow convergence source is too large: ${relative(root, path)}`,
        );
      }
      result.push(path);
      if (result.length > 20_000) {
        throw new Error(
          "FlutterFlow convergence source contains too many files",
        );
      }
    }
  }
  return result.sort();
}

function countLiteral(source, needle) {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function countSymbol(source, symbol) {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(symbol, offset)) >= 0) {
    const before = offset === 0 ? "" : source[offset - 1];
    const after = source[offset + symbol.length] || "";
    if (!isIdentifierCharacter(before) && !isIdentifierCharacter(after))
      count += 1;
    offset += symbol.length;
  }
  return count;
}

function isIdentifierCharacter(value) {
  return /[A-Za-z0-9_]/u.test(value);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${message(error)}`);
  }
}

function readSourceJson(root, relativePath) {
  return readJson(safeSourcePath(root, relativePath), relativePath);
}

function readSource(root, relativePath) {
  return readFileSync(safeSourcePath(root, relativePath), "utf8");
}

function safeSourcePath(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath) {
    throw new Error("FlutterFlow metadata contains an invalid path");
  }
  const path = resolve(root, relativePath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(
      `FlutterFlow path escapes the selected source: ${relativePath}`,
    );
  }
  return path;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isSha(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function stringArray(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Generated source is missing ${marker}`);
  const end = source.indexOf("];", start);
  if (end < 0)
    throw new Error(`Generated source has an unterminated ${marker}`);
  return [
    ...source.slice(start + marker.length, end).matchAll(/"([^"]+)"/gu),
  ].map((match) => match[1]);
}

function classBody(source, className) {
  const marker = `abstract final class ${className}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Generated source is missing ${marker}`);
  const next = source.indexOf("\nabstract final class ", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

function countMatches(source, expression) {
  return [...source.matchAll(expression)].length;
}

function equal(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not match the reviewed snapshot`);
  }
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1] || null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const manifestPath = argument("manifest");
    const result = verifyFlutterFlowSource({
      manifestPath,
      sourcePath: resolveFlutterFlowSourcePath({
        manifestPath,
        explicitSource: argument("source"),
      }),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ready) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${message(error)}\n`);
    process.exitCode = 2;
  }
}
