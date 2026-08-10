import assert from "node:assert/strict";
import test from "node:test";
import {
  cloudflareAccountEnvName,
  cloudflareAccountId,
  environmentFromArgs,
  loadTarget,
  publicApiUrl,
  targetSelectionFromArgs,
  targetNameFromArgs,
  validateTarget,
} from "./cloudflare-target.mjs";

test("committed targets validate without embedding Cloudflare account ids", async () => {
  for (const name of ["mbza-development", "vocostar"]) {
    const { target } = await loadTarget(name);
    assert.equal("accountId" in target, false);
    assert.equal(target.schemaVersion, 11);
    assert.ok(Number.isSafeInteger(target.filePolicy.maxBytes));
    assert.ok(Number.isSafeInteger(target.filePolicy.downloadTicketTtlSeconds));
    assert.ok(target.filePolicy.allowedContentTypes.length > 0);
    assert.match(
      target.workers.observability.development ??
        target.workers.observability.production,
      /^opengrow-observability/,
    );
    assert.match(
      target.workers.mcp.development ?? target.workers.mcp.production,
      /^opengrow-mcp/,
    );
    for (const resources of Object.values(target.environments)) {
      assert.match(resources.publicRouting, /^(?:active|staged)$/u);
      assert.match(resources.analyticsDataset, /^opengrow_[a-z0-9_]+$/);
      assert.ok(resources.identityD1.name.endsWith("identity-db"));
      assert.ok(resources.filesD1.name.endsWith("files-db"));
    }
  }
  const { target: vocostar } = await loadTarget("vocostar");
  assert.equal(vocostar.environments.production.customD1.name, "vocostar-db");
  assert.equal(vocostar.environments.production.customR2.name, "app-vocostar");
  assert.equal(vocostar.environments.production.publicRouting, "staged");
  assert.notEqual(
    vocostar.environments.production.dashboardCache.name,
    vocostar.environments.production.r2.name,
    "Dashboard cache must not share the application files bucket",
  );
  assert.equal(vocostar.customWorker.serviceBindings.length, 3);
  assert.deepEqual(vocostar.customWorker.crons, ["*/1 * * * *"]);
  assert.deepEqual(
    vocostar.customWorker.managedWorkers.map(({ id }) => id),
    ["vocals-orchestrator", "medias-orchestrator"],
  );
  assert.equal(
    vocostar.customWorker.managedWorkers[0].workers.production,
    "send-users-vocals-orchestrator",
  );
  assert.equal(vocostar.features.messaging, false);
  assert.equal(vocostar.filePolicy.maxBytes, 52_428_800);
  assert.equal(vocostar.filePolicy.downloadTicketTtlSeconds, 1_800);
  assert.ok(vocostar.filePolicy.allowedContentTypes.includes("audio/*"));
  assert.ok(vocostar.filePolicy.allowedContentTypes.includes("video/*"));
  assert.notEqual(
    vocostar.environments.production.moduleQueues.support.name,
    vocostar.environments.production.queues.messaging,
  );
  assert.notEqual(
    vocostar.environments.production.moduleR2.support.name,
    vocostar.environments.production.messagingR2.name,
  );
  assert.equal(
    vocostar.environments.production.moduleR2.support.name,
    "opengrow-support-attachments",
  );
});

test("mbza development domains keep API and short links separate", async () => {
  const { target } = await loadTarget("mbza-development");
  assert.equal(target.environments.development.publicRouting, "active");
  assert.equal(publicApiUrl(target), "https://api.mbza.dev");
  assert.equal(target.domains.shortlinks, "in.mbza.dev");
  assert.equal(target.domains.mailPreview, "mail.mbza.dev");
  assert.equal(target.domains.mcp, "mcp.mbza.dev");
  assert.equal(target.domains.messaging, undefined);
  assert.equal(target.workers.messaging, undefined);
  assert.equal(target.environments.development.messagingD1, undefined);
  assert.equal(
    target.environments.development.customD1.name,
    "opengrow-dev-custom-reference-db",
  );
  assert.deepEqual(target.customWorker.d1Binding, {
    binding: "REFERENCE_DB",
    migrationsDir: "workers/custom/reference/migrations",
  });
  assert.deepEqual(target.customWorker.crons, ["0 3 * * *"]);
  assert.deepEqual(Object.keys(target.environments), ["development"]);
  assert.equal(target.filePolicy.maxBytes, 10_485_760);
  assert.equal(target.filePolicy.downloadTicketTtlSeconds, 600);
  assert.equal(
    target.filePolicy.allowedContentTypes.includes("audio/*"),
    false,
  );
});

test("public surface monitors are constrained to one safe HTTPS origin", async () => {
  const { target: source } = await loadTarget("mbza-development");
  const target = structuredClone(source);
  target.publicSurfaceMonitors = [
    {
      id: "unsafe",
      url: "https://reference.example.test",
      healthUrl: "https://127.0.0.1/health",
      description: "Unsafe health endpoint",
    },
  ];
  await assert.rejects(
    validateTarget(target),
    /credential-free public HTTPS URLs on one origin/u,
  );
});

test("production public routing requires a typed client cutover receipt", async () => {
  const { target: source } = await loadTarget("vocostar");
  const target = structuredClone(source);
  target.environments.production.publicRouting = "active";
  await assert.rejects(
    validateTarget(target),
    /must have required property 'productionCutover'/u,
  );
  target.productionCutover = {
    application: "vocostar",
    snapshot: "config/flutterflow-sources/vocostar.json",
    clientReceipt: "config/flutterflow-releases/vocostar.json",
  };
  await validateTarget(target);
});

test("account aliases resolve scoped credentials before the generic fallback", async () => {
  const { target } = await loadTarget("mbza-development");
  assert.equal(
    cloudflareAccountEnvName(target),
    "CLOUDFLARE_ACCOUNT_ID_MBZA_DEVELOPMENT",
  );
  assert.equal(
    cloudflareAccountId(target, {
      CLOUDFLARE_ACCOUNT_ID_MBZA_DEVELOPMENT: "a".repeat(32),
      CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
    }),
    "a".repeat(32),
  );
  assert.equal(cloudflareAccountId(target, {}, { required: false }), undefined);
});

test("only development and production environments are accepted", () => {
  assert.equal(
    environmentFromArgs({ environment: "development" }),
    "development",
  );
  assert.equal(
    environmentFromArgs({ environment: "production" }),
    "production",
  );
  assert.throws(
    () => environmentFromArgs({ environment: "staging" }),
    /development or production/,
  );
});

test("operational commands never select an implicit application target", () => {
  assert.equal(targetNameFromArgs({ target: "vocostar" }, {}), "vocostar");
  assert.equal(
    targetNameFromArgs({}, { OPENGROW_TARGET: "mbza-development" }),
    "mbza-development",
  );
  assert.throws(
    () => targetNameFromArgs({}, {}),
    /--target or OPENGROW_TARGET is required/,
  );
});

test("validation can explicitly select the checked-in reference target", async () => {
  assert.deepEqual(
    await targetSelectionFromArgs(
      { reference: true },
      {},
      { allowReference: true },
    ),
    {
      targetName: "mbza-development",
      environment: "development",
      reference: true,
    },
  );
  await assert.rejects(
    targetSelectionFromArgs(
      { reference: true, target: "vocostar" },
      {},
      { allowReference: true },
    ),
    /cannot be combined/u,
  );
  await assert.rejects(
    targetSelectionFromArgs({ reference: true }, {}, { allowReference: false }),
    /validation commands/u,
  );
});
