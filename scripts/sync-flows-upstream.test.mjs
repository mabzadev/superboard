import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkFlowsUpstream, PINNED_SOURCES } from "./sync-flows-upstream.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const upstream = resolve(root, "sdks/flows/upstream");

function read(relativePath) {
  return readFileSync(resolve(upstream, relativePath), "utf8");
}

function listFiles(directory) {
  const files = [];
  const visit = (current) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) visit(path);
      else files.push(path);
    }
  };
  visit(directory);
  return files;
}

test("the generated Flows import matches every recorded SHA-256", () => {
  const manifest = checkFlowsUpstream();
  assert.ok(manifest.files.length > 500, "expected a substantial reviewed import");
  assert.deepEqual(manifest.sources, {
    "flows-sh": PINNED_SOURCES["flows-sh"],
    "flows-sdk": PINNED_SOURCES["flows-sdk"],
  });
  assert.equal(manifest.policy.dashboard_imported, false);
  assert.equal(manifest.policy.marketing_site_imported, false);
  assert.equal(manifest.policy.runtime_upstream_dependency, false);
});

test("SDK packages use the SuperBoard namespace and retain the supported public surfaces", () => {
  const packages = {
    js: "@superboard/flows-js",
    react: "@superboard/flows-react",
    "js-components": "@superboard/flows-js-components",
    "react-components": "@superboard/flows-react-components",
    shared: "@superboard/flows-shared",
    styles: "@superboard/flows-styles",
  };
  for (const [directory, expectedName] of Object.entries(packages)) {
    const packageJson = JSON.parse(read(`packages/${directory}/package.json`));
    assert.equal(packageJson.name, expectedName);
    assert.equal(packageJson.license, "MIT");
  }

  const jsIndex = read("packages/js/src/index.ts");
  const reactIndex = read("packages/react/src/index.ts");
  const reactSlot = read("packages/react/src/components/flows-slot.tsx");
  const reactMethods = read("packages/react/src/methods.ts");
  const jsMethods = read("packages/js/src/methods.ts");
  assert.match(jsIndex, /init/u);
  assert.match(jsMethods, /startWorkflow/u);
  assert.match(jsMethods, /resetWorkflowProgress/u);
  assert.match(jsMethods, /resetAllWorkflowsProgress/u);
  assert.match(jsMethods, /fetchWorkflows/u);
  assert.match(reactIndex, /FlowsProvider/u);
  assert.match(reactIndex, /components\/flows-slot/u);
  assert.match(reactSlot, /export const FlowsSlot/u);
  assert.match(reactMethods, /useCurrentFloatingBlocks/u);
  assert.match(reactMethods, /useCurrentSlotBlocks/u);
});

test("runtime defaults to the same-origin SuperBoard API and preserves custom apiUrl support", () => {
  const sharedApi = read("packages/shared/src/api.ts");
  const jsInit = read("packages/js/src/init.ts");
  const reactProvider = read("packages/react/src/flows-provider.tsx");
  assert.match(sharedApi, /DEFAULT_API_URL = "\/api\/v1\/flows"/u);
  assert.match(sharedApi, /joinApiUrl/u);
  assert.match(sharedApi, /getWebSocketUrl/u);
  assert.match(sharedApi, /FLOW_SDK_KEY_HEADER = "x-superboard-flows-sdk-key"/u);
  assert.match(sharedApi, /withSdkKey/u);
  assert.match(sharedApi, /"Idempotency-Key": idempotencyKey/u);
  const eventQueue = read("packages/shared/src/event-queue.ts");
  assert.match(eventQueue, /sendEvent\(item\.event, item\.id\)/u);
  assert.match(eventQueue, /if \(sent === false\) break/u);
  assert.match(eventQueue, /id: idempotencyKey \?\? crypto\.randomUUID\(\)/u);
  assert.match(eventQueue, /previousValue\.some\(\(item\) => item\.id === data\.id\)/u);
  assert.match(sharedApi, /postSurvey: \(body: ApiSurveyAnswer, idempotencyKey\?: string\)/u);
  assert.match(read("packages/react/src/lib/api.ts"), /`survey:\$\{props\.blockStateId\}`\);/u);
  assert.match(read("packages/js/src/lib/api.ts"), /`survey:\$\{props\.blockStateId\}`\);/u);
  assert.match(
    read("packages/shared/src/types/active-block.ts"),
    /sendActivate\(block\.id, block\.blockStateId\)/u,
  );
  assert.match(read("packages/react/src/lib/active-block.ts"), /blockStateId: block\.blockStateId/u);
  assert.match(read("packages/js/src/lib/active-block.ts"), /blockStateId: block\.blockStateId/u);
  assert.match(read("packages/react/src/lib/api.ts"), /activatedBlockStates/u);
  assert.match(read("packages/js/src/lib/api.ts"), /activatedBlockStates/u);
  assert.match(read("packages/shared/src/api.ts"), /blockStateId\?: string/u);
  assert.match(
    read("packages/react/src/lib/api.ts"),
    /name: "block-activated", blockId, blockStateId/u,
  );
  assert.match(
    read("packages/js/src/lib/api.ts"),
    /name: "block-activated", blockId, blockStateId/u,
  );
  assert.match(
    read("packages/react/src/lib/active-block.ts"),
    /name: "transition", blockId, blockStateId: block\.blockStateId/u,
  );
  assert.match(
    read("packages/js/src/lib/tour.ts"),
    /name: "tour-update",[\s\S]*blockStateId: tourBlock\.blockStateId/u,
  );
  assert.match(read("packages/react/src/lib/api.ts"), /`activation:\$\{activationState\}`/u);
  assert.match(read("packages/js/src/lib/api.ts"), /`activation:\$\{activationState\}`/u);
  assert.match(jsInit, /options\.apiUrl \?\? getDefaultApiUrl\(\)/u);
  assert.match(jsInit, /withSdkKey\(options\.customFetch, options\.sdkKey\)/u);
  assert.match(reactProvider, /apiUrl = getDefaultApiUrl\(\)/u);
  assert.match(reactProvider, /apiUrl\?: string/u);
  assert.match(reactProvider, /withSdkKey\(customFetch, sdkKey\)/u);
  assert.match(read("packages/js/src/types/configuration.ts"), /sdkKey\?: string/u);
  assert.match(read("packages/js/src/types/configuration.ts"), /projectId: string/u);
  assert.doesNotMatch(read("packages/js/src/types/configuration.ts"), /organizationId/u);
  assert.match(reactProvider, /projectId: string/u);
  assert.doesNotMatch(reactProvider, /organizationId/u);
  assert.match(read("packages/shared/src/api.ts"), /projectId: string/u);
  assert.doesNotMatch(read("packages/shared/src/api.ts"), /organizationId/u);
  assert.match(read("packages/react/src/hooks/use-blocks.ts"), /sdkKey \? \{ sdkKey \}/u);
  assert.match(
    read("packages/js/src/lib/blocks.ts"),
    /firstWebSocketOpen/u,
  );
  assert.match(
    read("packages/react/src/hooks/use-blocks.ts"),
    /HTTP block loading is independent from realtime availability/u,
  );
  assert.match(
    read("tests/e2e/tests/init.spec.ts"),
    /http:\/\/localhost:3000\/api\/v1\/flows\/v2\/sdk\/blocks/u,
  );
  assert.match(
    read("tests/e2e/tests/init.spec.ts"),
    /@superboard\\\/flows-/u,
  );
  assert.doesNotMatch(read("packages/js/README.md"), /\bMTUs?\b|pricing/u);
  assert.doesNotMatch(read("packages/react/README.md"), /\bMTUs?\b|pricing/u);
});

test("web wrappers expose the superboard-commerce custom-component extension point", () => {
  const reactProvider = read("packages/react/src/flows-provider.tsx");
  const reactBlock = read("packages/react/src/components/block.tsx");
  const jsSetup = read("packages/js-components/src/render.ts");

  assert.match(reactProvider, /components: Components/u);
  assert.match(reactBlock, /components\[block\.component\]/u);
  assert.match(jsSetup, /Object\.entries\(options\.components\)/u);
  assert.match(jsSetup, /components\[name\] = Cmp/u);
  assert.match(jsSetup, /`flows-\$\{name\.toLowerCase\(\)\}`/u);

  const componentKey = "superboard-commerce";
  assert.equal(`flows-${componentKey.toLowerCase()}`, "flows-superboard-commerce");
});

test("imported runtime has no upstream service URL or injected upstream branding", () => {
  const runtimeRoots = [resolve(upstream, "packages")];
  const forbidden = /api\.flows-cloud\.com|app\.flows\.sh|Powered by Flows/u;
  const removedTenantAndBillingModel =
    /\borganization(?:Id|s)?\b|\busage_limited\b|\bMTUs?\b|\bpricing\b/iu;
  for (const runtimeRoot of runtimeRoots) {
    for (const path of listFiles(runtimeRoot)) {
      const extension = extname(path).toLowerCase();
      if (![".css", ".js", ".json", ".md", ".mjs", ".ts", ".tsx"].includes(extension)) continue;
      assert.doesNotMatch(readFileSync(path, "utf8"), forbidden, path);
      assert.doesNotMatch(
        readFileSync(path, "utf8"),
        removedTenantAndBillingModel,
        path,
      );
    }
  }
  assert.match(
    read("packages/react-components/src/internal-components/branding.tsx"),
    /=> null/u,
  );
  assert.match(
    read("packages/js-components/src/internal-components/branding.ts"),
    /html`\s*`/u,
  );
});

test("product references cannot reintroduce a Flows organization or MTU billing domain", () => {
  const referenceRoots = [resolve(upstream, "product"), resolve(upstream, "reference")];
  const removedDomain =
    /\borganization(?:Id|s)?\b|organization-setup|\bMTUs?\b|Monthly Tracked User|usage_limited|multiple projects|project switcher|create a new project/iu;
  for (const referenceRoot of referenceRoots) {
    for (const path of listFiles(referenceRoot)) {
      const extension = extname(path).toLowerCase();
      if (![".css", ".html", ".js", ".json", ".md", ".mdx", ".mjs", ".svg", ".ts", ".tsx"].includes(extension)) continue;
      assert.doesNotMatch(readFileSync(path, "utf8"), removedDomain, path);
    }
  }

  for (const retiredPath of [
    "product/shared/src/billing.ts",
    "product/types/src/billing.ts",
    "product/types/src/organization.ts",
    "reference/product-docs/content/billing.mdx",
  ]) {
    assert.equal(
      listFiles(upstream).some((path) => path === resolve(upstream, retiredPath)),
      false,
      `${retiredPath} must not be imported`,
    );
  }
});

test("all public SDK E2E scenarios and product documentation groups are retained", () => {
  const e2eSpecs = listFiles(resolve(upstream, "tests/e2e/tests")).filter((path) =>
    path.endsWith(".spec.ts"),
  );
  assert.ok(e2eSpecs.length >= 30, `only ${e2eSpecs.length} E2E specifications imported`);

  for (const path of [
    "reference/product-docs/content/launchpad.mdx",
    "reference/product-docs/content/localization.mdx",
    "reference/product-docs/content/personalization.mdx",
    "reference/product-docs/content/blocks/tour-block.mdx",
    "reference/product-docs/content/guides/create-survey.mdx",
    "product/shared/src/basics-v2-components.ts",
    "product/types/src/block.ts",
  ]) {
    assert.ok(read(path).length > 0, `${path} was not imported`);
  }
});
