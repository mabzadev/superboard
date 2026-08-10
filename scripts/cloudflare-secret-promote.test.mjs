import assert from "node:assert/strict";
import test from "node:test";
import {
  attachPromotionRemoteState,
  buildPromotionCompleteReceipt,
  overlapOrderBlockers,
  promotionArgs,
  promotionConfirmation,
  validateSecretUploadReceipt,
} from "./cloudflare-secret-promote.mjs";
import {
  buildSecretBundlePlan,
  buildSecretUploadReceipt,
  secretVersionTag,
} from "./cloudflare-secret-bundle.mjs";
import { loadTarget } from "./cloudflare-target.mjs";

const uuid = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

async function fixture(contractIds) {
  const { target } = await loadTarget("vocostar");
  const bundlePlan = buildSecretBundlePlan({
    target,
    targetName: "vocostar",
    environment: "production",
    contractIds,
  });
  const services = [...new Set(bundlePlan.contracts.flatMap(({ members }) =>
    members.map(({ service }) => service)
  ))].map((service) => ({
    service,
    worker: target.workers[service].production,
    names: bundlePlan.contracts.flatMap(({ members }) => members)
      .filter((member) => member.service === service)
      .map((member) => member.name ?? member.oneOf[0]),
    strategy: "inactive-version",
    versionTag: secretVersionTag(bundlePlan, service),
  }));
  return {
    target,
    receipt: buildSecretUploadReceipt(bundlePlan, services),
  };
}

test("promotion validates receipt and orders consumers before API", async () => {
  const { target, receipt } = await fixture(["email-internal-token"]);
  const blocked = validateSecretUploadReceipt({
    target,
    targetName: "vocostar",
    environment: "production",
    receipt,
  });
  assert.equal(blocked.blockers[0].id, "shared-secret-non-atomic-cutover");
  assert.deepEqual(
    blocked.services.map(({ service }) => service),
    ["email", "identity", "api"],
  );
  const approved = validateSecretUploadReceipt({
    target,
    targetName: "vocostar",
    environment: "production",
    receipt,
    acceptSharedCutover: true,
  });
  assert.equal(approved.blockers.length, 0);
});

test("overlap-capable shared token promotion needs no maintenance override", async () => {
  const { target } = await loadTarget("vocostar");
  const bundlePlan = buildSecretBundlePlan({
    target,
    targetName: "vocostar",
    environment: "production",
    contractIds: ["email-internal-token"],
    overlap: true,
  });
  const services = [...new Set(bundlePlan.contracts.flatMap(({ members }) =>
    members.map(({ service }) => service)
  ))].map((service) => ({
    service,
    worker: target.workers[service].production,
    names: bundlePlan.contracts.flatMap(({ members }) => members)
      .filter((member) => member.service === service)
      .flatMap((member) => [
        member.name,
        ...(member.previousName ? [member.previousName] : []),
      ]),
    strategy: "inactive-version",
    versionTag: secretVersionTag(bundlePlan, service),
  }));
  const receipt = buildSecretUploadReceipt(bundlePlan, services);
  const promotion = validateSecretUploadReceipt({
    target,
    targetName: "vocostar",
    environment: "production",
    receipt,
  });
  assert.equal(promotion.overlap, true);
  assert.equal(promotion.blockers.length, 0);
  assert.deepEqual(
    promotion.services.map(({ service }) => service),
    ["email", "identity", "api"],
  );
  assert.equal(
    overlapOrderBlockers(bundlePlan, [...promotion.services].reverse())[0].id,
    "overlap-promotion-order-unsafe",
  );
});

test("promotion plan binds exact inactive and rollback versions", async () => {
  const { target, receipt } = await fixture(["api-push-process-key"]);
  const structural = validateSecretUploadReceipt({
    target,
    targetName: "vocostar",
    environment: "production",
    receipt,
  });
  const service = structural.services[0];
  const inactiveId = uuid("1");
  const rollbackId = uuid("2");
  const plan = attachPromotionRemoteState(structural, {
    api: {
      deployment: {
        versions: [{ version_id: rollbackId, percentage: 100 }],
      },
      versions: [{
        id: inactiveId,
        annotations: { "workers/tag": service.versionTag },
      }],
    },
  }, "4fec11873e7130ab0e44e795e3e3afd3");
  assert.equal(plan.services[0].versionId, inactiveId);
  assert.equal(plan.services[0].rollbackVersionId, rollbackId);
  assert.equal(plan.confirmation, promotionConfirmation(plan));
  assert.deepEqual(
    promotionArgs(plan.services[0], inactiveId, "promotion"),
    [
      "wrangler", "versions", "deploy",
      "--name", "opengrow-api",
      "--version-id", inactiveId,
      "--percentage", "100",
      "--message", "promotion",
      "--yes",
    ],
  );
  const complete = buildPromotionCompleteReceipt(
    plan,
    plan.services,
    new Date("2026-08-09T10:00:00.000Z"),
  );
  assert.equal(complete.valuesIncluded, false);
  assert.equal(complete.overlap, false);
  assert.equal(complete.promotedAt, "2026-08-09T10:00:00.000Z");
  assert.deepEqual(complete.contracts, ["api-push-process-key"]);
});

test("promotion rejects tampered receipt and unsafe remote state", async () => {
  const { target, receipt } = await fixture(["api-push-process-key"]);
  const tampered = structuredClone(receipt);
  tampered.services[0].worker = "wrong-worker";
  assert.throws(
    () => validateSecretUploadReceipt({
      target,
      targetName: "vocostar",
      environment: "production",
      receipt: tampered,
    }),
    /Worker mismatch/u,
  );
  const unexpectedName = structuredClone(receipt);
  unexpectedName.services[0].names = ["UNEXPECTED_NAME"];
  assert.throws(
    () => validateSecretUploadReceipt({
      target,
      targetName: "vocostar",
      environment: "production",
      receipt: unexpectedName,
    }),
    /names are incomplete/u,
  );
  const structural = validateSecretUploadReceipt({
    target,
    targetName: "vocostar",
    environment: "production",
    receipt,
  });
  assert.throws(
    () => attachPromotionRemoteState(structural, {
      api: {
        deployment: { versions: [{ version_id: uuid("2"), percentage: 50 }] },
        versions: [],
      },
    }, "4fec11873e7130ab0e44e795e3e3afd3"),
    /exactly one 100%/u,
  );
});
