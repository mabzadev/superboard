import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv from "ajv";
import {
  DOMAIN_SERVICE_REGISTRY,
  PLATFORM_SERVICE_SECRETS,
  managedWorkerDefinition,
} from "./cloudflare-services.mjs";
import { deploymentOrder } from "./cloudflare-deploy-plan.mjs";
import { loadTarget } from "./cloudflare-target.mjs";
import {
  isIgnoredDirectory,
  isLocalOnly,
} from "./configuration-boundaries.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const schema = JSON.parse(
  readFileSync(
    resolve(root, "node_modules/wrangler/config-schema.json"),
    "utf8",
  ),
);
const wranglerVersion = JSON.parse(
  readFileSync(resolve(root, "node_modules/wrangler/package.json"), "utf8"),
).version;
const validateConfig = new Ajv({ allErrors: true, strict: false }).compile(
  schema,
);
const configurationBoundaryContract = JSON.parse(
  readFileSync(
    resolve(root, "config/configuration-boundaries.json"),
    "utf8",
  ),
);
const UNBOUNDED_RESPONSE_BUFFERING =
  /\bawait\s+(?:[A-Za-z_$][A-Za-z0-9_$]*?)?[Rr]esponse\.(?:json|text|arrayBuffer)\s*(?:<[^>\n]+>)?\s*\(/u;

test("every target Worker satisfies the production configuration policy", async () => {
  const checked = [];
  for (const targetName of targetNames()) {
    const { target } = await loadTarget(targetName);
    for (const environment of Object.keys(target.environments).sort()) {
      for (const service of deploymentOrder(target)) {
        execFileSync(
          process.execPath,
          [
            "scripts/cloudflare-config.mjs",
            "--service",
            service,
            "--target",
            targetName,
            "--environment",
            environment,
            "--preflight",
            "--allow-unprovisioned",
            "--output-suffix",
            "policy",
          ],
          { cwd: root, stdio: "pipe" },
        );
        const path = resolve(
          root,
          `deploy/generated/${targetName}-${service}-${environment}-policy.jsonc`,
        );
        const config = JSON.parse(readFileSync(path, "utf8"));
        assertWranglerSchema(config, `${targetName}/${environment}/${service}`);
        assertWorkerPolicy(config, target, service);
        checked.push(`${targetName}/${environment}/${service}`);
      }
    }
  }
  assert.ok(
    checked.length > 0,
    "at least one target Worker must be policy-checked",
  );
});

test("production Worker sources reject unsafe runtime anti-patterns", () => {
  const forbidden = [
    [
      UNBOUNDED_RESPONSE_BUFFERING,
      "unbounded response buffering; use readTextLimited/readJsonObjectLimited or stream",
    ],
    [/\bpassThroughOnException\s*\(/u, "fail-open passThroughOnException"],
    [/\bMath\.random\s*\(/u, "non-cryptographic randomness"],
    [
      /const\s*\{\s*waitUntil\s*\}\s*=\s*\w+/u,
      "destructured waitUntil loses its runtime binding",
    ],
  ];
  const cloudflareRestCallers = [];
  for (const path of workerSourceFiles(resolve(root, "workers"))) {
    const source = readFileSync(path, "utf8");
    for (const [pattern, reason] of forbidden) {
      assert.doesNotMatch(
        source,
        pattern,
        `${path.slice(root.length + 1)}: ${reason}`,
      );
    }
    if (/https:\/\/api\.cloudflare\.com\/client\/v4\//u.test(source)) {
      cloudflareRestCallers.push(path.slice(root.length + 1));
    }
  }
  assert.deepEqual(
    cloudflareRestCallers,
    ["workers/observability/src/index.ts"],
    "Only Analytics Engine SQL reads may use the Cloudflare API; services with bindings must use them",
  );
});

test("source Wrangler templates never pin a Cloudflare account resource", () => {
  const resourceId =
    /"(?:account_id|database_id|namespace_id|zone_id)"\s*:\s*"([^"]+)"/gu;
  const placeholder = /^00000000-0000-0000-0000-000000000\d{3}$/u;
  for (const path of wranglerSourceTemplates(resolve(root, "workers"))) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(resourceId)) {
      assert.match(
        match[1],
        placeholder,
        `${path.slice(root.length + 1)} pins account-specific resource ${match[1]}`,
      );
    }
  }
});

test("portable runtime sources never pin an application domain, account id, or workstation path", () => {
  const forbidden = [
    [
      /(?:[a-z0-9-]+\.)*(?:vocostar\.com|mbza\.dev)\b/iu,
      "application domains belong in deploy/targets manifests",
    ],
    [
      /\baccount_id\s*[:=]\s*["'][a-f0-9]{32}["']/iu,
      "Cloudflare account ids must come from scoped environment credentials",
    ],
    [
      /(?:^|["'`\s])\/Users\/[A-Za-z0-9._-]+\//mu,
      "absolute workstation paths are not portable",
    ],
  ];
  const roots = [
    "apps/dashboard/src",
    "apps/mcp/src",
    "packages",
    "scripts",
    "sdks",
    "workers",
  ];
  let checked = 0;
  for (const relativeRoot of roots) {
    for (const path of portableRuntimeFiles(resolve(root, relativeRoot))) {
      const source = readFileSync(path, "utf8");
      for (const [pattern, reason] of forbidden) {
        assert.doesNotMatch(
          source,
          pattern,
          `${path.slice(root.length + 1)}: ${reason}`,
        );
      }
      checked += 1;
    }
  }
  assert.ok(
    checked > 0,
    "at least one portable runtime source must be checked",
  );
});

test("every maintained JavaScript package explicitly inherits the repository MIT license", () => {
  const manifests = [resolve(root, "package.json")];
  for (const relativeRoot of ["apps", "packages", "sdks", "workers"]) {
    manifests.push(...sourcePackageManifests(resolve(root, relativeRoot)));
  }
  assert.ok(
    manifests.length > 1,
    "workspace package manifests must be discovered",
  );
  for (const path of manifests) {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(
      manifest.license,
      "MIT",
      `${path.slice(root.length + 1)} must declare the repository MIT license`,
    );
  }
});

test("response buffering policy covers typed and named response variables", () => {
  assert.match(
    "const value = await response.json<Result>();",
    UNBOUNDED_RESPONSE_BUFFERING,
  );
  assert.match(
    "const value = await manifestResponse.text();",
    UNBOUNDED_RESPONSE_BUFFERING,
  );
  assert.doesNotMatch(
    "const value = await readJsonObjectLimited(response, 1024);",
    UNBOUNDED_RESPONSE_BUFFERING,
  );
  assert.doesNotMatch(
    "return c.json({ status: 'ok' });",
    UNBOUNDED_RESPONSE_BUFFERING,
  );
});

function targetNames() {
  return readdirSync(resolve(root, "deploy/targets"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".json") &&
        entry.name !== "schema.json",
    )
    .map((entry) => entry.name.slice(0, -5))
    .sort();
}

function workerSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "runtime-tests"].includes(entry.name)) continue;
      files.push(...workerSourceFiles(path));
      continue;
    }
    if (
      entry.isFile() &&
      path.endsWith(".ts") &&
      !path.endsWith(".test.ts") &&
      !path.endsWith("test-cloudflare-workers.ts")
    ) {
      files.push(path);
    }
  }
  return files;
}

function wranglerSourceTemplates(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...wranglerSourceTemplates(path));
    } else if (entry.isFile() && entry.name === "wrangler.jsonc") {
      files.push(path);
    }
  }
  return files;
}

function portableRuntimeFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      const relativePath = relative(root, path);
      if (
        isIgnoredDirectory(
          relativePath,
          entry.name,
          configurationBoundaryContract,
        ) || isLocalOnly(relativePath, configurationBoundaryContract)
      ) {
        continue;
      }
      files.push(...portableRuntimeFiles(path));
      continue;
    }
    if (!entry.isFile()) continue;
    if (/\.(?:lock|snap)$/u.test(entry.name)) continue;
    if (/(?:^|\.)test\.[^.]+$/u.test(entry.name)) continue;
    if (!/\.(?:cjs|dart|js|jsonc|jsx|mjs|ts|tsx|yaml|yml)$/u.test(entry.name)) {
      continue;
    }
    files.push(path);
  }
  return files;
}

function sourcePackageManifests(directory) {
  const manifests = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        [
          ".dart_tool",
          ".next",
          ".open-next",
          "build",
          "coverage",
          "dist",
          "fixtures",
          "lib",
          "node_modules",
          "test",
          "tests",
        ].includes(entry.name)
      ) {
        continue;
      }
      manifests.push(...sourcePackageManifests(path));
    } else if (entry.isFile() && entry.name === "package.json") {
      manifests.push(path);
    }
  }
  return manifests;
}

function assertWranglerSchema(config, label) {
  assert.equal(
    validateConfig(config),
    true,
    `${label} violates Wrangler ${wranglerVersion}: ${JSON.stringify(validateConfig.errors)}`,
  );
}

function assertWorkerPolicy(config, target, service) {
  assert.equal(
    config.workers_dev,
    false,
    `${service} must disable workers.dev`,
  );
  assert.equal(
    config.preview_urls,
    false,
    `${service} must disable preview URLs`,
  );
  assert.match(config.name, /^[a-z0-9][a-z0-9-]*$/u);
  assert.ok(config.main, `${service} must declare its entrypoint`);
  assertCurrentCompatibilityDate(config.compatibility_date, service);
  assert.ok(config.compatibility_flags?.includes("nodejs_compat"));
  if (service === "site") {
    assert.equal(
      config.compatibility_flags?.includes("global_fetch_strictly_public"),
      false,
      "site must omit global_fetch_strictly_public while its D1 session policy is disabled",
    );
  } else {
    assert.ok(
      config.compatibility_flags?.includes("global_fetch_strictly_public"),
      `${service} must enable global_fetch_strictly_public`,
    );
  }
  assert.deepEqual(config.observability, {
    enabled: true,
    logs: { enabled: true, head_sampling_rate: 1, invocation_logs: true },
    traces: { enabled: true, head_sampling_rate: 0.1 },
  });
  assert.equal(
    config.routes,
    undefined,
    `${service} preflight must not own routes`,
  );
  assert.equal(
    config.triggers,
    undefined,
    `${service} preflight must not own triggers`,
  );
  assert.equal(
    config.queues?.consumers,
    undefined,
    `${service} preflight must not consume queues`,
  );
  if (service === "observability") {
    assert.equal(config.tail_consumers, undefined);
  } else {
    assert.deepEqual(config.tail_consumers, [
      { service: target.workers.observability[environmentFor(config, target)] },
    ]);
  }
  for (const secret of secretsFor(target, service)) {
    assert.equal(
      Object.hasOwn(config.vars ?? {}, secret),
      false,
      `${service} secret ${secret} must not be committed as a var`,
    );
  }
}

function environmentFor(config, target) {
  return (
    Object.entries(target.workers.observability).find(
      ([, workerName]) => config.tail_consumers?.[0]?.service === workerName,
    )?.[0] ?? Object.keys(target.environments)[0]
  );
}

function assertCurrentCompatibilityDate(value, service) {
  assert.match(value ?? "", /^\d{4}-\d{2}-\d{2}$/u);
  const selected = Date.parse(`${value}T00:00:00Z`);
  const now = Date.now();
  assert.ok(
    selected <= now + 86_400_000,
    `${service} compatibility date is in the future`,
  );
  assert.ok(
    now - selected <= 183 * 86_400_000,
    `${service} compatibility date is older than six months`,
  );
}

function secretsFor(target, service) {
  if (service === "custom") return target.customWorker.secrets;
  const managedWorker = managedWorkerDefinition(target, service);
  if (managedWorker) return managedWorker.secrets;
  if (DOMAIN_SERVICE_REGISTRY[service]) {
    return DOMAIN_SERVICE_REGISTRY[service].secrets;
  }
  return PLATFORM_SERVICE_SECRETS[service] ?? [];
}
