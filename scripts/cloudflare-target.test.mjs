import assert from "node:assert/strict";
import test from "node:test";
import {
  cloudflareAccountEnvName,
  cloudflareAccountId,
  cloudflareEnv,
  environmentFromArgs,
  loadTarget,
  publicAuthUrl,
  publicApiUrl,
  targetSelectionFromArgs,
  targetNameFromArgs,
  validateTarget,
} from "./cloudflare-target.mjs";

test("committed targets validate without embedding Cloudflare account ids", async () => {
  for (const name of ["mbza-development", "vocostar"]) {
    const { target } = await loadTarget(name);
    assert.equal("accountId" in target, false);
    assert.equal(target.schemaVersion, 17);
    assert.match(target.zoneName, /^(?:mbza\.dev|vocostar\.com)$/u);
    assert.deepEqual(
      target.resourceIdentity,
      name === "mbza-development"
        ? {
            logicalName: "superboard",
            physicalName: "superboard",
            previousNames: [],
            migrationStrategy: "canonical",
          }
        : {
            logicalName: "superboard",
            physicalName: "opengrow",
            previousNames: ["opengrow"],
            migrationStrategy: "retain-physical-name",
          },
    );
    assert.ok(Number.isSafeInteger(target.filePolicy.maxBytes));
    assert.ok(Number.isSafeInteger(target.filePolicy.downloadTicketTtlSeconds));
    assert.ok(target.filePolicy.allowedContentTypes.length > 0);
    assert.match(
      target.workers.observability.development ??
        target.workers.observability.production,
      name === "mbza-development"
        ? /^superboard-observability/u
        : /^opengrow-observability/u,
    );
    assert.match(
      target.workers.mcp.development ?? target.workers.mcp.production,
      name === "mbza-development" ? /^superboard-mcp/u : /^opengrow-mcp/u,
    );
    for (const resources of Object.values(target.environments)) {
      assert.match(resources.publicRouting, /^(?:active|staged)$/u);
      assert.match(
        resources.analyticsDataset,
        name === "mbza-development"
          ? /^superboard_[a-z0-9_]+$/u
          : /^opengrow_[a-z0-9_]+$/u,
      );
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
    "opengrow-support-v2-attachments",
  );
  assert.deepEqual(vocostar.environments.production.supportRouting, {
    pattern: "api.vocostar.com/api/v1/support*",
    worker: "opengrow-api",
    mode: "staged",
  });
  assert.deepEqual(vocostar.environments.production.moduleVectorize, {
    supportKnowledge: {
      name: "opengrow-support-v2-knowledge",
      dimensions: 1024,
      metric: "cosine",
      description: "SuperBoard Support knowledge index",
    },
  });
});

test("mbza development domains keep API and short links separate", async () => {
  const { target } = await loadTarget("mbza-development");
  assert.equal(target.environments.development.publicRouting, "active");
  assert.equal(publicApiUrl(target), "https://api.mbza.dev");
  assert.equal(publicAuthUrl(target), "https://auth.mbza.dev");
  assert.equal(target.domains.shortlinks, "in.mbza.dev");
  assert.equal(target.domains.dashboard, "board.mbza.dev");
  assert.deepEqual(target.retiredDomains, [
    {
      hostname: "grow.mbza.dev",
      formerSurface: "dashboard",
      policy: "must-be-unassigned",
      reason: "Previous back-office hostname replaced by board.mbza.dev.",
    },
  ]);
  assert.equal(target.domains.mailPreview, "mail.mbza.dev");
  assert.equal(target.domains.mcp, "mcp.mbza.dev");
  assert.equal(target.domains.messaging, undefined);
  assert.equal(target.workers.messaging, undefined);
  assert.equal(target.environments.development.messagingD1, undefined);
  assert.equal(
    target.environments.development.customD1.name,
    "superboard-dev-custom-reference-db",
  );
  assert.deepEqual(target.customWorker.d1Binding, {
    binding: "REFERENCE_DB",
    migrationsDir: "workers/custom/reference/migrations",
  });
  assert.deepEqual(target.customWorker.crons, ["0 3 * * *"]);
  assert.ok(target.environments.development);
  assert.ok(target.environments.local);
  assert.equal(target.environments.production, undefined);
  assert.equal(target.filePolicy.maxBytes, 10_485_760);
  assert.equal(target.filePolicy.downloadTicketTtlSeconds, 600);
  assert.equal(
    target.filePolicy.allowedContentTypes.includes("audio/*"),
    false,
  );
});

test("enabled Flows targets require their complete native resource set", async () => {
  const { target: source } = await loadTarget("mbza-development");
  const missingD1 = structuredClone(source);
  delete missingD1.environments.development.moduleD1.flows;
  await assert.rejects(
    validateTarget(missingD1),
    /moduleD1\.flows is required because flows is enabled/u,
  );

  const missingArchive = structuredClone(source);
  delete missingArchive.environments.development.moduleR2.flows;
  await assert.rejects(
    validateTarget(missingArchive),
    /moduleR2\.flows is required because flows is enabled/u,
  );

  const missingQueue = structuredClone(source);
  delete missingQueue.environments.development.moduleQueues.flows;
  await assert.rejects(
    validateTarget(missingQueue),
    /moduleQueues\.flows is required because flows is enabled/u,
  );

  const withoutProducts = structuredClone(source);
  withoutProducts.features.products = false;
  await assert.rejects(
    validateTarget(withoutProducts),
    /Products must be enabled when Flows is enabled/u,
  );
});

test("enabled Support targets require every queue and Vectorize resource", async () => {
  const { target: source } = await loadTarget("mbza-development");
  for (const queueKey of ["support", "supportAi", "supportBulk"]) {
    const target = structuredClone(source);
    delete target.environments.development.moduleQueues[queueKey];
    await assert.rejects(
      validateTarget(target),
      queueKey === "support"
        ? /moduleQueues.*required property 'support'/u
        : new RegExp(
            `moduleQueues\\.${queueKey} is required because support is enabled`,
            "u",
          ),
    );
  }

  const missingKnowledge = structuredClone(source);
  delete missingKnowledge.environments.development.moduleVectorize
    .supportKnowledge;
  await assert.rejects(
    validateTarget(missingKnowledge),
    /moduleVectorize\.supportKnowledge is required because support is enabled/u,
  );

  const wrongRoute = structuredClone(source);
  wrongRoute.environments.development.supportRouting.pattern =
    "other.mbza.dev/api/v1/support*";
  await assert.rejects(validateTarget(wrongRoute), /supportRouting must route/u);
});

test("resource identity keeps canonical and legacy physical resources fail-closed", async () => {
  const { target: source } = await loadTarget("mbza-development");
  const target = structuredClone(source);
  target.environments.development.d1.name = "opengrow-dev-db";
  await assert.rejects(
    validateTarget(target),
    /outside the declared superboard namespace/u,
  );

  const { target: vocostarSource } = await loadTarget("vocostar");
  const vocostar = structuredClone(vocostarSource);
  vocostar.environments.production.d1.name = "superboard-db";
  await assert.rejects(
    validateTarget(vocostar),
    /outside the declared opengrow namespace/u,
  );

  const retired = structuredClone(source);
  retired.retiredDomains[0].hostname = retired.domains.dashboard;
  await assert.rejects(
    validateTarget(retired),
    /retired domain board\.mbza\.dev is still active/u,
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

test("Workers Builds cannot override target-owned Worker names", async () => {
  const { target } = await loadTarget("mbza-development");
  const source = {
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_API_TOKEN: "deployment-token",
    WRANGLER_CI_OVERRIDE_NAME: target.workers.dashboard.development,
    WORKERS_CI: "1",
  };

  const childEnv = cloudflareEnv(target, source);

  assert.equal("WRANGLER_CI_OVERRIDE_NAME" in childEnv, false);
  assert.equal(
    source.WRANGLER_CI_OVERRIDE_NAME,
    target.workers.dashboard.development,
    "the caller environment remains immutable",
  );
  assert.equal(childEnv.CLOUDFLARE_ACCOUNT_ID, "a".repeat(32));
  assert.equal(childEnv.CLOUDFLARE_API_TOKEN, "deployment-token");
  assert.equal(childEnv.WORKERS_CI, "1");
});

test("local, development and production environments are accepted", () => {
  assert.equal(environmentFromArgs({ environment: "local" }), "local");
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
    /local, development or production/,
  );
});

test("operational commands never select an implicit application target", () => {
  assert.equal(targetNameFromArgs({ target: "vocostar" }, {}), "vocostar");
  assert.equal(
    targetNameFromArgs({}, { OPENGROW_TARGET: "mbza-development" }),
    "mbza-development",
  );
  assert.equal(
    targetNameFromArgs(
      {},
      {
        SUPERBOARD_TARGET: "vocostar",
        OPENGROW_TARGET: "mbza-development",
      },
    ),
    "vocostar",
  );
  assert.throws(
    () => targetNameFromArgs({}, {}),
    /SUPERBOARD_TARGET.*OPENGROW_TARGET/u,
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
