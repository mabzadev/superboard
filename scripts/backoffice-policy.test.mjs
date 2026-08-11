import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

function sourceFiles(directory) {
  const paths = [];
  for (const entry of readdirSync(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        !entry.name.startsWith(".") &&
        !["__tests__", "build", "coverage", "dist", "node_modules"].includes(
          entry.name,
        )
      ) {
        paths.push(...sourceFiles(path));
      }
    } else if (
      (!/\.(?:test|spec)\./u.test(entry.name) &&
        /\.(?:ts|tsx|js|mjs|cjs|json|md|dart|swift|kt|java)$/u.test(
          entry.name,
        )) ||
      entry.name === ".env.example"
    ) {
      paths.push(path);
    }
  }
  return paths;
}

test("deployment targets have no OpenGrow edition or usage plan", () => {
  const targetDir = join(root, "deploy", "targets");
  const targets = readdirSync(targetDir)
    .filter((name) => name.endsWith(".json") && name !== "schema.json")
    .map((name) => JSON.parse(readFileSync(join(targetDir, name), "utf8")));

  assert.ok(targets.length > 0);
  for (const target of targets) {
    assert.equal(
      "accessMode" in target,
      false,
      `${target.target} declares accessMode`,
    );
    assert.equal(
      target.features?.billing === true || target.features?.billing === false,
      true,
    );
  }

  const schema = read("deploy/targets/schema.json");
  assert.equal(schema.includes('"accessMode"'), false);
});

test("the root project references a target instead of duplicating its domains", () => {
  const project = JSON.parse(read("superboard.project.json"));
  assert.deepEqual(project.development, { target: "mbza-development" });
  const target = JSON.parse(read("deploy/targets/mbza-development.json"));
  assert.equal(target.domains.shortlinks, "in.mbza.dev");
});

test("public repository workflow never requires a platform read token", () => {
  const paths = [
    "README.md",
    "docs/DEVELOPMENT_WORKFLOW.md",
    "sdks/flutterflow/README.md",
    ".github/workflows/deploy-cloudflare.yml",
  ];

  for (const path of paths) {
    const source = read(path);
    assert.equal(
      source.includes("OPENGROW_PLATFORM_READ_TOKEN"),
      false,
      `${path} declares a stale repository read token`,
    );
    assert.equal(
      /checkout the private\s+platform source/iu.test(source),
      false,
      `${path} still describes the platform repository as private`,
    );
  }
});

test("each target has one explicit automatic Cloudflare deployment authority", () => {
  assert.equal(
    existsSync(join(root, "scripts/cloudflare-connect-builds.mjs")),
    false,
  );
  assert.equal(
    "cloudflare:connect-builds" in JSON.parse(read("package.json")).scripts,
    false,
  );
  const deploymentMatrix = JSON.parse(
    read("config/cloudflare-deployments.json"),
  );
  const authorities = Object.fromEntries(
    deploymentMatrix.deployments.map(({ id, automaticDeployment }) => [
      id,
      automaticDeployment.authority,
    ]),
  );
  assert.deepEqual(authorities, {
    "mbza-development": "cloudflare-workers-builds",
    "vocostar-production": "github-actions",
  });
  assert.match(
    read("docs/CLOUDFLARE.md"),
    /one automatic deployment authority per target/u,
  );
});

test("runtime and dashboard do not expose legacy OpenGrow SaaS controls", () => {
  const runtimeFiles = [
    "scripts/cloudflare-config.mjs",
    "workers/api/src/lib/deployment.ts",
    "workers/api/src/lib/jobs.ts",
    "workers/api/src/lib/maintenance.ts",
    "workers/api/src/routes/admin.ts",
    "workers/api/src/routes/instances.ts",
    "workers/api/src/routes/redirect.ts",
    "apps/dashboard/src/lib/config.ts",
    "apps/dashboard/src/lib/queryKeys.ts",
    "apps/dashboard/src/app/(protected)/project-settings/page.tsx",
  ];
  const forbidden = [
    "OPENGROW_ACCESS_MODE",
    "FREE_MAU_COUNT",
    "quota.update",
    "enterprise_mau.precompute",
    "/billing/subscription",
    "/billing/mau",
    "create_enterprise_subscription",
    "update_enterprise_subscription",
    "IS_ENTERPRISE",
    "pricingUrl",
    "salesUrl",
  ];

  for (const path of runtimeFiles) {
    const source = read(path);
    for (const token of forbidden) {
      assert.equal(
        source.includes(token),
        false,
        `${path} still contains ${token}`,
      );
    }
  }

  for (const removedPath of [
    "apps/dashboard/src/components/settings/PlanSection.tsx",
    "apps/dashboard/src/components/settings/EnterpriseDialog.tsx",
    "apps/dashboard/src/hooks/queries/usePaymentsQueries.ts",
    "apps/dashboard/src/api/payments/paymentsService.ts",
    "apps/dashboard/src/lib/edition.ts",
  ]) {
    assert.equal(
      existsSync(join(root, removedPath)),
      false,
      `${removedPath} still exists`,
    );
  }
});

test("store purchases remain an application capability", () => {
  const deployment = read("workers/api/src/lib/deployment.ts");
  const purchases = read("workers/api/src/routes/purchases-sdk.ts");
  const target = JSON.parse(read("deploy/targets/mbza-development.json"));

  assert.match(
    deployment,
    /configured === true \|\| Number\(configured\) === 1/,
  );
  assert.match(
    purchases,
    /isPurchasesEnabled\(c\.env, project\.purchases_enabled\)/,
  );
  assert.equal(target.features.billing, true);
});

test("copyable SDK setup uses target-owned public origins", () => {
  const setup = read("apps/dashboard/src/components/app/SdkSetupWizard.tsx");
  const preview = read(
    "apps/dashboard/src/components/dynamic_links/social-preview/SocialPreviewPageContent.tsx",
  );

  assert.equal(setup.includes("sdk.example.com"), false);
  assert.equal(setup.includes("links.example.com"), false);
  assert.match(setup, /config\.sdkUrl/);
  assert.match(setup, /config\.shortlinkUrl/);
  assert.match(preview, /config\.shortlinkUrl/);
});

test("optional Dashboard analytics has no hardcoded collector origin", () => {
  const analytics = read("apps/dashboard/src/analytics/posthog.ts");
  assert.match(analytics, /process\.env\.NEXT_PUBLIC_POSTHOG_HOST/u);
  assert.equal(
    /POSTHOG_HOST\s*=\s*[^;]*(?:posthog\.com|https?:\/\/)/u.test(analytics),
    false,
  );
  assert.match(
    read("apps/dashboard/.env.example"),
    /NEXT_PUBLIC_POSTHOG_HOST=/u,
  );
});

test("reusable platform source and examples contain no application hostname or embedded project key", () => {
  const reusableFiles = [
    ...new Set([
      ...sourceFiles("workers"),
      ...sourceFiles("apps/dashboard/src"),
      ...sourceFiles("apps/mcp/src"),
      ...sourceFiles("packages"),
      ...sourceFiles("sdks/flutter/lib"),
      ...sourceFiles("sdks/flutterflow/lib"),
      ...sourceFiles("sdks/ios/Sources"),
      ...sourceFiles("sdks/android/OpenGrow/OpenGrow/src/main"),
      ...sourceFiles("sdks/javascript/src"),
      ...sourceFiles("sdks/react-native/src"),
      ...sourceFiles("sdks/react-native/example/src"),
      "package.json",
      "apps/dashboard/package.json",
      "apps/dashboard/public/robots.txt",
      "sdks/android/README.md",
      "sdks/flutter/README.md",
      "sdks/ios/README.md",
      "sdks/javascript/README.md",
      "sdks/react-native/README.md",
      "sdks/javascript/public/index.html",
      "workers/email/README.md",
    ]),
  ];

  for (const path of reusableFiles) {
    const source = read(path);
    assert.equal(
      /(?:mbza\.dev|vocostar\.com)/u.test(source),
      false,
      `${path} embeds an application hostname`,
    );
    assert.equal(
      /opengrowt_[a-f0-9]{32,}/iu.test(source),
      false,
      `${path} embeds a project key`,
    );
    assert.equal(
      /opengrow\.io/iu.test(source),
      false,
      `${path} embeds a legacy OpenGrow SaaS origin`,
    );
  }
});

test("back-office health includes transactional, newsletter and delivery-job state", () => {
  const email = read("workers/email/src/index.ts");
  assert.match(email, /messages_transactional/u);
  assert.match(email, /messages_marketing/u);
  assert.match(email, /deliveries_failed/u);

  const marketing = read("workers/marketing/src/index.ts");
  assert.match(marketing, /deliveries_bounced/u);
  assert.match(marketing, /deliveries_complained/u);
  assert.match(marketing, /outbox_dead_letter/u);

  const platform = read("workers/api/src/routes/platform-status.ts");
  assert.match(platform, /serviceJobMetrics\(serviceChecks\)/u);
  assert.match(platform, /campaignsScheduled/u);
  assert.match(platform, /deliveriesFailed/u);
  assert.match(
    read("apps/dashboard/src/app/(protected)/infrastructure/page.tsx"),
    /Background jobs/u,
  );
});

test("MCP is a target-configured back-office adapter with no legacy SaaS gate", () => {
  const paths = [
    ...sourceFiles("apps/mcp/src"),
    "apps/mcp/.env.example",
    "apps/mcp/README.md",
    "apps/mcp/server.json",
    ...sourceFiles("apps/mcp/plugin"),
    ...sourceFiles("workers/mcp/src"),
  ];
  const forbidden = [
    /mcp\.opengrow\.io/iu,
    /app\.opengrow\.io/iu,
    /docs\.opengrow\.io/iu,
    /quota_exceeded/u,
    /has_subscription/u,
    /mau_limit/u,
    /current_mau/u,
    /subscribe to a paid plan/iu,
    /20M\+/u,
  ];
  for (const path of paths) {
    const source = read(path);
    for (const token of forbidden) {
      assert.equal(
        token.test(source),
        false,
        `${path} still contains ${token}`,
      );
    }
  }
  assert.match(read("apps/mcp/plugin/.mcp.json"), /\$\{SUPERBOARD_MCP_URL\}/u);
  const apiClient = read("apps/mcp/src/api-client.ts");
  assert.match(apiClient, /env\.SUPERBOARD_API_URL/u);
  assert.match(apiClient, /normalizeApiBaseUrl\(env\.OPENGROW_API_URL/u);
  assert.match(read("workers/mcp/src/index.ts"), /env\.API_SERVICE\.fetch/u);
  assert.match(
    read("scripts/cloudflare-config.mjs"),
    /PUBLIC_MCP_URL: publicMcpUrl\(target\)/u,
  );
  assert.match(
    read("scripts/dashboard-cloudflare.mjs"),
    /NEXT_PUBLIC_MCP_URL: publicMcpUrl\(target\)/u,
  );
  const oauth = read("workers/api/src/routes/mcp-oauth.ts");
  assert.match(oauth, /MCP consent URL is not configured/u);
  assert.equal(oauth.includes("originFor(c)"), false);
  for (const targetPath of [
    "deploy/targets/mbza-development.json",
    "deploy/targets/vocostar.json",
  ]) {
    const target = JSON.parse(read(targetPath));
    assert.equal(
      typeof target.domains.mcp,
      "string",
      `${targetPath} needs an MCP domain`,
    );
    assert.equal(
      typeof target.workers.mcp,
      "object",
      `${targetPath} needs an MCP Worker`,
    );
  }
});

test("internal operator credentials are header-only and timing-safe", () => {
  const automation = read("workers/api/src/routes/automation.ts");
  const diagnostics = read("workers/api/src/routes/diagnostics.ts");
  const sdkAuthentication = read("workers/api/src/middleware/auth.ts");
  const push = read("workers/api/src/routes/push.ts");
  const iap = read("workers/api/src/routes/iap.ts");
  const sso = read("workers/api/src/routes/identity-sso.ts");

  assert.match(automation, /timingSafeEqual\(provided, expected\)/u);
  assert.equal(automation.includes("c.req.query('key')"), false);
  assert.match(diagnostics, /timingSafeEqual\(provided, expected\)/u);
  assert.equal(diagnostics.includes("searchParams.get('api_key')"), false);
  assert.equal(sdkAuthentication.includes("c.req.query('api_key')"), false);
  assert.match(push, /timingSafeEqual\(provided, c\.env\.PUSH_PROCESS_KEY\)/u);
  assert.match(iap, /timingSafeEqual\(provided, c\.env\.IAP_PROCESS_KEY\)/u);
  assert.match(sso, /timingSafeEqual\(await hmacHex/u);
});
