import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv from "ajv/dist/2020.js";
import {
  loadDeploymentMatrix,
  resolveDeploymentBranch,
  selectDeployments,
  validateControlPlaneCoverage,
  validateDeploymentConfiguration,
} from "./github-deployment-matrix.mjs";

test("deployment branch resolution is explicit, CI-aware and locally reproducible", () => {
  assert.equal(
    resolveDeploymentBranch({
      explicitBranch: "main",
      githubRefName: "dev",
      currentBranch: "dev",
    }),
    "main",
  );
  assert.equal(
    resolveDeploymentBranch({
      githubRefName: "dev",
      currentBranch: "main",
    }),
    "dev",
  );
  assert.equal(resolveDeploymentBranch({ currentBranch: "dev" }), "dev");
  assert.throws(
    () => resolveDeploymentBranch({ currentBranch: "feature/unsafe" }),
    /pass --branch/u,
  );
});

test("deployment matrix matches its public schema and standalone validator", async () => {
  const [configuration, schema] = await Promise.all([
    readFile(
      new URL("../config/cloudflare-deployments.json", import.meta.url),
      "utf8",
    ).then(JSON.parse),
    readFile(
      new URL("../schemas/cloudflare-deployments.schema.json", import.meta.url),
      "utf8",
    ).then(JSON.parse),
  ]);
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate(configuration), true, JSON.stringify(validate.errors));
  assert.equal(validateDeploymentConfiguration(configuration), true);
});

test("legacy deployment matrices without a versioned target lock are rejected", () => {
  assert.throws(
    () =>
      validateDeploymentConfiguration({
        schemaVersion: 1,
        deployments: [
          {
            id: "legacy-development",
            branch: "dev",
            githubEnvironment: "development",
            cloudflareEnvironment: "development",
            referenceAcceptance: true,
          },
        ],
      }),
    /Invalid Cloudflare deployment matrix root/u,
  );
});

test("deployment matrix selects GitHub Environments without embedding accounts", async () => {
  const configuration = await loadDeploymentMatrix();
  const development = selectDeployments(configuration, "dev");
  const production = selectDeployments(configuration, "main");
  assert.deepEqual(development.matrix.include, [
    {
      id: "mbza-development",
      target: "mbza-development",
      deploymentAuthority: "cloudflare-workers-builds",
      githubEnvironment: "development",
      cloudflareEnvironment: "development",
    },
  ]);
  assert.equal(development.referenceEnvironment, "development");
  assert.deepEqual(production.matrix.include, [
    {
      id: "vocostar-production",
      target: "vocostar",
      deploymentAuthority: "github-actions",
      githubEnvironment: "production",
      cloudflareEnvironment: "production",
    },
  ]);
  assert.equal(production.referenceEnvironment, "");
  assert.equal(JSON.stringify(configuration).includes("4fec1187"), false);
  assert.equal(JSON.stringify(configuration).includes("8706f1b6"), false);
});

test("development uses one native Git connection per Worker while production remains on GitHub Actions", async () => {
  const configuration = await loadDeploymentMatrix();
  const development = configuration.deployments.find(
    ({ id }) => id === "mbza-development",
  );
  const production = configuration.deployments.find(
    ({ id }) => id === "vocostar-production",
  );

  assert.deepEqual(development.automaticDeployment, {
    authority: "cloudflare-workers-builds",
    mode: "per-service",
    services: [
      "observability",
      "email",
      "files",
      "identity",
      "app",
      "products",
      "paywalls",
      "dynamic-links",
      "support",
      "marketing",
      "onboardings",
      "billing",
      "custom",
      "api",
      "mcp",
      "dashboard",
    ],
    buildCommand:
      "npm ci && npm --prefix apps/reference ci && node --test scripts/backoffice-policy.test.mjs scripts/github-deployment-matrix.test.mjs scripts/github-deployment-workflow.test.mjs && npm run cloudflare:test:services && npm run typecheck && npm test && npm run custom:check && npm --prefix apps/reference run config:test",
    deployCommand:
      'npm run cloudflare:deploy -- --target "$SUPERBOARD_TARGET" --environment "$SUPERBOARD_ENVIRONMENT" --service "$SUPERBOARD_SERVICE"',
    buildVariables: [
      "CLOUDFLARE_ACCOUNT_ID",
      "SUPERBOARD_ENVIRONMENT",
      "SUPERBOARD_SERVICE",
      "SUPERBOARD_TARGET",
    ],
    nonProductionBranchBuilds: false,
  });
  assert.deepEqual(production.automaticDeployment, {
    authority: "github-actions",
  });

  const packageConfiguration = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.match(
    packageConfiguration.scripts["billing:test:runtime"],
    /^SUPERBOARD_TARGET= SUPERBOARD_ENVIRONMENT= OPENGROW_TARGET= OPENGROW_ENVIRONMENT= /u,
    "reference-only billing tests must not inherit an operational Workers Builds target",
  );
  assert.deepEqual(
    selectDeployments(configuration, "main", {
      authority: "github-actions",
    }).matrix.include.map(({ id }) => id),
    ["vocostar-production"],
  );
  assert.throws(
    () =>
      selectDeployments(configuration, "dev", { authority: "github-actions" }),
    /No github-actions Cloudflare deployment/u,
  );
});

test("every deployment is backed by a target-selecting GitHub Environment", async () => {
  const configuration = await loadDeploymentMatrix();
  const controlPlane = JSON.parse(
    await readFile(
      new URL("../config/github-control-plane.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(validateControlPlaneCoverage(configuration, controlPlane), true);
});

test("production environments require deployment and encrypted-backup credentials", () => {
  const configuration = {
    schemaVersion: 4,
    deployments: [
      {
        id: "example-production",
        branch: "main",
        target: "example",
        githubEnvironment: "production-example",
        cloudflareEnvironment: "production",
        automaticDeployment: { authority: "github-actions" },
        referenceAcceptance: false,
      },
    ],
  };
  assert.throws(
    () =>
      validateControlPlaneCoverage(configuration, {
        repositories: {
          platform: {
            environments: {
              "production-example": {
                variables: { SUPERBOARD_TARGET: "example" },
                secrets: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
              },
            },
          },
        },
      }),
    /SUPERBOARD_BACKUP_ENCRYPTION_KEY/u,
  );
});

test("a GitHub Environment cannot redirect a deployment to another target", () => {
  const configuration = {
    schemaVersion: 4,
    deployments: [
      {
        id: "example-production",
        branch: "main",
        target: "expected-application",
        githubEnvironment: "production-example",
        cloudflareEnvironment: "production",
        automaticDeployment: { authority: "github-actions" },
        referenceAcceptance: false,
      },
    ],
  };
  assert.throws(
    () =>
      validateControlPlaneCoverage(configuration, {
        repositories: {
          platform: {
            environments: {
              "production-example": {
                variables: { SUPERBOARD_TARGET: "another-application" },
                secrets: [
                  "CLOUDFLARE_ACCOUNT_ID",
                  "CLOUDFLARE_API_TOKEN",
                  "SUPERBOARD_BACKUP_ENCRYPTION_KEY",
                ],
              },
            },
          },
        },
      }),
    /must equal the versioned deployment target expected-application/u,
  );
});

test("a branch cannot select two reference acceptance environments", () => {
  assert.throws(
    () =>
      selectDeployments(
        {
          schemaVersion: 4,
          deployments: [
            {
              id: "one",
              branch: "dev",
              target: "one",
              githubEnvironment: "development-one",
              cloudflareEnvironment: "development",
              automaticDeployment: {
                authority: "cloudflare-workers-builds",
              },
              referenceAcceptance: true,
            },
            {
              id: "two",
              branch: "dev",
              target: "two",
              githubEnvironment: "development-two",
              cloudflareEnvironment: "development",
              automaticDeployment: {
                authority: "cloudflare-workers-builds",
              },
              referenceAcceptance: true,
            },
          ],
        },
        "dev",
      ),
    /more than one reference/u,
  );
});

test("branch and Cloudflare environment cannot cross development and production", () => {
  assert.throws(
    () =>
      validateDeploymentConfiguration({
        schemaVersion: 4,
        deployments: [
          {
            id: "unsafe",
            branch: "dev",
            target: "unsafe",
            githubEnvironment: "unsafe-production",
            cloudflareEnvironment: "production",
            automaticDeployment: { authority: "github-actions" },
            referenceAcceptance: false,
          },
        ],
      }),
    /dev must deploy only development/u,
  );
});
