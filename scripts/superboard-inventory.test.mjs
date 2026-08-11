import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const inventoryScript = resolve(root, "scripts/superboard-inventory.mjs");
const upstreamPath = resolve(root, "upstream/opengrow/backend");

function run(...args) {
  return spawnSync(process.execPath, [inventoryScript, "--summary", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("inventory never reports an absent upstream comparison as verified", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  const available = existsSync(upstreamPath);

  assert.equal(payload.upstreamAvailable, available);
  assert.equal(payload.verification.verified, available);
  assert.equal(
    payload.verification.status,
    available ? "verified-against-upstream" : "upstream-unavailable",
  );

  if (!available) {
    assert.equal(payload.counts.upstreamRoutes, null);
    assert.equal(payload.counts.upstreamTables, null);
    assert.equal(payload.missingRoutes, null);
    assert.equal(payload.extraWorkerRoutes, null);
    assert.equal(payload.missingTables, null);
    assert.equal(payload.extraTables, null);
    assert.equal(payload.tablesWithMissingColumns, null);
  }
});

test("require-upstream fails closed when the comparison source is absent", () => {
  const result = run("--require-upstream");
  const available = existsSync(upstreamPath);

  assert.equal(result.status, available ? 0 : 2, result.stderr);
  if (!available) {
    assert.match(result.stderr, /Upstream parity cannot be verified/);
  }
});
