import assert from "node:assert/strict";
import test from "node:test";
import {
  superboardEnvironmentContract,
  superboardEnvironmentValue,
} from "./superboard-environment.mjs";

test("canonical SuperBoard variables take precedence over legacy fallbacks", () => {
  const env = {
    SUPERBOARD_TARGET: "vocostar",
    OPENGROW_TARGET: "mbza-development",
    SUPERBOARD_ENVIRONMENT: "production",
    OPENGROW_ENVIRONMENT: "development",
    SUPERBOARD_RELEASE: "new-release",
    OPENGROW_RELEASE: "old-release",
    SUPERBOARD_REFERENCE_REPOSITORY: "mbzadev/superboard-reference",
    OPENGROW_REFERENCE_REPOSITORY: "mbzadev/opengrow-reference",
    SUPERBOARD_REFERENCE_ROOT: "/contracts/superboard-reference",
    OPENGROW_REFERENCE_ROOT: "/contracts/opengrow-reference",
    SUPERBOARD_REFERENCE_DISPATCH_TOKEN: "new-dispatch-token",
    OPENGROW_REFERENCE_DISPATCH_TOKEN: "old-dispatch-token",
    SUPERBOARD_BACKUP_ENCRYPTION_KEY: "new-backup-key",
    OPENGROW_BACKUP_ENCRYPTION_KEY: "old-backup-key",
  };
  assert.equal(
    superboardEnvironmentValue("SUPERBOARD_TARGET", env),
    "vocostar",
  );
  assert.equal(
    superboardEnvironmentValue("SUPERBOARD_ENVIRONMENT", env),
    "production",
  );
  assert.equal(
    superboardEnvironmentValue("SUPERBOARD_RELEASE", env),
    "new-release",
  );
  assert.equal(
    superboardEnvironmentValue("SUPERBOARD_REFERENCE_REPOSITORY", env),
    "mbzadev/superboard-reference",
  );
  assert.equal(
    superboardEnvironmentValue("SUPERBOARD_REFERENCE_ROOT", env),
    "/contracts/superboard-reference",
  );
  assert.equal(
    superboardEnvironmentValue("SUPERBOARD_REFERENCE_DISPATCH_TOKEN", env),
    "new-dispatch-token",
  );
  assert.equal(
    superboardEnvironmentValue("SUPERBOARD_BACKUP_ENCRYPTION_KEY", env),
    "new-backup-key",
  );
});

test("legacy OpenGrow variables remain read-only fallbacks", () => {
  const env = {
    OPENGROW_TARGET: "mbza-development",
    OPENGROW_ENVIRONMENT: "development",
    OPENGROW_RELEASE: "legacy-release",
    OPENGROW_REFERENCE_REPOSITORY: "mbzadev/opengrow-reference",
    OPENGROW_REFERENCE_ROOT: "/contracts/opengrow-reference",
    OPENGROW_REFERENCE_DISPATCH_TOKEN: "old-dispatch-token",
    OPENGROW_BACKUP_ENCRYPTION_KEY: "old-backup-key",
  };
  assert.equal(
    superboardEnvironmentValue("SUPERBOARD_TARGET", env),
    "mbza-development",
  );
  assert.equal(
    superboardEnvironmentValue("SUPERBOARD_ENVIRONMENT", env),
    "development",
  );
  assert.equal(
    superboardEnvironmentValue("SUPERBOARD_RELEASE", env),
    "legacy-release",
  );
  assert.equal(
    superboardEnvironmentValue("SUPERBOARD_REFERENCE_REPOSITORY", env),
    "mbzadev/opengrow-reference",
  );
  assert.equal(
    superboardEnvironmentValue("SUPERBOARD_REFERENCE_ROOT", env),
    "/contracts/opengrow-reference",
  );
  assert.equal(
    superboardEnvironmentValue("SUPERBOARD_REFERENCE_DISPATCH_TOKEN", env),
    "old-dispatch-token",
  );
  assert.equal(
    superboardEnvironmentValue("SUPERBOARD_BACKUP_ENCRYPTION_KEY", env),
    "old-backup-key",
  );
  assert.equal(
    superboardEnvironmentContract(env).SUPERBOARD_TARGET.source,
    "OPENGROW_TARGET",
  );
});

test("unset or unknown variables fail safely", () => {
  assert.equal(superboardEnvironmentValue("SUPERBOARD_TARGET", {}), undefined);
  assert.throws(
    () => superboardEnvironmentValue("UNDECLARED", {}),
    /Unknown SuperBoard environment variable/u,
  );
});
