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

test("deployment matrix selects GitHub Environments without embedding accounts", async () => {
  const configuration = await loadDeploymentMatrix();
  const development = selectDeployments(configuration, "dev");
  const production = selectDeployments(configuration, "main");
  assert.deepEqual(development.matrix.include, [
    {
      id: "mbza-development",
      githubEnvironment: "development",
      cloudflareEnvironment: "development",
    },
  ]);
  assert.equal(development.referenceEnvironment, "development");
  assert.deepEqual(production.matrix.include, [
    {
      id: "vocostar-production",
      githubEnvironment: "production",
      cloudflareEnvironment: "production",
    },
  ]);
  assert.equal(production.referenceEnvironment, "");
  assert.equal(JSON.stringify(configuration).includes("4fec1187"), false);
  assert.equal(JSON.stringify(configuration).includes("8706f1b6"), false);
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
    schemaVersion: 1,
    deployments: [
      {
        id: "example-production",
        branch: "main",
        githubEnvironment: "production-example",
        cloudflareEnvironment: "production",
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
                variables: { OPENGROW_TARGET: "example" },
                secrets: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
              },
            },
          },
        },
      }),
    /OPENGROW_BACKUP_ENCRYPTION_KEY/u,
  );
});

test("a branch cannot select two reference acceptance environments", () => {
  assert.throws(
    () =>
      selectDeployments(
        {
          schemaVersion: 1,
          deployments: [
            {
              id: "one",
              branch: "dev",
              githubEnvironment: "development-one",
              cloudflareEnvironment: "development",
              referenceAcceptance: true,
            },
            {
              id: "two",
              branch: "dev",
              githubEnvironment: "development-two",
              cloudflareEnvironment: "development",
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
        schemaVersion: 1,
        deployments: [
          {
            id: "unsafe",
            branch: "dev",
            githubEnvironment: "unsafe-production",
            cloudflareEnvironment: "production",
            referenceAcceptance: false,
          },
        ],
      }),
    /dev must deploy only development/u,
  );
});
