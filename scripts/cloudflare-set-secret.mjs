#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  environmentFromArgs,
  loadTarget,
  parseArgs,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";
import {
  DOMAIN_SERVICES,
  DOMAIN_SERVICE_REGISTRY,
  PLATFORM_SERVICE_SECRETS,
  assertService,
} from "./cloudflare-services.mjs";
import { secretCoordinationPlan } from "./cloudflare-secret-inventory.mjs";

/**
 * Resolve a legacy service/name pair to the one logical contract that owns it.
 * No value is accepted here: single-binding writes cannot preserve shared-secret
 * invariants and `wrangler secret put` would deploy immediately.
 */
export function buildLegacySecretReplacement({
  target,
  targetName,
  environment,
  service,
  secretName,
}) {
  assertDeclaredSecret(target, service, secretName);
  if (!target.environments?.[environment]) {
    throw new Error(`${targetName} does not define ${environment}`);
  }
  const contract = secretCoordinationPlan(target, environment).contracts.find(
    ({ members }) => members.some((member) =>
      member.service === service && (
        member.name === secretName || member.oneOf?.includes(secretName)
      )
    ),
  );
  if (!contract) {
    throw new Error(
      `${secretName} is declared for ${service} but is not required by ${targetName}/${environment}; ` +
        "declare the requirement in the target secret inventory before provisioning it",
    );
  }
  const oauth = contract.id === "dashboard-client-secret";
  return {
    schemaVersion: 1,
    mode: "disabled-single-binding-secret-upload",
    mutationPerformed: false,
    valuesRead: false,
    reason:
      "A single Worker secret update can immediately deploy a partial or unpaired value.",
    target: targetName,
    environment,
    requestedBinding: { service, name: secretName },
    owningContract: {
      id: contract.id,
      sameValueRequired: contract.sameValueRequired,
      members: contract.members,
    },
    replacement: oauth
      ? {
          command:
            `npm run cloudflare:rotate-oauth -- --target ${targetName} ` +
            `--environment ${environment}`,
          reason: "Dashboard OAuth must rotate its Worker secret and D1 verifier together.",
        }
      : {
          command:
            `npm run cloudflare:secrets:upload -- --target ${targetName} ` +
            `--environment ${environment} --contracts ${contract.id}`,
          reason: "The coordinated uploader expands the value to every contract member.",
        },
  };
}

function assertDeclaredSecret(target, service, secretName) {
  assertService(service);
  if (!/^[A-Z][A-Z0-9_]+$/.test(secretName ?? "")) {
    throw new Error("--name must be an uppercase secret name");
  }
  if (
    DOMAIN_SERVICES.includes(service) &&
    !DOMAIN_SERVICE_REGISTRY[service].secrets.includes(secretName)
  ) {
    throw new Error(
      `${secretName} is not declared for ${service}; expected one of ` +
        DOMAIN_SERVICE_REGISTRY[service].secrets.join(", "),
    );
  }
  if (
    service in PLATFORM_SERVICE_SECRETS &&
    !PLATFORM_SERVICE_SECRETS[service].includes(secretName)
  ) {
    throw new Error(
      `${secretName} is not declared for ${service}; expected one of ` +
        PLATFORM_SERVICE_SECRETS[service].join(", "),
    );
  }
  if (
    service === "custom" &&
    !target.customWorker?.secrets.includes(secretName) &&
    secretName !== "CUSTOM_WORKER_TOKEN_PREVIOUS"
  ) {
    throw new Error(
      `${secretName} is not declared for custom; expected one of ` +
        (target.customWorker?.secrets ?? []).join(", "),
    );
  }
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { target } = await loadTarget(targetName);
  const plan = buildLegacySecretReplacement({
    target,
    targetName,
    environment,
    service: args.service,
    secretName: args.name,
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.exitCode = 2;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
