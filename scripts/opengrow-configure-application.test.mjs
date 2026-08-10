import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTarget } from "./cloudflare-target.mjs";
import {
  applicationConfigurationUpdates,
  applyApplicationConfiguration,
  buildApplicationConfigurationPlan,
} from "./opengrow-configure-application.mjs";

test("application configuration plans public identities without hardcoded target data", async () => {
  const { target } = await loadTarget("mbza-development");
  const updates = applicationConfigurationUpdates({
    "google-audiences": "web-client.apps.googleusercontent.com",
    "apple-audiences": "dev.example.reference",
    "web-origins": "https://reference.example.dev",
    "support-project-ids": "42,7",
  });
  const plan = await buildApplicationConfigurationPlan({
    target,
    targetName: "sample-development",
    environment: "development",
    updates,
  });
  assert.equal(plan.changed, true);
  assert.deepEqual(plan.desired.supportProjectIds, [7, 42]);
  assert.deepEqual(plan.desired.webOrigins, ["https://reference.example.dev"]);
  assert.match(
    plan.confirmation,
    /^TARGET:CONFIGURE-APPLICATION:sample-development:development:[a-f0-9]{12}$/u,
  );
  assert.equal(
    Object.keys(plan.desired).some((field) => /secret/iu.test(field)),
    false,
  );
});

test("application configuration apply is exact-confirmed, atomic and schema-valid", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "opengrow-app-config-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const path = join(temporary, "target.json");
  const { target } = await loadTarget("mbza-development");
  await writeFile(path, JSON.stringify(target));
  const plan = await buildApplicationConfigurationPlan({
    target,
    targetName: "mbza-development",
    environment: "development",
    updates: {
      googleAudiences: ["web-client.apps.googleusercontent.com"],
      appleAudiences: ["dev.example.reference"],
      supportProjectIds: [73],
    },
  });
  await assert.rejects(
    () =>
      applyApplicationConfiguration({
        path,
        target,
        plan,
        confirm: "wrong",
      }),
    /Refusing target mutation/u,
  );
  const result = await applyApplicationConfiguration({
    path,
    target,
    plan,
    confirm: plan.confirmation,
  });
  assert.equal(result.applied, true);
  const updated = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(updated.applicationIdentity.googleAudiences, [
    "web-client.apps.googleusercontent.com",
  ]);
  assert.deepEqual(updated.environments.development.supportProjectIds, [73]);
});

test("application configuration refuses ambiguous clearing and unsafe origins", () => {
  assert.throws(
    () =>
      applicationConfigurationUpdates({
        "google-audiences": "client",
        "clear-google-audiences": true,
      }),
    /mutually exclusive/u,
  );
  assert.throws(
    () =>
      applicationConfigurationUpdates({
        "web-origins": "https://user@example.dev/path",
      }),
    /public HTTPS origins/u,
  );
  assert.throws(
    () =>
      applicationConfigurationUpdates({
        "support-project-ids": "0,invalid",
      }),
    /positive integers/u,
  );
});
