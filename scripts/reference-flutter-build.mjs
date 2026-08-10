import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertCoordinatedReferenceConfig,
  assertDevelopmentDartDefineContract,
} from "./reference-config-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const revisionPattern = /^[0-9a-f]{40}$/;

export function buildFlutterDefines(
  base,
  environment = {},
  { live = false } = {},
) {
  assertDevelopmentDartDefineContract(base);
  const defines = Object.fromEntries(
    Object.entries(base).map(([name, value]) => [name, String(value ?? "")]),
  );
  defines.OPENGROW_LIVE_MODE = live ? "true" : "false";
  defines.OPENGROW_PLATFORM_REVISION = revision(
    environment.OPENGROW_PLATFORM_REVISION,
    "OPENGROW_PLATFORM_REVISION",
    live,
  );
  defines.OPENGROW_REFERENCE_REVISION = revision(
    environment.OPENGROW_REFERENCE_REVISION,
    "OPENGROW_REFERENCE_REVISION",
    live,
  );

  if (!live) {
    defines.OPENGROW_PROJECT_KEY = "";
    defines.OPENGROW_PROJECT_ID = "0";
    return defines;
  }

  const projectKey = boundedBuildValue(
    environment.OPENGROW_PROJECT_KEY,
    "OPENGROW_PROJECT_KEY",
    512,
  );
  const projectId = boundedBuildValue(
    environment.OPENGROW_PROJECT_ID,
    "OPENGROW_PROJECT_ID",
    20,
  );
  if (!/^\d+$/.test(projectId) || Number(projectId) <= 0) {
    throw new Error("OPENGROW_PROJECT_ID must be a positive integer.");
  }
  defines.OPENGROW_PROJECT_KEY = projectKey;
  defines.OPENGROW_PROJECT_ID = projectId;
  return defines;
}

function revision(value, name, required) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (revisionPattern.test(candidate)) return candidate;
  if (required)
    throw new Error(`${name} must be an exact 40-character Git SHA.`);
  return "local";
}

function boundedBuildValue(value, name, maximum) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (
    !candidate ||
    candidate.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    throw new Error(`${name} is missing or invalid.`);
  }
  return candidate;
}

async function run() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((value) => value !== "--live") || arguments_.length > 1) {
    throw new Error("Usage: node scripts/reference-flutter-build.mjs [--live]");
  }
  const live = arguments_.includes("--live");
  const [baseSource, projectSource] = await Promise.all([
    readFile(path.join(root, "config", "development.json"), "utf8"),
    readFile(path.join(root, "reference.project.json"), "utf8"),
  ]);
  const base = JSON.parse(baseSource);
  const project = JSON.parse(projectSource);
  assertCoordinatedReferenceConfig(project, base);
  const defines = buildFlutterDefines(base, process.env, { live });
  const temporaryDirectory = path.join(root, ".dart_tool");
  const temporaryPath = path.join(
    temporaryDirectory,
    `superboard-reference-build-${process.pid}.json`,
  );
  await mkdir(temporaryDirectory, { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(defines, null, 2)}\n`, {
    mode: 0o600,
  });
  try {
    const flutterEnvironment = { ...process.env };
    delete flutterEnvironment.OPENGROW_PROJECT_KEY;
    delete flutterEnvironment.OPENGROW_PROJECT_ID;
    const result = spawnSync(
      "flutter",
      ["build", "web", `--dart-define-from-file=${temporaryPath}`],
      { cwd: root, env: flutterEnvironment, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `Flutter web build failed with exit code ${result.status}.`,
      );
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  run().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
