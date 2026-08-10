import { spawnSync } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  environmentFromArgs,
  parseArgs,
  root,
  validateTarget,
} from "./cloudflare-target.mjs";
import { newTargetManifest } from "./opengrow-target-template.mjs";

const args = parseArgs();
const target = args.target;
if (!target)
  throw new Error(
    "Usage: npm run target:register -- --target <slug> --environment <development|production> [--apply]",
  );
const apply = Boolean(args.apply);
const selectedEnvironment = environmentFromArgs(args);
if (args["enable-legacy-messaging"] && !args["messaging-domain"]) {
  throw new Error("--enable-legacy-messaging requires --messaging-domain");
}
const confirmation =
  typeof args.confirm === "string" ? args.confirm.trim() : "";
if (apply && !confirmation) {
  throw new Error(
    "Target provisioning with --apply requires the exact --confirm value emitted by the preceding --remote plan",
  );
}
const manifestPath = resolve(root, "deploy", "targets", `${target}.json`);

try {
  await access(manifestPath);
} catch {
  for (const required of [
    "account-alias",
    "workers-dev-subdomain",
    "api-domain",
    "shortlinks-domain",
    "sdk-domain",
    "dashboard-domain",
    "files-domain",
    "mcp-domain",
    "mail-from-address",
    "max-file-bytes",
    "allowed-file-content-types",
    "operator-docs-url",
    "auth-gateway-issuer",
    "auth-gateway-audience",
    "auth-gateway-jwks-url",
  ]) {
    if (!args[required]) throw new Error(`New targets require --${required}`);
  }
  const manifest = newTargetManifest({ args, target, selectedEnvironment });
  await validateTarget(manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Created ${manifestPath}`);
}

run("node", [
  "scripts/cloudflare-bootstrap.mjs",
  "--target",
  target,
  "--environment",
  selectedEnvironment,
  ...(args.remote || apply ? ["--remote"] : []),
  ...(apply ? ["--apply", "--confirm", confirmation] : []),
]);

console.log(
  apply
    ? `Target ${target} resources are provisioned for ${selectedEnvironment}. Commit the non-secret identifiers, configure secrets, pass the remote secret preflight, then deploy through the protected workflow.`
    : args.remote
      ? `Target ${target} remote inventory was planned without mutation. Re-run with --apply and the exact emitted --confirm value to provision it.`
      : `Target ${target} validated locally. Re-run with --remote and scoped Cloudflare credentials to inspect the account before provisioning.`,
);

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
