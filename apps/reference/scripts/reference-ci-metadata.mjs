import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv from "ajv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function githubRepositorySlug(value, field = "repository") {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new Error(`${field} must be a canonical GitHub HTTPS URL.`);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be a canonical GitHub HTTPS URL.`);
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    segments.length !== 2 ||
    !segments.every((segment) => /^[A-Za-z0-9_.-]+$/.test(segment))
  ) {
    throw new Error(`${field} must be a canonical GitHub HTTPS URL.`);
  }
  return segments.join("/");
}

export function buildReferenceCiMetadata(project) {
  const deploymentBranch = project?.deployment?.branch;
  if (!/^[A-Za-z0-9._/-]+$/.test(deploymentBranch ?? "")) {
    throw new Error("deployment.branch is not safe for GitHub Actions output.");
  }
  return {
    platform_repository: githubRepositorySlug(
      project?.platformRepository,
      "platformRepository",
    ),
    deployment_branch: deploymentBranch,
  };
}

async function run() {
  if (process.argv.length !== 2) {
    throw new Error("reference-ci-metadata.mjs accepts no arguments.");
  }
  const project = JSON.parse(
    await readFile(path.join(root, "reference.project.json"), "utf8"),
  );
  const schema = JSON.parse(
    await readFile(
      path.join(root, "schemas", "reference-project.schema.json"),
      "utf8",
    ),
  );
  const validate = new Ajv({ allErrors: true }).compile(schema);
  if (!validate(project)) {
    throw new Error(
      `Invalid reference.project.json: ${JSON.stringify(validate.errors)}`,
    );
  }
  const metadata = buildReferenceCiMetadata(project);
  for (const [name, value] of Object.entries(metadata)) {
    process.stdout.write(`${name}=${value}\n`);
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
