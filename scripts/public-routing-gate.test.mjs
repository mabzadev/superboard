import assert from "node:assert/strict";
import test from "node:test";
import { loadTarget } from "./cloudflare-target.mjs";
import { assertPublicRoutingReady } from "./public-routing-gate.mjs";

test("staged production deploys private Workers without public routes", async () => {
  const { target } = await loadTarget("vocostar");
  assert.deepEqual(assertPublicRoutingReady(target, "production"), {
    schemaVersion: 1,
    ready: true,
    routesEnabled: false,
    target: "vocostar",
    environment: "production",
    mode: "staged-private-workers",
    clientReceiptVerified: false,
  });
});

test("development public routing does not require a production receipt", async () => {
  const { target } = await loadTarget("mbza-development");
  assert.equal(
    assertPublicRoutingReady(target, "development").routesEnabled,
    true,
  );
});

test("active production refuses routing without a reviewed client receipt", async () => {
  const { target: source } = await loadTarget("vocostar");
  const target = structuredClone(source);
  target.environments.production.publicRouting = "active";
  assert.throws(
    () => assertPublicRoutingReady(target, "production"),
    /requires a reviewed client cutover receipt/u,
  );
});

test("active production binds routing to the declared application receipt", async () => {
  const { target: source } = await loadTarget("vocostar");
  const target = structuredClone(source);
  target.environments.production.publicRouting = "active";
  target.productionCutover = {
    application: "vocostar",
    snapshot: "config/flutterflow-sources/vocostar.json",
    clientReceipt: "config/flutterflow-releases/vocostar.json",
  };
  const calls = [];
  const result = assertPublicRoutingReady(target, "production", {
    repositoryRoot: "/repository",
    verifyReceipt: (options) => {
      calls.push(options);
      return {
        ready: true,
        application: "vocostar",
        flutterflowCommitId: "accepted-commit",
      };
    },
  });
  assert.deepEqual(calls, [
    {
      manifestPath: "/repository/config/flutterflow-sources/vocostar.json",
      receiptPath: "/repository/config/flutterflow-releases/vocostar.json",
    },
  ]);
  assert.equal(result.routesEnabled, true);
  assert.equal(result.clientReceiptVerified, true);
  assert.equal(result.flutterflowCommitId, "accepted-commit");
});
