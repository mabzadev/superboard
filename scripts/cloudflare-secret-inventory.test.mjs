import assert from "node:assert/strict";
import test from "node:test";
import {
  requiredSecretInventory,
  secretCoordinationPlan,
  secretInventory,
} from "./cloudflare-secret-inventory.mjs";
import { loadTarget } from "./cloudflare-target.mjs";

test("secret inventory includes enabled common and target-specific contracts only", async () => {
  const { target } = await loadTarget("mbza-development");
  const inventory = secretInventory(target);
  assert.equal(
    inventory.some(({ service }) => service === "messaging"),
    false,
  );
  assert.ok(
    inventory
      .find(({ service }) => service === "api")
      ?.names.includes("JWT_SECRET"),
  );
  assert.deepEqual(
    inventory.find(({ service }) => service === "custom")?.names,
    ["CUSTOM_WORKER_TOKEN", "CUSTOM_WORKER_TOKEN_PREVIOUS"],
  );
  assert.ok(
    inventory
      .find(({ service }) => service === "support")
      ?.names.includes("SUPPORT_WEBHOOK_ENCRYPTION_KEY"),
  );
});

test("secret coordination covers every required binding without values", async () => {
  for (const [targetName, environment] of [
    ["mbza-development", "development"],
    ["vocostar", "production"],
  ]) {
    const { target } = await loadTarget(targetName);
    const requirements = requiredSecretInventory(target, environment);
    const plan = secretCoordinationPlan(target, environment);
    const expected = requirements.reduce(
      (total, requirement) =>
        total + requirement.names.length + requirement.alternatives.length,
      0,
    );
    assert.equal(plan.valuesIncluded, false);
    assert.equal(plan.summary.requiredBindings, expected);
    assert.equal(
      plan.contracts.flatMap((contract) => contract.members).length,
      expected,
    );
    assert.equal(JSON.stringify(plan).includes("secret-value"), false);
  }
});

test("analytics query credentials are optional in development and required in production", async () => {
  const development = (await loadTarget("mbza-development")).target;
  const production = (await loadTarget("vocostar")).target;
  assert.deepEqual(
    requiredSecretInventory(development, "development").find(
      ({ service }) => service === "observability",
    ).names,
    ["OBSERVABILITY_INTERNAL_TOKEN"],
  );
  assert.deepEqual(
    requiredSecretInventory(production, "production").find(
      ({ service }) => service === "observability",
    ).names,
    [
      "OBSERVABILITY_INTERNAL_TOKEN",
      "CLOUDFLARE_ANALYTICS_ACCOUNT_ID",
      "CLOUDFLARE_ANALYTICS_TOKEN",
    ],
  );
});

test("managed Worker secrets are application-specific and value-free", async () => {
  const { target } = await loadTarget("vocostar");
  const inventory = secretInventory(target);
  const vocals = inventory.find(
    ({ service }) => service === "managed-vocals-orchestrator",
  );
  assert.deepEqual(vocals.names, [
    "MODAL_API_KEY",
    "GATEWAY_INTERNAL_TOKEN",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ]);
  const contract = secretCoordinationPlan(target, "production").contracts.find(
    ({ id }) => id === "managed-vocals-orchestrator-modal-api-key",
  );
  assert.equal(contract.scope, "application-specific");
  assert.equal(contract.source, "application-specific-operator-or-provider");
  const gatewayContract = secretCoordinationPlan(
    target,
    "production",
  ).contracts.find(({ id }) => id === "managed-worker-gateway-callback-token");
  assert.equal(gatewayContract.sameValueRequired, true);
  assert.deepEqual(gatewayContract.externalPeers, [
    "api-auth-gateway/INTERNAL_CALLBACK_TOKEN",
  ]);
  assert.deepEqual(
    gatewayContract.members.map(({ service, name }) => ({ service, name })),
    [
      {
        service: "managed-vocals-orchestrator",
        name: "GATEWAY_INTERNAL_TOKEN",
      },
      {
        service: "managed-medias-orchestrator",
        name: "GATEWAY_INTERNAL_TOKEN",
      },
    ],
  );
  assert.equal(
    secretCoordinationPlan(target, "production").contracts.find(
      ({ id }) => id === "managed-vocals-orchestrator-gateway-internal-token",
    ),
    undefined,
  );
});

test("shared production contracts identify both ends and environment-specific billing ownership", async () => {
  const development = (await loadTarget("mbza-development")).target;
  const production = (await loadTarget("vocostar")).target;
  const developmentPlan = secretCoordinationPlan(development, "development");
  const productionPlan = secretCoordinationPlan(production, "production");

  assert.deepEqual(
    productionPlan.contracts
      .find(({ id }) => id === "email-internal-token")
      .members.map(({ service }) => service),
    ["api", "email", "identity", "marketing"],
  );
  assert.equal(productionPlan.summary.overlapCapableContracts, 5);
  assert.equal(
    productionPlan.contracts
      .find(({ id }) => id === "module-internal-token")
      .members.filter(({ previousName }) => previousName)
      .every(
        ({ previousName }) => previousName === "INTERNAL_API_TOKEN_PREVIOUS",
      ),
    true,
  );
  assert.deepEqual(
    productionPlan.contracts
      .find(({ id }) => id === "custom-worker-internal-token")
      .members.map(({ service }) => service),
    ["api", "custom"],
  );
  assert.deepEqual(
    productionPlan.contracts
      .find(({ id }) => id === "entitlement-webhook-secret")
      .members.map(({ service }) => service),
    ["billing"],
  );
  assert.deepEqual(
    developmentPlan.contracts
      .find(({ id }) => id === "entitlement-webhook-secret")
      .members.map(({ service }) => service),
    ["api", "billing"],
  );
});

test("SMTP and target extension secrets have explicit provenance", async () => {
  const target = (await loadTarget("vocostar")).target;
  const plan = secretCoordinationPlan(target, "production");
  assert.equal(
    plan.contracts.find(({ id }) => id === "email-smtp-password").source,
    "external-mail-provider-credential",
  );
  assert.equal(
    plan.contracts.find(({ id }) => id === "custom-custom-worker-token"),
    undefined,
  );
  assert.equal(
    plan.contracts.find(({ id }) => id === "custom-worker-internal-token")
      .scope,
    "application-specific",
  );
});
