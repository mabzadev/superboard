import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  auditConfigurationBoundaries,
  collectSecretBindingNames,
  findForbiddenSharedOccurrences,
  findHardcodedTargetCommands,
  isIgnoredDirectory,
} from "./configuration-boundaries.mjs";
import { selectLegacyMessagingTarget } from "./cloudflare-legacy-messaging-check.mjs";

test("the repository has one MBZA reference profile and isolated application profiles", async () => {
  const report = await auditConfigurationBoundaries();
  assert.equal(report.valid, true, report.errors.join("\n"));
  assert.equal(report.classification.reference.target, "mbza-development");
  assert.deepEqual(report.classification.reference.environments, [
    "development",
    "local",
  ]);
  assert.ok(report.classification.reference.cloudflareResourceIds > 0);
  const applications = report.classification.applications.map(
    ({ target }) => target,
  );
  assert.ok(applications.includes("vocostar"));
  assert.equal(new Set(applications).size, applications.length);
  assert.ok(report.classification.shared.scannedFiles > 0);
  assert.equal(
    report.classification.injected.accountId.storedInTargetManifest,
    false,
  );
  assert.equal(
    report.classification.injected.secretValuesStoredInTargetOrWranglerVars,
    false,
  );
});

test("the injected secret inventory is derived from common and custom registries", () => {
  const names = collectSecretBindingNames([
    { customWorker: { secrets: ["APPLICATION_PROVIDER_TOKEN"] } },
  ]);
  for (const name of [
    "JWT_SECRET",
    "INTERNAL_API_TOKEN",
    "SMTP_PASSWORD",
    "AWS_SES_SMTP_USERNAME",
    "AWS_SES_SMTP_PASSWORD",
    "AWS_SES_SNS_TOPIC_ARN",
    "APPLICATION_PROVIDER_TOKEN",
  ]) {
    assert.equal(names.has(name), true, name);
  }
});

test("shared source rejects target domains, resource ids and workstation paths", () => {
  const resourceId = "02001526-c44d-47e5-8b1d-df47a3b68d69";
  const occurrences = findForbiddenSharedOccurrences({
    path: "workers/api/src/example.ts",
    source: [
      'fetch("https://api.vocostar.com/v1")',
      `const databaseId = "${resourceId}";`,
      'const receipt = "/Users/example/private/receipt.json";',
    ].join("\n"),
    ownership: {
      domainSuffixes: ["mbza.dev", "vocostar.com"],
      exactLiterals: [
        {
          value: resourceId,
          kind: "cloudflare-resource-id",
          target: "mbza-development",
        },
      ],
    },
  });
  assert.deepEqual(
    new Set(occurrences.map(({ kind }) => kind)),
    new Set(["target-domain", "cloudflare-resource-id", "workstation-path"]),
  );
});

test("common provider and service-binding URLs remain allowed", () => {
  const occurrences = findForbiddenSharedOccurrences({
    path: "workers/api/src/example.ts",
    source: [
      'fetch("https://billing.internal/internal/v1/health")',
      'fetch("https://appleid.apple.com/auth/keys")',
      'fetch("https://api.cloudflare.com/client/v4/accounts")',
    ].join("\n"),
    ownership: {
      domainSuffixes: ["mbza.dev", "vocostar.com"],
      exactLiterals: [],
    },
  });
  assert.deepEqual(occurrences, []);
});

test("unknown Cloudflare ids and workers.dev hosts cannot enter shared source", () => {
  const occurrences = findForbiddenSharedOccurrences({
    path: "packages/example.ts",
    source: [
      'const account = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";',
      'const preview = "https://application-preview.workers.dev";',
      'const localPlaceholder = "00000000-0000-4000-8000-000000000000";',
    ].join("\n"),
    ownership: { domainSuffixes: [], exactLiterals: [] },
  });
  assert.deepEqual(occurrences.map(({ kind }) => kind).sort(), [
    "unowned-cloudflare-id",
    "workers-dev-host",
  ]);
});

test("generated native dependency trees never enter the shared source audit", () => {
  const contract = {
    scan: {
      ignoredDirectoryNames: [
        ".build",
        ".gradle",
        ".swiftpm",
        "DerivedData",
        "Pods",
        "build",
      ],
    },
  };
  for (const [path, name] of [
    ["sdks/ios/.build", ".build"],
    ["sdks/android/.gradle", ".gradle"],
    ["sdks/ios/.swiftpm", ".swiftpm"],
    ["sdks/ios/DerivedData", "DerivedData"],
    ["sdks/ios/example/Pods", "Pods"],
    ["sdks/flutter/build", "build"],
  ]) {
    assert.equal(isIgnoredDirectory(path, name, contract), true, path);
  }
  assert.equal(
    isIgnoredDirectory("sdks/flutter/lib", "lib", contract),
    false,
    "versioned runtime source remains in scope",
  );
});

test("root scripts cannot silently select one application target", () => {
  assert.deepEqual(
    findHardcodedTargetCommands(
      {
        portable: "node scripts/check.mjs --target $OPENGROW_TARGET",
        pinned:
          "node scripts/check.mjs --target vocostar --environment production",
      },
      ["mbza-development", "vocostar"],
    ),
    [{ script: "pinned", target: "vocostar" }],
  );
});

test("Legacy Messaging tests derive their target from declared resources", () => {
  const selected = selectLegacyMessagingTarget([
    {
      target: "reference",
      workers: {},
      environments: { development: {} },
    },
    {
      target: "application-a",
      workers: { messaging: { production: "shared-messaging" } },
      environments: {
        production: {
          messagingD1: { name: "messages" },
          messagingR2: { name: "attachments" },
          queues: { messaging: "events", messagingDlq: "events-dlq" },
        },
      },
    },
  ]);
  assert.deepEqual(selected, {
    targetName: "application-a",
    environment: "production",
  });
  assert.throws(
    () => selectLegacyMessagingTarget([], null),
    /exactly one declarative Legacy Messaging profile/u,
  );
});

test("the public short-link social preview never constructs an HTTP URL", async () => {
  const source = await readFile(
    new URL(
      "../apps/dashboard/src/components/dynamic_links/links/create_link/CreateLinkSocialMediaPreview.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /const domainUrl = `https:\/\//u);
  assert.doesNotMatch(source, /const domainUrl = `http:\/\//u);
});
