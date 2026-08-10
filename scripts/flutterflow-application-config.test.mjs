import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveFlutterFlowApplication,
  resolveFlutterFlowApplications,
} from "./flutterflow-application-config.mjs";
import { loadTarget } from "./cloudflare-target.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function fixtures() {
  const [registry, library, controlPlane, { target }] = await Promise.all([
    json("config/flutterflow-applications.json"),
    json("config/flutterflow-library.json"),
    json("config/github-control-plane.json"),
    loadTarget("vocostar"),
  ]);
  return {
    application: registry.applications[0],
    target,
    library,
    controlPlane,
  };
}

test("VocoStar bindings derive every common origin from its target", async () => {
  const result = await resolveFlutterFlowApplications();
  assert.equal(result.applications.length, 1);
  assert.deepEqual(result.applications[0].values, {
    projectKey: {
      source: "github-environment-secret",
      name: "SUPERBOARD_PROJECT_KEY",
    },
    uriScheme: "vocostar",
    useTestEnvironment: false,
    sdkBaseUrl: "https://sdk.vocostar.com",
    authGatewayBaseUrl: "https://api.vocostar.com",
    filesBaseUrl: "https://files.vocostar.com",
    applicationIdentifier: "com.createurs.vocostar",
    applicationEnvironment: "production",
    supportBaseUrl: "https://api.vocostar.com/api/v1/support-client",
    supportProjectId: 12,
    shortLinkHost: "go.vocostar.com",
  });
});

test("changing a target changes every derived origin without editing app config", async () => {
  const values = await fixtures();
  const target = structuredClone(values.target);
  target.domains = {
    ...target.domains,
    api: "api.example.dev",
    sdk: "sdk.example.dev",
    files: "files.example.dev",
    shortlinks: "in.example.dev",
  };
  const result = await resolveFlutterFlowApplication({ ...values, target });
  assert.deepEqual(
    {
      api: result.values.authGatewayBaseUrl,
      support: result.values.supportBaseUrl,
      sdk: result.values.sdkBaseUrl,
      files: result.values.filesBaseUrl,
      links: result.values.shortLinkHost,
    },
    {
      api: "https://api.example.dev",
      support: "https://api.example.dev/api/v1/support-client",
      sdk: "https://sdk.example.dev",
      files: "https://files.example.dev",
      links: "in.example.dev",
    },
  );
});

test("an application cannot select an unallowlisted Support project", async () => {
  const values = await fixtures();
  const application = structuredClone(values.application);
  application.client.supportProjectId = 999;
  await assert.rejects(
    () => resolveFlutterFlowApplication({ ...values, application }),
    /not allowlisted/u,
  );
});

test("all project identifiers and credentials are GitHub Environment-owned", async () => {
  const values = await fixtures();
  const controlPlane = structuredClone(values.controlPlane);
  delete controlPlane.repositories.platform.environments[
    values.application.remoteProject.githubEnvironment
  ].variables.FF_LIBRARY_PROJECT_ID;
  await assert.rejects(
    () => resolveFlutterFlowApplication({ ...values, controlPlane }),
    /FF_LIBRARY_PROJECT_ID is missing/u,
  );
});

test("the client project key is resolved only from the protected environment", async () => {
  const values = await fixtures();
  assert.equal(values.application.client.projectKey, undefined);
  assert.equal(
    values.application.client.projectKeySecret,
    "SUPERBOARD_PROJECT_KEY",
  );
  const controlPlane = structuredClone(values.controlPlane);
  const environment =
    controlPlane.repositories.platform.environments[
      values.application.remoteProject.githubEnvironment
    ];
  environment.secrets = environment.secrets.filter(
    (name) => name !== "SUPERBOARD_PROJECT_KEY",
  );
  await assert.rejects(
    () => resolveFlutterFlowApplication({ ...values, controlPlane }),
    /GitHub secret SUPERBOARD_PROJECT_KEY is missing/u,
  );
});

test("the application workflow prefers the SuperBoard key and retains the migration fallback", async () => {
  const workflow = await readFile(
    resolve(root, ".github/workflows/sync-flutterflow-applications.yml"),
    "utf8",
  );
  assert.match(
    workflow,
    /SUPERBOARD_PROJECT_KEY:\s*\$\{\{ secrets\.SUPERBOARD_PROJECT_KEY \|\| secrets\.OPENGROW_PROJECT_KEY \}\}/u,
  );
  assert.match(workflow, /test -n "\$SUPERBOARD_PROJECT_KEY"/u);
});

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}
