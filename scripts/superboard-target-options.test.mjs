import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  customTargetOptions,
  dashboardCacheResourceName,
  validateCustomWorkerBindings,
} from "./superboard-target-options.mjs";
import { newTargetManifest } from "./superboard-target-template.mjs";
import { validateTarget } from "./cloudflare-target.mjs";

const context = {
  target: "new-app",
  environment: "development",
  baseResourceName: "opengrow-new-app-dev",
};

test("new targets isolate dashboard cache from application files", () => {
  assert.equal(
    dashboardCacheResourceName("opengrow-new-app-dev"),
    "opengrow-new-app-dev-dashboard-cache",
  );
});

test("custom target options cover D1, vars, secrets, crons and services", () => {
  const result = customTargetOptions(
    {
      "custom-source": "workers/custom/new-app/src/index.ts",
      "custom-capabilities": "new-app.convert,new-app.jobs.retry",
      "custom-secrets": "MODEL_TOKEN,CUSTOM_WORKER_TOKEN",
      "custom-vars-json": '{"JOB_RETENTION_DAYS":"30"}',
      "custom-crons-json": '["*/5 * * * *"]',
      "custom-d1-binding": "CUSTOM_DB",
      "custom-migrations-dir": "workers/custom/new-app/migrations",
      "custom-service-bindings-json":
        '[{"binding":"MODEL_SERVICE","workers":{"development":"model-dev"}}]',
    },
    context,
  );
  assert.deepEqual(result, {
    worker: {
      source: "workers/custom/new-app/src/index.ts",
      packagePath: "workers/custom/new-app",
      description: "new-app app-specific SuperBoard extension",
      capabilities: ["new-app.convert", "new-app.jobs.retry"],
      secrets: ["CUSTOM_WORKER_TOKEN", "MODEL_TOKEN"],
      vars: { JOB_RETENTION_DAYS: "30" },
      crons: ["*/5 * * * *"],
      d1Binding: {
        binding: "CUSTOM_DB",
        migrationsDir: "workers/custom/new-app/migrations",
      },
      serviceBindings: [
        {
          binding: "MODEL_SERVICE",
          workers: { development: "model-dev" },
        },
      ],
    },
    environmentResources: {
      customD1: { name: "opengrow-new-app-dev-custom-db", id: null },
    },
  });
});

test("custom target options reject partial and conflicting configuration", () => {
  assert.throws(
    () =>
      customTargetOptions(
        {
          "custom-source": "workers/custom/new-app/src/index.ts",
          "custom-d1-binding": "CUSTOM_DB",
        },
        context,
      ),
    /supplied together/,
  );
  assert.throws(
    () =>
      customTargetOptions(
        {
          "custom-source": "workers/custom/new-app/src/index.ts",
          "custom-vars-json": '{"APP_KEY":"wrong"}',
        },
        context,
      ),
    /cannot be overridden/,
  );
  assert.throws(
    () =>
      customTargetOptions(
        {
          "custom-source": "workers/custom/new-app/src/index.ts",
          "custom-secrets": "MODEL_TOKEN",
          "custom-vars-json": '{"MODEL_TOKEN":"plaintext"}',
        },
        context,
      ),
    /both a custom var and secret/,
  );
  assert.throws(
    () =>
      customTargetOptions(
        {
          "custom-source": "workers/custom/new-app/src/index.ts",
          "custom-vars-json": '{"MODEL_API_KEY":"plaintext"}',
        },
        context,
      ),
    /must be a custom secret/,
  );
  assert.throws(
    () => customTargetOptions({ "custom-crons-json": "[]" }, context),
    /requires --custom-source/,
  );
});

test("target validation protects generated, secret and resource bindings", () => {
  assert.throws(
    () =>
      validateCustomWorkerBindings({
        secrets: ["MODEL_TOKEN"],
        vars: { ENVIRONMENT: "wrong" },
      }),
    /both generated var and custom var/,
  );
  assert.throws(
    () =>
      validateCustomWorkerBindings({
        secrets: ["MODEL_TOKEN"],
        vars: { MODEL_TOKEN: "plaintext" },
      }),
    /both custom var and secret/,
  );
  assert.throws(
    () =>
      validateCustomWorkerBindings({
        secrets: ["CUSTOM_WORKER_TOKEN"],
        d1Binding: { binding: "CUSTOM_DB" },
        serviceBindings: [{ binding: "CUSTOM_DB" }],
      }),
    /both D1 and service/,
  );
  assert.throws(
    () =>
      validateCustomWorkerBindings({
        secrets: ["CUSTOM_WORKER_TOKEN"],
        vars: { PROVIDER_PASSWORD: "plaintext" },
      }),
    /must be declared as a secret/,
  );
});

test("the new-application template produces a complete valid custom target", async () => {
  const manifest = newTargetManifest({
    args: {
      "account-alias": "sample-development",
      "workers-dev-subdomain": "sample",
      "api-domain": "api.sample.dev",
      "auth-domain": "auth.sample.dev",
      "shortlinks-domain": "in.sample.dev",
      "sdk-domain": "sdk.sample.dev",
      "dashboard-domain": "grow.sample.dev",
      "files-domain": "files.sample.dev",
      "mcp-domain": "mcp.sample.dev",
      "mail-preview-domain": "mail.sample.dev",
      "mail-from-address": "noreply@sample.dev",
      "max-file-bytes": "20971520",
      "allowed-file-content-types": "application/pdf,image/png,text/plain",
      "operator-docs-url": "https://github.com/example/superboard-platform/docs",
      "operator-email": "operator@sample.dev",
      "operator-support-email": "support@sample.dev",
      "auth-gateway-issuer": "https://auth.sample.dev",
      "auth-gateway-audience": "opengrow",
      "auth-gateway-jwks-url": "https://auth.sample.dev/.well-known/jwks.json",
      "application-web-origins": "https://reference.sample.dev",
      "custom-source": "workers/custom/sample/src/index.ts",
      "custom-capabilities": "sample.echo",
      "custom-vars-json": '{"JOB_RETENTION_DAYS":"30"}',
      "custom-crons-json": '["0 3 * * *"]',
      "custom-d1-binding": "CUSTOM_DB",
      "custom-migrations-dir": "workers/custom/sample/migrations",
      "custom-service-bindings-json":
        '[{"binding":"MODEL_SERVICE","workers":{"development":"model-worker-dev"}}]',
    },
    target: "sample-development",
    selectedEnvironment: "development",
  });

  await assert.doesNotReject(validateTarget(manifest));
  assert.notEqual(
    manifest.environments.development.r2.name,
    manifest.environments.development.dashboardCache.name,
  );
  assert.equal(
    manifest.environments.development.customD1.name,
    "superboard-sample-development-dev-custom-db",
  );
  assert.deepEqual(manifest.resourceIdentity, {
    logicalName: "superboard",
    physicalName: "superboard",
    previousNames: [],
    migrationStrategy: "canonical",
  });
  assert.deepEqual(manifest.retiredDomains, []);
  assert.equal(manifest.domains.auth, "auth.sample.dev");
  assert.deepEqual(manifest.applicationIdentity.webOrigins, [
    "https://reference.sample.dev",
  ]);
  assert.deepEqual(manifest.filePolicy, {
    maxBytes: 20_971_520,
    downloadTicketTtlSeconds: 600,
    allowedContentTypes: ["application/pdf", "image/png", "text/plain"],
  });
});

test("target registration keeps provisioning separate from deployment", () => {
  const source = readFileSync(
    new URL("./superboard-register-target.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /requires the exact --confirm value/u);
  assert.match(source, /"--apply", "--confirm", confirmation/u);
  assert.doesNotMatch(source, /cloudflare-deploy(?:-all)?\.mjs/u);
});
