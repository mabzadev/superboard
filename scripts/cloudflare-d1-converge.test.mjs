import assert from "node:assert/strict";
import test from "node:test";
import {
  applyD1Convergence,
  assertMigrationApplySafety,
  attachRemoteMigrationStatus,
  buildD1ConvergencePlan,
  migrationConfirmation,
  parseWranglerD1MigrationList,
} from "./cloudflare-d1-converge.mjs";
import { loadTarget } from "./cloudflare-target.mjs";
import { targetWithoutResourceIds } from "./cloudflare-test-fixtures.mjs";

test("D1 convergence plans every enabled schema owner without remote access", async () => {
  const { target: source } = await loadTarget("mbza-development");
  const target = targetWithoutResourceIds(source, "development");
  const plan = await buildD1ConvergencePlan({
    target,
    targetName: "mbza-development",
    environment: "development",
    serviceSelector: "all",
  });
  assert.equal(plan.mode, "plan");
  assert.equal(plan.ready, false);
  assert.equal(plan.remote_read, false);
  assert.equal(plan.converged, null);
  assert.equal(plan.pending_migration_count, null);
  assert.ok(
    plan.databases.every(
      ({ local_migration_count }) => local_migration_count > 0,
    ),
  );
  assert.equal(
    plan.databases.some(({ service }) => service === "billing"),
    false,
  );
  assert.equal(
    plan.databases.some(({ service }) => service === "messaging"),
    false,
  );
});

test("Wrangler D1 migration output becomes a strict structured status", () => {
  assert.deepEqual(
    parseWranglerD1MigrationList(
      "\u001b[32m✅ No migrations to apply!\u001b[0m",
    ),
    {
      converged: true,
      pending_migrations: [],
      pending_migration_count: 0,
    },
  );
  assert.deepEqual(
    parseWranglerD1MigrationList(`
      Migrations to be applied:
      ┌──────────────────────────────────────┐
      │ Name                                 │
      ├──────────────────────────────────────┤
      │ 0056_oauth_client_secret_overlap.sql │
      │ 0057_follow_up.sql                   │
      └──────────────────────────────────────┘
    `),
    {
      converged: false,
      pending_migrations: [
        "0056_oauth_client_secret_overlap.sql",
        "0057_follow_up.sql",
      ],
      pending_migration_count: 2,
    },
  );
  assert.throws(
    () => parseWranglerD1MigrationList("Wrangler completed without a table"),
    /unrecognized/u,
  );
  assert.throws(
    () =>
      parseWranglerD1MigrationList(`
        No migrations to apply!
        │ 0001_conflicting.sql │
      `),
    /ambiguous/u,
  );
});

test("remote D1 plans expose exact reviewed pending migrations and global convergence", async () => {
  const { target } = await loadTarget("mbza-development");
  const plan = await buildD1ConvergencePlan({
    target,
    targetName: "mbza-development",
    environment: "development",
    serviceSelector: "api,custom",
  });
  await attachRemoteMigrationStatus({
    plan,
    target,
    targetName: "mbza-development",
    environment: "development",
    serviceSelector: "api,custom",
    env: {},
    execute: (_command, args) => {
      if (!args.includes("list")) return { status: 0, stdout: "" };
      return args.includes("superboard-dev-db")
        ? {
            status: 0,
            stdout:
              "Migrations to be applied:\n│ Name │\n│ 0056_oauth_client_secret_overlap.sql │",
          }
        : { status: 0, stdout: "✅ No migrations to apply!" };
    },
  });
  assert.equal(plan.mode, "remote-plan");
  assert.equal(plan.remote_read, true);
  assert.equal(plan.converged, false);
  assert.equal(plan.pending_migration_count, 1);
  assert.deepEqual(
    plan.databases.map(({ service, remote_converged, pending_migrations }) => ({
      service,
      remote_converged,
      pending_migrations,
    })),
    [
      {
        service: "api",
        remote_converged: false,
        pending_migrations: ["0056_oauth_client_secret_overlap.sql"],
      },
      { service: "custom", remote_converged: true, pending_migrations: [] },
    ],
  );
});

test("remote D1 plans reject a migration outside the reviewed local chain", async () => {
  const { target } = await loadTarget("mbza-development");
  const plan = await buildD1ConvergencePlan({
    target,
    targetName: "mbza-development",
    environment: "development",
    serviceSelector: "api",
  });
  await assert.rejects(
    attachRemoteMigrationStatus({
      plan,
      target,
      targetName: "mbza-development",
      environment: "development",
      serviceSelector: "api",
      env: {},
      execute: (_command, args) =>
        args.includes("list")
          ? {
              status: 0,
              stdout:
                "Migrations to be applied:\n│ Name │\n│ 9999_unreviewed.sql │",
            }
          : { status: 0, stdout: "" },
    }),
    /outside the reviewed local chain/u,
  );
});

test("D1 mutation requires an exact confirmation and protected production backup", () => {
  const expected = migrationConfirmation("vocostar", "production", "support");
  assert.equal(expected, "MIGRATE:vocostar:production:support");
  assert.throws(
    () =>
      assertMigrationApplySafety({
        targetName: "vocostar",
        environment: "production",
        serviceSelector: "support",
        apply: true,
        confirm: expected,
      }),
    /backup-directory/u,
  );
  assert.throws(
    () =>
      assertMigrationApplySafety({
        targetName: "vocostar",
        environment: "production",
        serviceSelector: "support",
        apply: true,
        confirm: "wrong",
        backupDirectory: "/secure/backups",
      }),
    /pass --confirm/u,
  );
  assert.equal(
    assertMigrationApplySafety({
      targetName: "vocostar",
      environment: "production",
      serviceSelector: "support",
      apply: true,
      confirm: expected,
      backupDirectory: "/secure/backups",
    }),
    true,
  );
});

test("production convergence backs up every database before applying any migration", async () => {
  const { target: source } = await loadTarget("vocostar");
  const target = structuredClone(source);
  target.environments.production.moduleD1.support.id =
    "13171470-dfb5-46ce-b047-c9b151c34ae2";
  const events = [];
  const result = await applyD1Convergence({
    target,
    targetName: "vocostar",
    environment: "production",
    serviceSelector: "api,support",
    backupDirectory: "/secure/backups",
    env: {},
    now: new Date("2026-08-08T12:00:00.000Z"),
    execute: (command, args) => {
      const operation = args.includes("apply")
        ? "apply"
        : args.includes("list")
          ? "list"
          : "config";
      events.push(
        `${operation}:${args.includes("support") || args.some((value) => String(value).includes("support")) ? "support" : "api"}`,
      );
      return {
        status: 0,
        stdout: operation === "list" ? "No migrations to apply" : "",
      };
    },
    backup: async ({ descriptor }) => {
      events.push(`backup:${descriptor.service}`);
      return {
        paths: { receipt: `/secure/${descriptor.service}.receipt.json` },
        receipt: { artifact: { bytes: 10, sha256: "a".repeat(64) } },
      };
    },
  });
  const firstApply = events.findIndex((value) => value.startsWith("apply:"));
  assert.ok(events.indexOf("backup:api") < firstApply);
  assert.ok(events.indexOf("backup:support") < firstApply);
  assert.deepEqual(
    result.databases.map(({ service }) => service),
    ["api", "support"],
  );
  assert.equal(result.converged, true);
  assert.equal(result.pending_migration_count, 0);
  assert.ok(result.databases.every(({ converged }) => converged));
  assert.equal(result.backups.length, 2);
});

test("D1 apply fails closed when post-apply verification is not converged", async () => {
  const { target } = await loadTarget("mbza-development");
  await assert.rejects(
    applyD1Convergence({
      target,
      targetName: "mbza-development",
      environment: "development",
      serviceSelector: "custom",
      env: {},
      execute: (_command, args) =>
        args.includes("list")
          ? {
              status: 0,
              stdout:
                "Migrations to be applied:\n│ Name │\n│ 0002_reference_acceptance.sql │",
            }
          : { status: 0, stdout: "" },
    }),
    /migration verification still reports/u,
  );
});
