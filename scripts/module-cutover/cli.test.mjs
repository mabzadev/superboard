import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cli = resolve(repositoryRoot, "scripts/superboard-module-cutover.mjs");
const targetArgs = ["--target", "vocostar", "--environment", "production"];

test("backup-receipt hashes every required local export and attaches evidence to the window", () => {
  const directory = mkdtempSync(join(tmpdir(), "opengrow-cutover-cli-"));
  try {
    const names = ["legacy-api", "legacy-messaging", "module-app", "module-products", "module-paywalls", "module-dynamicLinks", "module-support", "module-marketing", "module-onboardings"];
    const databaseExports = names.map((name) => {
      const output = join(directory, `${name}.sql`);
      writeFileSync(output, `-- ${name}\nSELECT 1;\n`, { mode: 0o600 });
      return { name, command: ["npx", "wrangler", "d1", "export", name, "--remote", "--output", output] };
    });
    const backupPlanPath = join(directory, "backup-plan.json");
    const windowPath = join(directory, "window.json");
    const reportPath = join(directory, "receipt.json");
    writeFileSync(backupPlanPath, JSON.stringify({ project_ref: "10-prod", database_exports: databaseExports }));
    writeFileSync(windowPath, JSON.stringify({ schema_version: 1, project_ref: "10-prod", window_id: "window-1234" }));
    execFileSync(process.execPath, [cli, "backup-receipt", "--project-ref", "10-prod", "--backup-plan", backupPlanPath, "--window", windowPath, "--report", reportPath, ...targetArgs], {
      cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"],
    });
    const receipt = JSON.parse(readFileSync(reportPath, "utf8"));
    const window = JSON.parse(readFileSync(windowPath, "utf8"));
    assert.equal(receipt.artifacts.length, 9);
    assert.deepEqual(receipt.required_artifacts, names);
    assert.equal(receipt.artifacts.every((artifact) => artifact.bytes > 0 && /^[a-f0-9]{64}$/u.test(artifact.sha256)), true);
    assert.deepEqual(window.backup_receipt, receipt);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backup plans omit decommissioned legacy Messaging resources", async () => {
  const { createBackupPlan } = await import("./core.mjs");
  const report = createBackupPlan({
    target: "reference",
    environment: "development",
    projectRef: "1-test",
    resources: {
      d1: { name: "reference-api", id: "api-id" },
      moduleD1: { support: { name: "reference-support", id: "support-id" } },
    },
    workers: {
      api: { development: "reference-api" },
      support: { development: "reference-support" },
    },
    outputDirectory: "/secure/backups",
  });
  assert.deepEqual(report.database_exports.map(({ name }) => name), ["legacy-api", "module-support"]);
  assert.deepEqual(report.worker_versions.map(({ service }) => service), ["api", "support"]);
});

test("default plan remains offline unless --remote-read is supplied", () => {
  const output = execFileSync(process.execPath, [cli, "--project-ref", "10-test", "--modules", "app", ...targetArgs], {
    cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: "", CLOUDFLARE_API_TOKEN: "must-not-be-used" },
  });
  const report = JSON.parse(output);
  assert.equal(report.mode, "static-plan");
  assert.equal(report.remote_access_performed, false);
  assert.equal(report.project_ref, "10-test");
});

test("static plans can be restricted to explicit analytics entities", () => {
  const output = execFileSync(process.execPath, [cli, "plan", "--project-ref", "10-test", "--modules", "app,dynamic-links", "--entities", "app.customer_events,dynamic-links.analytics_events", ...targetArgs], {
    cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: "", CLOUDFLARE_API_TOKEN: "must-not-be-used" },
  });
  const report = JSON.parse(output);
  assert.deepEqual(report.entity_ids, ["app.customer_events", "dynamic-links.analytics_events"]);
  assert.deepEqual(report.entities.map((entity) => entity.id), report.entity_ids);
});

test("backup-plan covers both legacy D1s, all seven module D1s and every deployed Worker", () => {
  const output = execFileSync(process.execPath, [cli, "backup-plan", "--project-ref", "10-test", "--output-directory", "/secure/backups", ...targetArgs], {
    cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  const report = JSON.parse(output);
  assert.deepEqual(report.database_exports.map((item) => item.name).sort(), [
    "legacy-api", "legacy-messaging", "module-app", "module-dynamicLinks", "module-marketing",
    "module-onboardings", "module-paywalls", "module-products", "module-support",
  ]);
  assert.equal(new Set(report.worker_versions.map((item) => item.service)).has("dashboard"), true);
  assert.equal(report.database_exports.every((item) => item.command.includes("--remote")), true);
});

test("--apply cannot arm a read-only command", () => {
  const result = spawnSync(process.execPath, [cli, "plan", "--project-ref", "10-test", "--apply", ...targetArgs], {
    cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLOUDFLARE_API_TOKEN: "must-not-be-used" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--apply is not valid/u);
});

test("apply fails closed on a corrupt checkpoint instead of silently starting over", () => {
  const directory = mkdtempSync(join(tmpdir(), "opengrow-cutover-checkpoint-"));
  try {
    const windowId = "window-corrupt-checkpoint";
    const fixturePath = join(directory, "fixture.json");
    const windowPath = join(directory, "window.json");
    const checkpointPath = join(directory, "checkpoint.json");
    writeFileSync(fixturePath, JSON.stringify({
      project: { project_ref: "10-test", project_id: 12, instance_id: 10, environment: "test" },
      source_rows: {}, target_rows: {}, guard_rows: {},
      maintenance: { "10-test": { enabled: true, window_id: windowId } },
    }));
    writeFileSync(windowPath, JSON.stringify({
      schema_version: 1, window_id: windowId, project_ref: "10-test",
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: new Date(Date.now() + 600_000).toISOString(),
      reason: "test", approved_by: "test-suite",
    }));
    writeFileSync(checkpointPath, "{not-json");
    const result = spawnSync(process.execPath, [cli, "apply", "--project-ref", "10-test", "--fixture", fixturePath,
      "--window", windowPath, "--checkpoint", checkpointPath, "--apply", "--confirm", `CUTOVER:vocostar:10-test:${windowId}`, ...targetArgs], {
      cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unexpected token|Expected property name/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rollback planning rejects evidence from another project", () => {
  const directory = mkdtempSync(join(tmpdir(), "opengrow-cutover-rollback-"));
  try {
    const backupPath = join(directory, "backup.json");
    writeFileSync(backupPath, JSON.stringify({ project_ref: "10-prod", worker_versions: [], database_exports: [] }));
    const result = spawnSync(process.execPath, [cli, "rollback-plan", "--project-ref", "10-test", "--backup-plan", backupPath, ...targetArgs], {
      cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /project_ref mismatch/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
