import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function validateSuperBoardBrand({ repositoryRoot = root } = {}) {
  const [manifest, schema] = await Promise.all(
    ["config/superboard-brand.json", "schemas/superboard-brand.schema.json"].map(
      async (path) => JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8")),
    ),
  );
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(manifest)) {
    const details = (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    throw new Error(`invalid SuperBoard brand contract: ${details}`);
  }
  return manifest;
}

function gitGrep(repositoryRoot, pattern, paths) {
  try {
    return execFileSync(
      "git",
      ["grep", "-n", "-I", "-F", pattern, "--", ...paths],
      { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    if (error.status === 1) return "";
    throw error;
  }
}

export async function checkSuperBoardBrand({ repositoryRoot = root } = {}) {
  const manifest = await validateSuperBoardBrand({ repositoryRoot });
  const developmentTarget = JSON.parse(
    await readFile(resolve(repositoryRoot, "deploy/targets/mbza-development.json"), "utf8"),
  );
  const violations = [];
  if (
    developmentTarget.domains?.dashboard !== manifest.developmentDomains.dashboard ||
    developmentTarget.domains?.shortlinks !== manifest.developmentDomains.shortLinks
  ) {
    violations.push("MBZA domains do not match the canonical SuperBoard brand contract");
  }
  const retiredDashboard = ["grow", "mbza", "dev"].join(".");
  if (
    !developmentTarget.retiredDomains?.some(
      (entry) =>
        entry.hostname === retiredDashboard && entry.policy === "must-be-unassigned",
    )
  ) {
    violations.push("the retired MBZA dashboard domain is not fail-closed");
  }
  for (const pattern of [
    "mabzadev/" + "opengrow-platform",
    "mabzadev/" + "opengrow-reference",
  ]) {
    const matches = gitGrep(repositoryRoot, pattern, [
      ".",
      ":(exclude)**/*.test.*",
      ":(exclude)config/sdk-release-history.json",
      ":(exclude)docs/**",
    ]);
    if (matches) violations.push(matches);
  }
  const visibleLegacyBrand = gitGrep(repositoryRoot, "OpenGrow", [
    "README.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "apps/dashboard",
    ":(exclude)apps/dashboard/**/__tests__/**",
    ":(exclude)apps/dashboard/e2e/**",
    "apps/mcp",
    ":(exclude)apps/mcp/src/__tests__/**",
    "superboard.project.json",
  ]);
  if (visibleLegacyBrand) violations.push(visibleLegacyBrand);
  if (violations.length > 0) {
    throw new Error(`legacy active brand references found:\n${violations.join("\n")}`);
  }
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = await checkSuperBoardBrand();
  process.stdout.write(
    `${manifest.brand.name} brand contract valid: ${manifest.repositories.canonical}, https://${manifest.developmentDomains.dashboard}\n`,
  );
}
