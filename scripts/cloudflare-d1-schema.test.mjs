import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  localMigrationFiles,
  targetD1Descriptors,
} from "./cloudflare-d1-registry.mjs";
import { loadTarget } from "./cloudflare-target.mjs";

const targetsDirectory = fileURLToPath(
  new URL("../deploy/targets/", import.meta.url),
);

test("every enabled target D1 owner builds a healthy fresh schema", async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "opengrow-target-schemas-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));

  const descriptors = [];
  const targetNames = readdirSync(targetsDirectory)
    .filter((filename) => filename.endsWith(".json") && filename !== "schema.json")
    .map((filename) => filename.slice(0, -".json".length))
    .sort();
  assert.ok(targetNames.length > 0, "No deployment target was found");

  for (const targetName of targetNames) {
    const { target } = await loadTarget(targetName);
    for (const environment of Object.keys(target.environments)) {
      descriptors.push(
        ...targetD1Descriptors(target, targetName, environment),
      );
    }
  }

  const uniqueOwners = new Map();
  for (const descriptor of descriptors) {
    uniqueOwners.set(descriptor.migrationsPath, descriptor);
  }

  assert.ok(uniqueOwners.size > 0, "No enabled target owns a D1 schema");
  for (const descriptor of uniqueOwners.values()) {
    await t.test(
      `${descriptor.service}: ${descriptor.migrationsDirectory}`,
      async () => {
        const safeName = descriptor.migrationsDirectory.replaceAll(/[^a-z0-9]+/giu, "-");
        const database = join(temporary, `${safeName}.sqlite`);
        const files = await localMigrationFiles(descriptor);
        for (const filename of files) {
          assert.doesNotThrow(
            () => execFileSync("sqlite3", [database], {
              input: readFileSync(join(descriptor.migrationsPath, filename)),
              stdio: ["pipe", "pipe", "pipe"],
            }),
            `${descriptor.migrationsDirectory}/${filename}`,
          );
        }

        assert.equal(query(database, "PRAGMA integrity_check"), "ok");
        assert.equal(query(database, "PRAGMA foreign_key_check"), "");
        assert.ok(
          Number(query(
            database,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )) > 0,
          `${descriptor.migrationsDirectory} created no application table`,
        );
      },
    );
  }
});

function query(database, sql) {
  return execFileSync("sqlite3", [database, sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
