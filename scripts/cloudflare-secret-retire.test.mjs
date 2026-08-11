import assert from "node:assert/strict";
import test from "node:test";
import {
  attachRetirementRemoteState,
  buildSecretRetirementPlan,
  retirementConfirmation,
  retirementDeleteArgs,
} from "./cloudflare-secret-retire.mjs";
import {
  attachPromotionRemoteState,
  buildPromotionCompleteReceipt,
  validateSecretUploadReceipt,
} from "./cloudflare-secret-promote.mjs";
import {
  buildSecretBundlePlan,
  buildSecretUploadReceipt,
  secretVersionTag,
} from "./cloudflare-secret-bundle.mjs";
import { loadTarget } from "./cloudflare-target.mjs";

const ACCOUNT_ID = "4fec11873e7130ab0e44e795e3e3afd3";
const uuid = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

async function fixture() {
  const { target } = await loadTarget("vocostar");
  const bundle = buildSecretBundlePlan({
    target,
    targetName: "vocostar",
    environment: "production",
    contractIds: ["email-internal-token"],
    overlap: true,
  });
  const serviceNames = new Map();
  for (const member of bundle.contracts.flatMap(({ members }) => members)) {
    const names = serviceNames.get(member.service) ?? [];
    names.push(member.name);
    if (member.previousName) names.push(member.previousName);
    serviceNames.set(member.service, names);
  }
  const upload = buildSecretUploadReceipt(
    bundle,
    [...serviceNames].map(([service, names]) => ({
      service,
      worker: target.workers[service].production,
      names,
      strategy: "inactive-version",
      versionTag: secretVersionTag(bundle, service),
    })),
  );
  const structural = validateSecretUploadReceipt({
    target,
    targetName: "vocostar",
    environment: "production",
    receipt: upload,
  });
  const remote = Object.fromEntries(structural.services.map((service, index) => [
    service.service,
    {
      deployment: {
        versions: [{ version_id: uuid(String(index + 10)), percentage: 100 }],
      },
      versions: [{
        id: uuid(String(index + 20)),
        annotations: { "workers/tag": service.versionTag },
      }],
    },
  ]));
  const promotion = attachPromotionRemoteState(structural, remote, ACCOUNT_ID);
  return {
    target,
    receipt: buildPromotionCompleteReceipt(
      promotion,
      promotion.services,
      new Date("2026-08-09T10:00:00.000Z"),
    ),
  };
}

test("retirement waits for overlap and removes only consumer previous bindings", async () => {
  const { target, receipt } = await fixture();
  const early = buildSecretRetirementPlan({
    target,
    targetName: "vocostar",
    environment: "production",
    receipt,
    now: new Date("2026-08-09T10:29:59.000Z"),
  });
  assert.equal(early.blockers[0].id, "overlap-observation-window");

  const structural = buildSecretRetirementPlan({
    target,
    targetName: "vocostar",
    environment: "production",
    receipt,
    now: new Date("2026-08-09T10:30:00.000Z"),
  });
  assert.equal(structural.blockers.length, 0);
  assert.deepEqual(
    structural.services.map(({ service }) => service),
    ["email"],
  );
  assert.deepEqual(
    structural.services[0].names.map(({ name }) => name),
    ["EMAIL_INTERNAL_TOKEN_PREVIOUS"],
  );

  const remote = Object.fromEntries(receipt.workers.map((worker) => [
    worker.service,
    {
      deployment: {
        versions: [{ version_id: worker.versionId, percentage: 100 }],
      },
      versions: [],
    },
  ]));
  const plan = attachRetirementRemoteState(structural, remote, ACCOUNT_ID);
  assert.equal(plan.confirmation, retirementConfirmation(plan));
  assert.equal(plan.services[0].names[0].strategy, "create-inactive-version");
  assert.deepEqual(
    retirementDeleteArgs(plan.services[0], plan.services[0].names[0], "retire"),
    [
      "wrangler", "versions", "secret", "delete",
      "EMAIL_INTERNAL_TOKEN_PREVIOUS",
      "--name", "opengrow-email",
      "--message", "retire",
      "--tag", plan.services[0].names[0].versionTag,
    ],
  );
});

test("retirement is bound to the exact promoted versions and account", async () => {
  const { target, receipt } = await fixture();
  const structural = buildSecretRetirementPlan({
    target,
    targetName: "vocostar",
    environment: "production",
    receipt,
    now: new Date("2026-08-09T11:00:00.000Z"),
  });
  const remote = Object.fromEntries(receipt.workers.map((worker) => [
    worker.service,
    {
      deployment: {
        versions: [{ version_id: worker.versionId, percentage: 100 }],
      },
      versions: [],
    },
  ]));
  remote.api.deployment.versions[0].version_id = uuid("999");
  assert.throws(
    () => attachRetirementRemoteState(structural, remote, ACCOUNT_ID),
    /exact promoted overlap version/u,
  );
  assert.throws(
    () => attachRetirementRemoteState(
      structural,
      Object.fromEntries(receipt.workers.map((worker) => [
        worker.service,
        {
          deployment: {
            versions: [{ version_id: worker.versionId, percentage: 100 }],
          },
          versions: [],
        },
      ])),
      "8706f1b6760214ae04dad8c10116be36",
    ),
    /another Cloudflare account/u,
  );
});
