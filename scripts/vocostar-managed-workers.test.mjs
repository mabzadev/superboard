import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { deploymentOrder } from "./cloudflare-deploy-plan.mjs";
import {
  managedWorkerService,
  managedWorkerDefinitions,
} from "./cloudflare-services.mjs";
import { loadTarget } from "./cloudflare-target.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const provenancePath = "workers/custom/vocostar/orchestrators/PROVENANCE.json";

test("VocoStar orchestrators have a complete Git provenance contract", async () => {
  const provenance = JSON.parse(
    readFileSync(resolve(root, provenancePath), "utf8"),
  );
  const { target } = await loadTarget("vocostar");
  const components = managedWorkerDefinitions(target);

  assert.equal(provenance.schemaVersion, 1);
  assert.match(provenance.canonicalRepository, /^https:\/\/github\.com\//u);
  assert.match(provenance.legacyRepository, /^https:\/\/github\.com\//u);
  assert.match(provenance.legacyWorkingTreeCommit, /^[a-f0-9]{40}$/u);
  assert.match(provenance.lastTrackedLegacyCommit, /^[a-f0-9]{40}$/u);
  assert.deepEqual(
    provenance.components.map(({ id }) => id).sort(),
    components.map(({ id }) => id).sort(),
  );
  assert.ok(target.environments.production.customR2.legacyName);

  const trackedPaths = [provenancePath];
  for (const component of components) {
    assert.equal(component.r2Resource, "customR2");
    const sourceBinding = target.customWorker.serviceBindings.find(
      ({ workers }) => workers.production === component.workers.production,
    );
    assert.ok(
      sourceBinding,
      `${component.id} must be reached by the application adapter Service Binding`,
    );
    trackedPaths.push(
      component.source,
      component.packagePath,
      ...component.containers.map(({ dockerfile }) => dockerfile),
    );
    const historical = provenance.components.find(
      ({ id }) => id === component.id,
    );
    assert.ok(historical, `${component.id} must have an import receipt`);
    for (const digest of Object.values(historical.legacySnapshot)) {
      assert.match(digest, /^[a-f0-9]{64}$/u);
    }
  }

  for (const path of trackedPaths) {
    execFileSync("git", ["ls-files", "--error-unmatch", path], {
      cwd: root,
      stdio: "pipe",
    });
  }
});

test("managed orchestrators are deployed before their adapter", async () => {
  const { target } = await loadTarget("vocostar");
  const order = deploymentOrder(target);
  for (const component of managedWorkerDefinitions(target)) {
    const service = managedWorkerService(component);
    assert.ok(order.includes(service));
    assert.ok(order.indexOf(service) < order.indexOf("custom"));
  }
});

test("VocoStar runtime bridge keeps Files input and legacy output stores distinct", async () => {
  const { target } = await loadTarget("vocostar");
  assert.deepEqual(target.customWorker.runtimeBridge, {
    filesInputOrigin: "https://files.vocostar.com",
    outputFileOrigin: "https://file.vocostar.com",
    gatewayOrigin: "https://api.vocostar.com",
    gatewayWorker: "api-auth-gateway",
    gatewaySecretBinding: "INTERNAL_CALLBACK_TOKEN",
    callbackPaths: [
      "/internal/notify",
      "/ws/vocals/notify",
      "/ws/vocals/progress",
      "/ws/medias/progress",
    ],
    deploymentStatus: "blocked",
    blockedReason: target.customWorker.runtimeBridge.blockedReason,
  });
  assert.equal(target.environments.production.r2.name, "opengrow");
  assert.equal(target.environments.production.customR2.name, "app-vocostar");

  for (const service of [
    "custom",
    "managed-vocals-orchestrator",
    "managed-medias-orchestrator",
  ]) {
    execFileSync(
      process.execPath,
      [
        "scripts/cloudflare-config.mjs",
        "--target",
        "vocostar",
        "--environment",
        "production",
        "--service",
        service,
        "--preflight",
        "--allow-unprovisioned",
      ],
      { cwd: root, stdio: "pipe" },
    );
  }
  const custom = JSON.parse(
    readFileSync(
      resolve(root, "deploy/generated/vocostar-custom-production.jsonc"),
      "utf8",
    ),
  );
  assert.equal(custom.vars.FILES_INPUT_ORIGIN, "https://files.vocostar.com");
  for (const service of [
    "managed-vocals-orchestrator",
    "managed-medias-orchestrator",
  ]) {
    const config = JSON.parse(
      readFileSync(
        resolve(root, `deploy/generated/vocostar-${service}-production.jsonc`),
        "utf8",
      ),
    );
    assert.equal(config.vars.FILES_INPUT_ORIGIN, "https://files.vocostar.com");
    assert.equal(config.vars.OUTPUT_FILE_ORIGIN, "https://file.vocostar.com");
    assert.equal(config.vars.GATEWAY_URL, "https://api.vocostar.com");
    assert.equal(config.vars.PUBLIC_FILE_ORIGIN, undefined);
    assert.equal(config.vars.R2_BUCKET_NAME, "app-vocostar");
  }
});

test("orchestrator sources enforce ticket origins and callback HTTP status", () => {
  for (const component of ["vocals", "medias"]) {
    const workerSource = readFileSync(
      resolve(
        root,
        `workers/custom/vocostar/orchestrators/${component}/src/index.ts`,
      ),
      "utf8",
    );
    const containerSource = readFileSync(
      resolve(
        root,
        `workers/custom/vocostar/orchestrators/${component}/container/main.py`,
      ),
      "utf8",
    );
    assert.match(workerSource, /if \(!r\.ok\)/u);
    assert.match(containerSource, /is_files_ticket_url/u);
    assert.match(containerSource, /origin == FILES_INPUT_ORIGIN/u);
    assert.match(containerSource, /origin == OUTPUT_BASE_URL/u);
  }
  const medias = readFileSync(
    resolve(
      root,
      "workers/custom/vocostar/orchestrators/medias/container/main.py",
    ),
    "utf8",
  );
  assert.match(medias, /allow_redirects=False/u);
  assert.match(medias, /FILES_INPUT_MAX_BYTES/u);
});
