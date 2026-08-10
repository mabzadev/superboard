#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);

export function referenceCheckoutMetadata(controlPlane) {
  const repository = String(
    controlPlane?.repositories?.reference?.nameWithOwner || "",
  ).trim();
  const ref = String(
    controlPlane?.repositories?.reference?.defaultBranch || "",
  ).trim();

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("Reference repository must be a valid owner/name value");
  }
  if (!/^[A-Za-z0-9._/-]+$/u.test(ref) || ref.includes("..")) {
    throw new Error("Reference branch contains unsupported characters");
  }
  return { repository, ref };
}

async function main() {
  const controlPlane = JSON.parse(
    await readFile(
      resolve(repositoryRoot, "config/github-control-plane.json"),
      "utf8",
    ),
  );
  const metadata = referenceCheckoutMetadata(controlPlane);
  const output = `repository=${metadata.repository}\nref=${metadata.ref}\n`;
  const githubOutput = String(process.env.GITHUB_OUTPUT || "").trim();
  if (githubOutput) {
    await appendFile(githubOutput, output, "utf8");
  } else {
    process.stdout.write(output);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
