#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  ALL_SERVICES,
  DOMAIN_SERVICES,
  DOMAIN_SERVICE_REGISTRY,
  PLATFORM_SERVICE_SECRETS,
  isServiceEnabled,
  isOptionalSecretBinding,
} from "./cloudflare-services.mjs";
import {
  loadTarget,
  parseArgs,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";

export function secretInventory(target) {
  return ALL_SERVICES.filter((service) => isServiceEnabled(target, service))
    .map((service) => ({
      service,
      names:
        service === "custom"
          ? [
              ...new Set([
                ...target.customWorker.secrets,
                "CUSTOM_WORKER_TOKEN_PREVIOUS",
              ]),
            ]
          : DOMAIN_SERVICES.includes(service)
            ? [...DOMAIN_SERVICE_REGISTRY[service].secrets]
            : [...(PLATFORM_SERVICE_SECRETS[service] || [])],
    }))
    .filter(({ names }) => names.length > 0);
}

const BILLING_REQUIRED = Object.freeze([
  "APPLE_ROOT_CERTIFICATES_B64",
  "PURCHASES_SIGNING_KEYSET",
  "STORE_CREDENTIALS_ACTIVE_KEY_VERSION",
  "OPENGROW_ENTITLEMENT_WEBHOOK_SECRET",
]);
const BILLING_KEY_ALTERNATIVE = Object.freeze({
  oneOf: Object.freeze([
    "STORE_CREDENTIALS_ENCRYPTION_KEYS",
    "STORE_CREDENTIALS_ENCRYPTION_KEY",
  ]),
});

export function requiredSecretInventory(target, environment) {
  const resources = target.environments?.[environment];
  if (!resources)
    throw new Error(`${target.target} does not define ${environment}`);
  const requirements = new Map();
  const add = (service, names = [], alternatives = []) => {
    if (!isServiceEnabled(target, service)) return;
    requirements.set(service, {
      service,
      names: [...new Set(names)],
      alternatives: alternatives.map(({ oneOf }) => ({ oneOf: [...oneOf] })),
    });
  };

  const api = [
    "JWT_SECRET",
    "MODULE_INTERNAL_TOKEN",
    "EMAIL_INTERNAL_TOKEN",
    "OPENGROW_CUTOVER_TOKEN",
    "PUSH_PROCESS_KEY",
    "IAP_PROCESS_KEY",
    "ADMIN_API_KEY",
    "MAINTENANCE_PROCESS_KEY",
    "DIAGNOSTICS_API_KEY",
    "OBSERVABILITY_INTERNAL_TOKEN",
    "STORE_CREDENTIALS_ACTIVE_KEY_VERSION",
  ];
  if (target.customWorker) api.push("CUSTOM_WORKER_TOKEN");
  const apiAlternatives = [BILLING_KEY_ALTERNATIVE];
  if (target.features?.billing && resources.billingExecutionMode === "local") {
    api.push(...BILLING_REQUIRED.filter((name) => !api.includes(name)));
  }
  add("api", api, apiAlternatives);
  add("dashboard", ["CLIENT_SECRET"]);
  if (target.features?.billing)
    add(
      "billing",
      [...BILLING_REQUIRED, "INTERNAL_API_TOKEN"],
      [BILLING_KEY_ALTERNATIVE],
    );
  if (target.features?.messaging) add("messaging", ["INTERNAL_API_TOKEN"]);
  add(
    "email",
    target.mail.transport === "capture"
      ? ["EMAIL_INTERNAL_TOKEN", "MAIL_PREVIEW_TOKEN"]
      : [
          "EMAIL_INTERNAL_TOKEN",
          "SMTP_HOST",
          "SMTP_PORT",
          "SMTP_SECURITY",
          "SMTP_USERNAME",
          "SMTP_PASSWORD",
        ],
  );
  add("identity", [
    "IDENTITY_KEYSET",
    "EMAIL_INTERNAL_TOKEN",
    "FILES_INTERNAL_TOKEN",
    "INTERNAL_API_TOKEN",
  ]);
  add("files", ["FILES_INTERNAL_TOKEN", "FILES_DOWNLOAD_SIGNING_KEY"]);
  add("observability", [
    "OBSERVABILITY_INTERNAL_TOKEN",
    "CLOUDFLARE_ANALYTICS_ACCOUNT_ID",
    "CLOUDFLARE_ANALYTICS_TOKEN",
  ]);
  if (target.customWorker) add("custom", target.customWorker.secrets);
  for (const service of DOMAIN_SERVICES) {
    if (target.features?.[service]) {
      add(
        service,
        DOMAIN_SERVICE_REGISTRY[service].secrets.filter(
          (name) => !isOptionalSecretBinding(name),
        ),
      );
    }
  }
  return [...requirements.values()].filter(
    ({ names, alternatives }) => names.length || alternatives.length,
  );
}

const PRODUCTION_SECRET_METADATA = Object.freeze({
  CLIENT_SECRET: Object.freeze({
    source: "generated-paired-database",
    rotation: "rotate-worker-secret-and-oauth-database-hash-together",
  }),
  IDENTITY_KEYSET: Object.freeze({
    source: "generated-asymmetric-keyset",
    rotation: "publish-overlapping-public-keys-before-retiring-the-old-key",
  }),
  APPLE_ROOT_CERTIFICATES_B64: Object.freeze({
    source: "verified-public-trust-material",
    rotation: "replace-only-after-certificate-chain-verification",
  }),
  PURCHASES_SIGNING_KEYSET: Object.freeze({
    source: "generated-asymmetric-keyset",
    rotation: "publish-overlapping-public-keys-before-retiring-the-old-key",
  }),
  CLOUDFLARE_ANALYTICS_ACCOUNT_ID: Object.freeze({
    source: "derived-cloudflare-account-configuration",
    rotation: "replace-when-the-target-account-changes",
  }),
  CLOUDFLARE_ANALYTICS_TOKEN: Object.freeze({
    source: "external-cloudflare-least-privilege-token",
    rotation: "issue-new-token-deploy-verify-then-revoke-old-token",
  }),
  SMTP_HOST: Object.freeze({
    source: "external-mail-provider-configuration",
    rotation: "update-email-worker-inactive-version",
  }),
  SMTP_PORT: Object.freeze({
    source: "external-mail-provider-configuration",
    rotation: "update-email-worker-inactive-version",
  }),
  SMTP_SECURITY: Object.freeze({
    source: "external-mail-provider-configuration",
    rotation: "update-email-worker-inactive-version",
  }),
  SMTP_USERNAME: Object.freeze({
    source: "external-mail-provider-credential",
    rotation: "issue-new-credential-deploy-verify-then-revoke-old-credential",
  }),
  SMTP_PASSWORD: Object.freeze({
    source: "external-mail-provider-credential",
    rotation: "issue-new-credential-deploy-verify-then-revoke-old-credential",
  }),
});

/**
 * Build a value-free graph describing which Worker secret bindings must receive
 * the same logical value. This is deliberately separate from secret generation:
 * production values belong to the approved secret manager and are never read by
 * this command.
 */
export function secretCoordinationPlan(target, environment) {
  const requirements = requiredSecretInventory(target, environment);
  const requiredByService = new Map(
    requirements.map((requirement) => [requirement.service, requirement]),
  );
  const claimed = new Set();
  const contracts = [];

  const exactMember = (service, name, previousName = null) => {
    const requirement = requiredByService.get(service);
    return requirement?.names.includes(name)
      ? { service, name, ...(previousName ? { previousName } : {}) }
      : null;
  };
  const alternativeMember = (service, oneOf) => {
    const requirement = requiredByService.get(service);
    const expected = [...oneOf].sort().join("\u0000");
    const found = requirement?.alternatives.find(
      (alternative) =>
        [...alternative.oneOf].sort().join("\u0000") === expected,
    );
    return found ? { service, oneOf: [...found.oneOf] } : null;
  };
  const memberKey = (member) =>
    member.name
      ? `${member.service}:name:${member.name}`
      : `${member.service}:oneOf:${[...member.oneOf].sort().join("|")}`;
  const addContract = ({ members, ...contract }) => {
    const present = members.filter(Boolean);
    if (present.length === 0) return;
    for (const member of present) {
      const key = memberKey(member);
      if (claimed.has(key)) {
        throw new Error(`Secret coordination member is claimed twice: ${key}`);
      }
      claimed.add(key);
    }
    contracts.push({ ...contract, members: present });
  };

  addContract({
    id: "module-internal-token",
    scope: "platform-common",
    source: "generated-shared-random",
    sameValueRequired: true,
    rotation: "deploy-overlap-consumers-before-producers-then-retire-previous",
    members: [
      exactMember("api", "MODULE_INTERNAL_TOKEN"),
      exactMember(
        "billing",
        "INTERNAL_API_TOKEN",
        "INTERNAL_API_TOKEN_PREVIOUS",
      ),
      exactMember(
        "identity",
        "INTERNAL_API_TOKEN",
        "INTERNAL_API_TOKEN_PREVIOUS",
      ),
      exactMember(
        "messaging",
        "INTERNAL_API_TOKEN",
        "INTERNAL_API_TOKEN_PREVIOUS",
      ),
      ...DOMAIN_SERVICES.map((service) =>
        exactMember(
          service,
          "INTERNAL_API_TOKEN",
          "INTERNAL_API_TOKEN_PREVIOUS",
        ),
      ),
    ],
  });
  addContract({
    id: "email-internal-token",
    scope: "platform-common",
    source: "generated-shared-random",
    sameValueRequired: true,
    rotation: "deploy-overlap-consumers-before-producers-then-retire-previous",
    members: [
      exactMember("api", "EMAIL_INTERNAL_TOKEN"),
      exactMember(
        "email",
        "EMAIL_INTERNAL_TOKEN",
        "EMAIL_INTERNAL_TOKEN_PREVIOUS",
      ),
      exactMember("identity", "EMAIL_INTERNAL_TOKEN"),
    ],
  });
  addContract({
    id: "files-internal-token",
    scope: "platform-common",
    source: "generated-shared-random",
    sameValueRequired: true,
    rotation: "deploy-overlap-consumers-before-producers-then-retire-previous",
    members: [
      exactMember("identity", "FILES_INTERNAL_TOKEN"),
      exactMember(
        "files",
        "FILES_INTERNAL_TOKEN",
        "FILES_INTERNAL_TOKEN_PREVIOUS",
      ),
      exactMember("custom", "FILES_INTERNAL_TOKEN"),
    ],
  });
  addContract({
    id: "observability-internal-token",
    scope: "platform-common",
    source: "generated-shared-random",
    sameValueRequired: true,
    rotation: "deploy-overlap-consumers-before-producers-then-retire-previous",
    members: [
      exactMember("api", "OBSERVABILITY_INTERNAL_TOKEN"),
      exactMember(
        "observability",
        "OBSERVABILITY_INTERNAL_TOKEN",
        "OBSERVABILITY_INTERNAL_TOKEN_PREVIOUS",
      ),
    ],
  });
  addContract({
    id: "custom-worker-internal-token",
    scope: "application-specific",
    source: "generated-shared-random",
    sameValueRequired: true,
    rotation: "deploy-overlap-consumers-before-producers-then-retire-previous",
    members: [
      exactMember("api", "CUSTOM_WORKER_TOKEN"),
      exactMember(
        "custom",
        "CUSTOM_WORKER_TOKEN",
        "CUSTOM_WORKER_TOKEN_PREVIOUS",
      ),
    ],
  });
  addContract({
    id: "billing-credential-keyring",
    scope: "platform-common",
    source: "generated-shared-keyring",
    sameValueRequired: true,
    rotation: "add-new-key-version-rewrap-verify-then-retire-old-key",
    preferredName: "STORE_CREDENTIALS_ENCRYPTION_KEYS",
    members: [
      alternativeMember("api", BILLING_KEY_ALTERNATIVE.oneOf),
      alternativeMember("billing", BILLING_KEY_ALTERNATIVE.oneOf),
    ],
  });
  addContract({
    id: "billing-credential-active-version",
    scope: "platform-common",
    source: "operator-selected-key-version",
    sameValueRequired: true,
    rotation: "change-only-after-the-new-key-exists-on-api-and-billing",
    members: [
      exactMember("api", "STORE_CREDENTIALS_ACTIVE_KEY_VERSION"),
      exactMember("billing", "STORE_CREDENTIALS_ACTIVE_KEY_VERSION"),
    ],
  });
  addContract({
    id: "purchases-signing-keyset",
    scope: "platform-common",
    source: "generated-asymmetric-keyset",
    sameValueRequired: true,
    rotation: "publish-overlapping-public-keys-before-retiring-the-old-key",
    members: [
      exactMember("api", "PURCHASES_SIGNING_KEYSET"),
      exactMember("billing", "PURCHASES_SIGNING_KEYSET"),
    ],
  });
  addContract({
    id: "apple-root-certificates",
    scope: "platform-common",
    source: "verified-public-trust-material",
    sameValueRequired: true,
    rotation: "replace-only-after-certificate-chain-verification",
    members: [
      exactMember("api", "APPLE_ROOT_CERTIFICATES_B64"),
      exactMember("billing", "APPLE_ROOT_CERTIFICATES_B64"),
    ],
  });
  addContract({
    id: "entitlement-webhook-secret",
    scope: "platform-common",
    source: "generated-shared-random",
    sameValueRequired: true,
    rotation: "coordinate-producer-and-every-external-webhook-consumer",
    externalPeers: ["configured-entitlement-webhook-consumers"],
    members: [
      exactMember("api", "OPENGROW_ENTITLEMENT_WEBHOOK_SECRET"),
      exactMember("billing", "OPENGROW_ENTITLEMENT_WEBHOOK_SECRET"),
    ],
  });

  for (const requirement of requirements) {
    for (const name of requirement.names) {
      const member = { service: requirement.service, name };
      if (claimed.has(memberKey(member))) continue;
      const metadata = PRODUCTION_SECRET_METADATA[name] ?? {};
      const applicationSpecific = requirement.service === "custom";
      addContract({
        id: `${requirement.service}-${name.toLowerCase().replaceAll("_", "-")}`,
        scope: applicationSpecific ? "application-specific" : "platform-common",
        source:
          metadata.source ??
          (applicationSpecific
            ? "application-specific-operator-or-provider"
            : "generated-service-local-random"),
        sameValueRequired: false,
        rotation:
          metadata.rotation ?? "replace-through-an-inactive-worker-version",
        members: [member],
      });
    }
    for (const alternative of requirement.alternatives) {
      const member = {
        service: requirement.service,
        oneOf: [...alternative.oneOf],
      };
      if (claimed.has(memberKey(member))) continue;
      addContract({
        id: `${requirement.service}-${alternative.oneOf.join("-or-").toLowerCase().replaceAll("_", "-")}`,
        scope:
          requirement.service === "custom"
            ? "application-specific"
            : "platform-common",
        source: "operator-supplied",
        sameValueRequired: false,
        rotation: "replace-through-an-inactive-worker-version",
        members: [member],
      });
    }
  }

  const requiredMemberCount = requirements.reduce(
    (total, requirement) =>
      total + requirement.names.length + requirement.alternatives.length,
    0,
  );
  if (claimed.size !== requiredMemberCount) {
    throw new Error(
      `Secret coordination coverage is incomplete: ${claimed.size}/${requiredMemberCount}`,
    );
  }
  return {
    schemaVersion: 1,
    valuesIncluded: false,
    isolation: "one-independent-secret-graph-per-target-environment",
    storage: "approved-secret-manager-and-cloudflare-worker-secrets-only",
    contracts,
    summary: {
      requiredBindings: requiredMemberCount,
      contracts: contracts.length,
      sharedValueContracts: contracts.filter(
        (contract) => contract.sameValueRequired,
      ).length,
      overlapCapableContracts: contracts.filter((contract) =>
        contract.members.some((member) => member.previousName),
      ).length,
      applicationSpecificContracts: contracts.filter(
        (contract) => contract.scope === "application-specific",
      ).length,
    },
  };
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const { target } = await loadTarget(targetName);
  const environment = environmentFromTarget(target);
  process.stdout.write(
    `${JSON.stringify(
      {
        schema_version: 2,
        target: targetName,
        environment,
        values_included: false,
        services: secretInventory(target),
        required: requiredSecretInventory(target, environment),
        coordination: secretCoordinationPlan(target, environment),
      },
      null,
      2,
    )}\n`,
  );
}

function environmentFromTarget(target) {
  const names = Object.keys(target.environments || {});
  if (names.length !== 1)
    throw new Error(
      `${target.target} must declare exactly one deployment environment`,
    );
  return names[0];
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await main();
