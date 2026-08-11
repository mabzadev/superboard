import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  enforceIdentityProjectCutover,
  parseIdentityScopeEvidence,
  readIdentityCutoverReceipt,
  verifyIdentityProjectCutover,
} from "./cloudflare-identity-cutover.mjs";
import { loadTarget } from "./cloudflare-target.mjs";

const accountId = "a".repeat(32);
const revision = "b".repeat(40);

test("Identity cutover parses one strict remote D1 evidence row", () => {
  assert.deepEqual(parseIdentityScopeEvidence(remoteEvidence()), {
    users: 0,
    identities: 0,
    sessions: 0,
    tokens: 0,
    migrationApplied: 1,
    unscopedRows: 0,
  });
  assert.throws(
    () => parseIdentityScopeEvidence("not-json"),
    /invalid Wrangler JSON/u,
  );
  assert.throws(
    () => parseIdentityScopeEvidence(JSON.stringify([])),
    /ambiguous/u,
  );
});

test("Identity cutover blocks deployment while any legacy row is unscoped", async () => {
  const { target } = await loadTarget("mbza-development");
  await assert.rejects(
    verifyIdentityProjectCutover({
      target,
      targetName: "mbza-development",
      environment: "development",
      accountId,
      revision,
      execute: () => ({
        status: 0,
        stdout: remoteEvidence({ users: 1, sessions: 2 }),
      }),
    }),
    /3 legacy rows have no project_id/u,
  );
});

test("Identity cutover writes a mode-0600 receipt bound to target resources and revision", async () => {
  const { target } = await loadTarget("mbza-development");
  const directory = await mkdtemp(join(tmpdir(), "opengrow-identity-gate-"));
  const result = await verifyIdentityProjectCutover({
    target,
    targetName: "mbza-development",
    environment: "development",
    accountId,
    revision,
    receiptDirectory: directory,
    now: new Date("2026-08-10T12:00:00.000Z"),
    execute: () => ({ status: 0, stdout: remoteEvidence() }),
  });
  assert.equal((await stat(result.path)).mode & 0o777, 0o600);
  assert.match(await readFile(result.path, "utf8"), /0002_project_scope\.sql/u);
  const receipt = await readIdentityCutoverReceipt(result.path, {
    targetName: "mbza-development",
    environment: "development",
    accountId,
    databaseName: "superboard-dev-identity-db",
    databaseId: "0c7e4bf4-a0b3-443b-8da9-159795171aa0",
    migration: "0002_project_scope.sql",
    revision,
    sha256: result.sha256,
  });
  assert.equal(receipt.evidence.unscopedRows, 0);
  await assert.rejects(
    readIdentityCutoverReceipt(result.path, {
      revision: "c".repeat(40),
      sha256: result.sha256,
    }),
    /another revision/u,
  );
});

test("Identity cutover refuses a receipt inside the Git repository", async () => {
  const { target } = await loadTarget("mbza-development");
  await assert.rejects(
    verifyIdentityProjectCutover({
      target,
      targetName: "mbza-development",
      environment: "development",
      accountId,
      revision,
      receiptDirectory: new URL("../tmp-receipts", import.meta.url).pathname,
      execute: () => ({ status: 0, stdout: remoteEvidence() }),
    }),
    /outside the Git repository/u,
  );
});

test("a supplied receipt never bypasses the fresh remote D1 proof", async () => {
  const { target } = await loadTarget("mbza-development");
  const auditDirectory = await mkdtemp(
    join(tmpdir(), "opengrow-identity-audit-"),
  );
  const freshDirectory = await mkdtemp(
    join(tmpdir(), "opengrow-identity-fresh-"),
  );
  const audit = await verifyIdentityProjectCutover({
    target,
    targetName: "mbza-development",
    environment: "development",
    accountId,
    revision,
    receiptDirectory: auditDirectory,
    execute: () => ({ status: 0, stdout: remoteEvidence() }),
  });
  let remoteReads = 0;
  await assert.rejects(
    enforceIdentityProjectCutover({
      suppliedReceipt: { path: audit.path, sha256: audit.sha256 },
      expected: {
        targetName: "mbza-development",
        environment: "development",
        accountId,
        databaseName: "superboard-dev-identity-db",
        databaseId: "0c7e4bf4-a0b3-443b-8da9-159795171aa0",
        migration: "0002_project_scope.sql",
        revision,
      },
      verification: {
        target,
        targetName: "mbza-development",
        environment: "development",
        accountId,
        revision,
        receiptDirectory: freshDirectory,
        execute: () => {
          remoteReads += 1;
          return { status: 0, stdout: remoteEvidence({ users: 1 }) };
        },
      },
    }),
    /1 legacy rows have no project_id/u,
  );
  assert.equal(remoteReads, 1);
});

test("Identity cutover rejects a symlinked receipt directory", async () => {
  const { target } = await loadTarget("mbza-development");
  const parent = await mkdtemp(join(tmpdir(), "opengrow-identity-link-"));
  const destination = await mkdtemp(
    join(tmpdir(), "opengrow-identity-link-target-"),
  );
  const linkedDirectory = join(parent, "receipts");
  await symlink(destination, linkedDirectory, "dir");
  await assert.rejects(
    verifyIdentityProjectCutover({
      target,
      targetName: "mbza-development",
      environment: "development",
      accountId,
      revision,
      receiptDirectory: linkedDirectory,
      execute: () => ({ status: 0, stdout: remoteEvidence() }),
    }),
    /real directory|symlink/u,
  );
});

function remoteEvidence(overrides = {}) {
  return JSON.stringify([
    {
      success: true,
      results: [
        {
          users: 0,
          identities: 0,
          sessions: 0,
          tokens: 0,
          migration_applied: 1,
          ...overrides,
        },
      ],
    },
  ]);
}
