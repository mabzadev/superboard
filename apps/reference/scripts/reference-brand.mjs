import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

export function checkReferenceBrand({ repositoryRoot = root } = {}) {
  const violations = [];
  for (const pattern of [
    "mabzadev/" + "opengrow-platform",
    "mabzadev/" + "opengrow-reference",
    "grow" + ".mbza" + ".dev",
    "opengrow-platform",
  ]) {
    const matches = gitGrep(repositoryRoot, pattern, [
      ".",
      ":(exclude)scripts/reference-brand.mjs",
    ]);
    if (matches) violations.push(matches);
  }
  const visibleLegacy = gitGrep(repositoryRoot, "OpenGrow Reference", [
    "README.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "docs",
    "web",
    "lib/src/app.dart",
    "reference.project.json",
  ]);
  if (visibleLegacy) violations.push(visibleLegacy);
  if (violations.length > 0) {
    throw new Error(`legacy active Reference brand found:\n${violations.join("\n")}`);
  }
  return {
    name: "SuperBoard Reference",
    repository: "mabzadev/superboard",
    platformRepository: "mabzadev/superboard",
    dashboard: "board.mbza.dev",
    shortLinks: "in.mbza.dev",
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = checkReferenceBrand();
  process.stdout.write(
    `${result.name} brand contract valid: ${result.repository}, https://${result.dashboard}\n`,
  );
}
