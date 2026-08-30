import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  FLOWS_VERSION_SECRET_NAMES,
  buildFlowsVersionBundlePlan,
  buildFlowsVersionSecrets,
  flowsObsoleteSecretBulkArgs,
  flowsVersionUploadArgs,
  parseExistingFlowsSecrets,
  prepareFlowsObsoleteSecretsFile,
  prepareFlowsVersionSecretsFile,
  readProtectedFlowUserHashKey,
} from "./cloudflare-flows-version-bundle.mjs";
import { loadTarget, root } from "./cloudflare-target.mjs";

const TOKEN = "t".repeat(48);
const ENCRYPTION = "e".repeat(48);
const HASH = "h".repeat(48);

test("Flows version plan is MBZA-only, value-free and never includes Email in the bundle", async () => {
  const { target } = await loadTarget("mbza-development");
  const plan = buildFlowsVersionBundlePlan({
    target,
    targetName: "mbza-development",
    environment: "development",
  });
  assert.equal(plan.valuesIncluded, false);
  assert.equal(plan.promotionIncluded, false);
  assert.equal(plan.remoteMutationIncluded, false);
  assert.deepEqual(plan.reusedSecrets, [
    "INTERNAL_API_TOKEN",
    "FLOW_USER_ENCRYPTION_KEY",
  ]);
  assert.deepEqual(plan.generatedOnce, ["FLOW_USER_HASH_KEY"]);
  assert.deepEqual(plan.forbiddenSecrets, ["EMAIL_INTERNAL_TOKEN"]);
  assert.equal(JSON.stringify(plan).includes(TOKEN), false);
  assert.deepEqual(plan.uploadCommand.slice(0, 4), [
    "npx",
    "wrangler",
    "versions",
    "upload",
  ]);
  assert.ok(plan.uploadCommand.includes("--secrets-file"));
  assert.ok(plan.uploadCommand.includes("--strict"));
  assert.equal(plan.uploadCommand.includes("--dry-run"), false);
  assert.ok(plan.dryRunCommand.includes("--dry-run"));
  assert.deepEqual(plan.obsoleteRemoteSecrets, ["EMAIL_INTERNAL_TOKEN"]);
  assert.deepEqual(plan.postUploadInactiveCleanupCommand.slice(0, 5), [
    "npx",
    "wrangler",
    "versions",
    "secret",
    "bulk",
  ]);
  assert.ok(plan.postUploadInactiveCleanupCommand.includes(plan.obsoleteSecretsFile));
  assert.equal(plan.postUploadInactiveCleanupCommand.includes("--tag"), true);
  assert.equal(plan.deployOnlyCleanupVersion, true);

  const { target: vocostar } = await loadTarget("vocostar");
  assert.throws(
    () => buildFlowsVersionBundlePlan({
      target: vocostar,
      targetName: "vocostar",
      environment: "production",
    }),
    /restricted to enabled MBZA development/u,
  );
});

test("bundle reuses two existing values and generates one stable distinct hash key", () => {
  let generated = 0;
  const first = buildFlowsVersionSecrets({
    existingSecrets: {
      INTERNAL_API_TOKEN: TOKEN,
      FLOW_USER_ENCRYPTION_KEY: ENCRYPTION,
    },
    generateHashKey: () => {
      generated += 1;
      return HASH;
    },
  });
  const second = buildFlowsVersionSecrets({
    existingSecrets: {
      INTERNAL_API_TOKEN: TOKEN,
      FLOW_USER_ENCRYPTION_KEY: ENCRYPTION,
    },
    preparedSecrets: first,
    generateHashKey: () => {
      generated += 1;
      return "x".repeat(48);
    },
  });
  assert.deepEqual(Object.keys(first), [...FLOWS_VERSION_SECRET_NAMES]);
  assert.equal(first.INTERNAL_API_TOKEN, TOKEN);
  assert.equal(first.FLOW_USER_ENCRYPTION_KEY, ENCRYPTION);
  assert.equal(first.FLOW_USER_HASH_KEY, HASH);
  assert.deepEqual(second, first);
  assert.equal(generated, 1);
});

test("Email, unknown names, short values and changed existing secrets fail closed", () => {
  assert.throws(
    () => parseExistingFlowsSecrets(JSON.stringify({
      INTERNAL_API_TOKEN: TOKEN,
      FLOW_USER_ENCRYPTION_KEY: ENCRYPTION,
      EMAIL_INTERNAL_TOKEN: "m".repeat(48),
    })),
    /forbidden/u,
  );
  assert.throws(
    () => parseExistingFlowsSecrets(JSON.stringify({
      INTERNAL_API_TOKEN: TOKEN,
      FLOW_USER_ENCRYPTION_KEY: ENCRYPTION,
      UNKNOWN: "u".repeat(48),
    })),
    /Unexpected/u,
  );
  assert.throws(
    () => parseExistingFlowsSecrets(JSON.stringify({
      INTERNAL_API_TOKEN: "short",
      FLOW_USER_ENCRYPTION_KEY: ENCRYPTION,
    })),
    /unsafe byte length/u,
  );
  assert.throws(
    () => buildFlowsVersionSecrets({
      existingSecrets: {
        INTERNAL_API_TOKEN: TOKEN,
        FLOW_USER_ENCRYPTION_KEY: ENCRYPTION,
      },
      preparedSecrets: {
        INTERNAL_API_TOKEN: "z".repeat(48),
        FLOW_USER_ENCRYPTION_KEY: ENCRYPTION,
        FLOW_USER_HASH_KEY: HASH,
      },
    }),
    /differs from the already prepared/u,
  );
});

test("prepared bundle is 0600, stays stable and receipt data has no values", async (t) => {
  const protectedBase = resolve(root, ".flows-cutover", "secrets");
  await mkdir(protectedBase, { recursive: true, mode: 0o700 });
  await chmod(resolve(root, ".flows-cutover"), 0o700);
  await chmod(protectedBase, 0o700);
  const directory = await mkdtemp(join(protectedBase, "test-"));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "existing.json");
  const output = join(directory, "flows-version.json");
  const cleanup = join(directory, "flows-version.remove-obsolete.json");
  await writeFile(source, JSON.stringify({
    INTERNAL_API_TOKEN: TOKEN,
    FLOW_USER_ENCRYPTION_KEY: ENCRYPTION,
  }), { mode: 0o600 });
  await chmod(source, 0o600);
  let generated = 0;
  const first = await prepareFlowsVersionSecretsFile({
    existingSecretsFile: source,
    outputPath: output,
    generateHashKey: () => {
      generated += 1;
      return HASH;
    },
  });
  const second = await prepareFlowsVersionSecretsFile({
    existingSecretsFile: source,
    outputPath: output,
    generateHashKey: () => {
      generated += 1;
      return "x".repeat(48);
    },
  });
  const cleanupFirst = await prepareFlowsObsoleteSecretsFile({
    outputPath: cleanup,
  });
  const cleanupSecond = await prepareFlowsObsoleteSecretsFile({
    outputPath: cleanup,
  });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(generated, 1);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  assert.equal(cleanupFirst.created, true);
  assert.equal(cleanupSecond.created, false);
  assert.equal((await stat(cleanup)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(cleanup, "utf8")), {
    EMAIL_INTERNAL_TOKEN: null,
  });
  await writeFile(cleanup, JSON.stringify({
    EMAIL_INTERNAL_TOKEN: null,
    UNKNOWN: null,
  }), { mode: 0o600 });
  await assert.rejects(
    prepareFlowsObsoleteSecretsFile({ outputPath: cleanup }),
    /must contain only EMAIL_INTERNAL_TOKEN set to null/u,
  );
  const stored = JSON.parse(await readFile(output, "utf8"));
  assert.deepEqual(stored, {
    INTERNAL_API_TOKEN: TOKEN,
    FLOW_USER_ENCRYPTION_KEY: ENCRYPTION,
    FLOW_USER_HASH_KEY: HASH,
  });
  const receipt = JSON.stringify(second);
  assert.equal(receipt.includes(TOKEN), false);
  assert.equal(receipt.includes(ENCRYPTION), false);
  assert.equal(receipt.includes(HASH), false);
  assert.equal(await readProtectedFlowUserHashKey(output), HASH);
});

test("secret bundle paths cannot escape the ignored protected directory", () => {
  assert.throws(
    () => flowsVersionUploadArgs({
      config: "/tmp/flows.jsonc",
      secretsFile: "/tmp/flows-secrets.json",
      versionTag: "mbza-flows-test-v1",
    }),
    /below/u,
  );
  assert.throws(
    () => flowsObsoleteSecretBulkArgs({
      config: "/tmp/flows.jsonc",
      worker: "unsafe worker",
      versionTag: "mbza-flows-test-without-email",
      obsoleteSecretsFile: resolve(
        root,
        ".flows-cutover",
        "secrets",
        "remove-obsolete.json",
      ),
    }),
    /Worker name is invalid/u,
  );
});
