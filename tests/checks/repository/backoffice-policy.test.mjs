import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
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
				!["__tests__", "build", "coverage", "dist", "node_modules"].includes(entry.name)
			) {
				paths.push(...sourceFiles(path));
			}
		} else if (
			(!/\.(?:test|spec)\./u.test(entry.name) &&
				/\.(?:ts|tsx|js|mjs|cjs|json|md|dart|swift|kt|java)$/u.test(entry.name)) ||
			entry.name === ".env.example"
		) {
			paths.push(path);
		}
	}
	return paths;
}

test("deployment targets have no SuperBoard edition or usage plan", () => {
	const targetDir = join(root, "infra", "targets");
	const targets = readdirSync(targetDir)
		.filter((name) => name.endsWith(".json") && name !== "schema.json")
		.map((name) => JSON.parse(readFileSync(join(targetDir, name), "utf8")));

	assert.ok(targets.length > 0);
	for (const target of targets) {
		assert.equal("accessMode" in target, false, `${target.target} declares accessMode`);
		assert.equal(target.features?.billing === true || target.features?.billing === false, true);
	}

	const schema = read("infra/targets/schema.json");
	assert.equal(schema.includes('"accessMode"'), false);
});

test("the root project references a target instead of duplicating its domains", () => {
	const project = JSON.parse(read("superboard.project.json"));
	assert.deepEqual(project.development, { target: "mbza-development" });
	const target = JSON.parse(read("infra/targets/mbza-development.json"));
	assert.equal(target.domains.shortlinks, "in.mbza.dev");
});

test("public repository workflow never requires a platform read token", () => {
	const paths = [
		"README.md",
		"docs/DEVELOPMENT_WORKFLOW.md",
		"sdks/flutterflow/README.md",
		...(existsSync(join(root, ".github/workflows"))
			? readdirSync(join(root, ".github/workflows"))
					.filter((file) => /\.ya?ml$/u.test(file))
					.map((file) => `.github/workflows/${file}`)
			: []),
	];

	for (const path of paths) {
		const source = read(path);
		assert.equal(
			source.includes("SUPERBOARD_PLATFORM_READ_TOKEN"),
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
	assert.equal(existsSync(join(root, "scripts/cloudflare-connect-builds.mjs")), false);
	assert.equal("cloudflare:connect-builds" in JSON.parse(read("package.json")).scripts, false);
	const deploymentMatrix = JSON.parse(read("scripts/config/cloudflare-deployments.json"));
	const authorities = Object.fromEntries(
		deploymentMatrix.deployments.map(({ id, automaticDeployment }) => [
			id,
			automaticDeployment.authority,
		]),
	);
	assert.deepEqual(authorities, {
		"mbza-development": "cloudflare-workers-builds",
	});
	assert.match(read("docs/CLOUDFLARE.md"), /one automatic deployment authority per target/u);
});

test("runtime and plugin Front do not expose legacy SuperBoard SaaS controls", () => {
	const runtimeFiles = [
		"scripts/cloudflare/config.mjs",
		"packages/plugins/supbrd-core/api/src/lib/deployment.ts",
		"packages/plugins/supbrd-core/api/src/lib/jobs.ts",
		"packages/plugins/supbrd-core/api/src/lib/maintenance.ts",
		"packages/plugins/supbrd-core/api/src/routes/admin.ts",
		"packages/plugins/supbrd-core/api/src/routes/instances.ts",
		"packages/plugins/supbrd-core/api/src/routes/redirect.ts",
		"packages/supbrd-front-ui/src/shared/lib/config.ts",
		"packages/supbrd-front-ui/src/shared/lib/queryKeys.ts",
		"packages/plugins/supbrd-core/src/front/settings/app/(protected)/project-settings/page.tsx",
	];
	const forbidden = [
		"SUPERBOARD_ACCESS_MODE",
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
			assert.equal(source.includes(token), false, `${path} still contains ${token}`);
		}
	}

	for (const removedPath of [
		"packages/plugins/supbrd-core/src/front/settings/components/settings/PlanSection.tsx",
		"packages/plugins/supbrd-core/src/front/settings/components/settings/EnterpriseDialog.tsx",
		"packages/plugins/supbrd-core/src/front/settings/hooks/queries/usePaymentsQueries.ts",
		"packages/plugins/supbrd-core/src/front/settings/api/payments/paymentsService.ts",
		"packages/plugins/supbrd-core/src/front/settings/lib/edition.ts",
	]) {
		assert.equal(existsSync(join(root, removedPath)), false, `${removedPath} still exists`);
	}
});

test("store purchases remain an application capability", () => {
	const deployment = read("packages/plugins/supbrd-core/api/src/lib/deployment.ts");
	const purchases = read("packages/plugins/supbrd-core/api/src/routes/purchases-sdk.ts");
	const target = JSON.parse(read("infra/targets/mbza-development.json"));

	assert.match(deployment, /configured === true \|\| Number\(configured\) === 1/);
	assert.match(purchases, /isPurchasesEnabled\(c\.env, project\.purchases_enabled\)/);
	assert.equal(target.features.billing, true);
});

test("copyable SDK setup uses target-owned public origins", () => {
	const setup = read(
		"packages/plugins/supbrd-core/src/front/settings/components/app/SdkSetupWizard.tsx",
	);
	const preview = read(
		"packages/plugins/supbrd-plug-communication/src/front/dynamic-links/components/dynamic_links/social-preview/SocialPreviewPageContent.tsx",
	);

	assert.equal(setup.includes("sdk.example.com"), false);
	assert.equal(setup.includes("links.example.com"), false);
	assert.match(setup, /config\.sdkUrl/);
	assert.match(setup, /config\.shortlinkUrl/);
	assert.match(preview, /config\.shortlinkUrl/);
});

test("Site and Front ship without PostHog runtime or environment variables", () => {
	for (const path of [
		"apps/site/package.json",
		"packages/supbrd-front-ui/package.json",
		"packages/plugins/supbrd-core/package.json",
	]) {
		const metadata = JSON.parse(read(path));
		assert.equal(metadata.dependencies?.["posthog-js"], undefined, path);
	}
	for (const path of [
		...sourceFiles("apps/site/src"),
		...sourceFiles("packages/supbrd-front-ui/src"),
		...sourceFiles("packages/plugins/supbrd-core/src/front"),
	])
		assert.doesNotMatch(read(path), /from\s+["']posthog-js["']|POSTHOG/u, path);
	assert.doesNotMatch(read("apps/site/wrangler.jsonc"), /POSTHOG/u);
});

test("reusable platform source and examples contain no application hostname or embedded project key", () => {
	const reusableFiles = [
		...new Set([
			...sourceFiles("packages/plugins"),
			...sourceFiles("apps/site/src"),
			...sourceFiles("apps/mcp/src"),
			...sourceFiles("packages"),
			...sourceFiles("sdks/flutter/lib"),
			...sourceFiles("sdks/flutterflow/lib"),
			...sourceFiles("sdks/ios/Sources"),
			...sourceFiles("sdks/android/SuperBoard/SuperBoard/src/main"),
			...sourceFiles("sdks/javascript/src"),
			...sourceFiles("sdks/react-native/src"),
			...sourceFiles("sdks/react-native/example/src"),
			"package.json",
			"apps/site/package.json",
			"apps/site/public/robots.txt",
			"sdks/android/README.md",
			"sdks/flutter/README.md",
			"sdks/ios/README.md",
			"sdks/javascript/README.md",
			"sdks/react-native/README.md",
			"sdks/javascript/public/index.html",
			"packages/plugins/supbrd-plug-communication/email/README.md",
		]),
	];

	for (const path of reusableFiles) {
		const source = read(path);
		assert.equal(
			/(?:mbza\.dev|reference-production\.com)/u.test(source),
			false,
			`${path} embeds an application hostname`,
		);
		assert.equal(/superboardt_[a-f0-9]{32,}/iu.test(source), false, `${path} embeds a project key`);
		assert.equal(
			/superboard\.io/iu.test(source),
			false,
			`${path} embeds a legacy SuperBoard SaaS origin`,
		);
	}
});

test("back-office health includes transactional, newsletter and delivery-job state", () => {
	const email = read("packages/plugins/supbrd-plug-communication/email/src/index.ts");
	assert.match(email, /messages_transactional/u);
	assert.match(email, /messages_marketing/u);
	assert.match(email, /deliveries_failed/u);

	const marketing = read("packages/plugins/supbrd-plug-communication/marketing/src/index.ts");
	assert.match(marketing, /deliveries_bounced/u);
	assert.match(marketing, /deliveries_complained/u);
	assert.match(marketing, /outbox_dead_letter/u);

	const platform = read("packages/plugins/supbrd-core/api/src/routes/platform-status.ts");
	assert.match(platform, /serviceJobMetrics\(serviceChecks\)/u);
	assert.match(platform, /campaignsScheduled/u);
	assert.match(platform, /deliveriesFailed/u);
	assert.match(
		read(
			"packages/plugins/supbrd-core/src/front/observability/app/(protected)/infrastructure/page.tsx",
		),
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
		...sourceFiles("packages/plugins/supbrd-core/mcp/src"),
	];
	const forbidden = [
		/mcp\.superboard\.io/iu,
		/app\.superboard\.io/iu,
		/docs\.superboard\.io/iu,
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
			assert.equal(token.test(source), false, `${path} still contains ${token}`);
		}
	}
	assert.match(read("apps/mcp/plugin/.mcp.json"), /\$\{SUPERBOARD_MCP_URL\}/u);
	const apiClient = read("apps/mcp/src/api-client.ts");
	assert.match(apiClient, /env\.SUPERBOARD_API_URL/u);
	assert.match(apiClient, /normalizeApiBaseUrl\(env\.SUPERBOARD_API_URL/u);
	assert.match(read("packages/plugins/supbrd-core/mcp/src/index.ts"), /env\.API_SERVICE\.fetch/u);
	assert.match(read("scripts/cloudflare/config.mjs"), /PUBLIC_MCP_URL: publicMcpUrl\(target\)/u);
	assert.match(read("scripts/cloudflare/config.mjs"), /SUPERBOARD_PUBLIC_ENDPOINTS_JSON/u);
	assert.match(
		read("apps/site/src/lib/front-page.ts"),
		/parsePublicEndpoints\(env\.SUPERBOARD_PUBLIC_ENDPOINTS_JSON\)/u,
	);
	const oauth = read("packages/plugins/supbrd-core/api/src/routes/mcp-oauth.ts");
	assert.match(oauth, /MCP consent URL is not configured/u);
	assert.equal(oauth.includes("originFor(c)"), false);
	for (const targetPath of [
		"infra/targets/mbza-development.json",
		"tests/fixtures/cloudflare/targets/reference-production.json",
	]) {
		const target = JSON.parse(read(targetPath));
		assert.equal(typeof target.domains.mcp, "string", `${targetPath} needs an MCP domain`);
		assert.equal(typeof target.workers.mcp, "object", `${targetPath} needs an MCP Worker`);
	}
});

test("internal operator credentials are header-only and timing-safe", () => {
	const automation = read("packages/plugins/supbrd-core/api/src/routes/automation.ts");
	const diagnostics = read("packages/plugins/supbrd-core/api/src/routes/diagnostics.ts");
	const sdkAuthentication = read("packages/plugins/supbrd-core/api/src/middleware/auth.ts");
	const push = read("packages/plugins/supbrd-core/api/src/routes/push.ts");
	const iap = read("packages/plugins/supbrd-core/api/src/routes/iap.ts");
	const sso = read("packages/plugins/supbrd-core/api/src/routes/identity-sso.ts");

	assert.match(automation, /timingSafeEqual\(provided, expected\)/u);
	assert.equal(automation.includes("c.req.query('key')"), false);
	assert.match(diagnostics, /timingSafeEqual\(provided, expected\)/u);
	assert.equal(diagnostics.includes("searchParams.get('api_key')"), false);
	assert.equal(sdkAuthentication.includes("c.req.query('api_key')"), false);
	assert.match(push, /timingSafeEqual\(provided, c\.env\.PUSH_PROCESS_KEY\)/u);
	assert.match(iap, /timingSafeEqual\(provided, c\.env\.IAP_PROCESS_KEY\)/u);
	assert.match(sso, /timingSafeEqual\(await hmacHex/u);
});
