import "../../fixtures/cloudflare/targets.mjs";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
	auditConfigurationBoundaries,
	authenticationSurfaceErrors,
	collectSecretBindingNames,
	findForbiddenSharedOccurrences,
	findHardcodedTargetCommands,
	isIgnoredDirectory,
} from "../../lints/configuration-boundaries.mjs";

test("the standalone repository has its reference profile without an application target", async () => {
	const report = await auditConfigurationBoundaries();
	assert.equal(report.valid, true, report.errors.join("\n"));
	assert.equal(report.classification.reference.target, "mabza-development");
	assert.deepEqual(report.classification.reference.environments, ["development", "local"]);
	assert.ok(report.classification.reference.cloudflareResourceIds > 0);
	const applications = report.classification.applications.map(({ target }) => target);
	assert.deepEqual(applications, []);
	assert.equal(new Set(applications).size, applications.length);
	assert.ok(report.classification.shared.scannedFiles > 0);
	assert.equal(report.classification.injected.accountId.storedInTargetManifest, false);
	assert.equal(report.classification.injected.secretValuesStoredInTargetOrWranglerVars, false);
});

test("a locale cookie prefix is not a reference to a Worker resource", () => {
	assert.deepEqual(
		findForbiddenSharedOccurrences({
			path: "cookie.ts",
			source: 'export const COOKIE = "superboard-locale";',
			ownership: {
				domainSuffixes: [],
				exactLiterals: [
					{ value: "superboard-local", kind: "cloudflare-resource-name", target: "reference" },
				],
			},
		}),
		[],
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
		path: "packages/plugins/superboard-core/api/src/example.ts",
		source: [
			'fetch("https://api.reference.example/v1")',
			`const databaseId = "${resourceId}";`,
			'const receipt = "/Users/example/private/receipt.json";',
		].join("\n"),
		ownership: {
			domainSuffixes: ["mabza.dev", "reference.example"],
			exactLiterals: [
				{
					value: resourceId,
					kind: "cloudflare-resource-id",
					target: "mabza-development",
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
		path: "packages/plugins/superboard-core/api/src/example.ts",
		source: [
			'fetch("https://billing.internal/internal/v1/health")',
			'fetch("https://appleid.apple.com/auth/keys")',
			'fetch("https://api.cloudflare.com/client/v4/accounts")',
		].join("\n"),
		ownership: {
			domainSuffixes: ["mabza.dev", "reference.example"],
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
			ignoredDirectoryNames: [".build", ".gradle", ".swiftpm", "DerivedData", "Pods", "build"],
		},
	};
	for (const [path, name] of [
		["sdks/flutter/native/ios/.build", ".build"],
		["sdks/flutter/native/android/.gradle", ".gradle"],
		["sdks/flutter/native/ios/.swiftpm", ".swiftpm"],
		["sdks/flutter/native/ios/DerivedData", "DerivedData"],
		["sdks/flutter/native/ios/example/Pods", "Pods"],
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
				portable: "node scripts/check.mjs --target $SUPERBOARD_TARGET",
				pinned: "node scripts/check.mjs --target reference-production --environment production",
			},
			["mabza-development", "reference-production"],
		),
		[{ script: "pinned", target: "reference-production" }],
	);
});

test("the Dynamic links operator UI never constructs a plain HTTP short-link URL", async () => {
	const root = new URL(
		"../../../packages/plugins/superboard-acquisition/src/front/dynamic-links/components/",
		import.meta.url,
	);
	const files = (await readdir(root, { recursive: true })).filter((file) => file.endsWith(".tsx"));
	assert.ok(files.some((file) => file.endsWith("SocialPreviewPageContent.tsx")));
	for (const file of files) {
		const source = await readFile(new URL(file, root), "utf8");
		assert.doesNotMatch(source, /`http:\/\/\$\{/u, file);
	}
});

test("consolidated authentication requires the SDK namespace and application signing keys", () => {
	const target = {
		domains: { auth: "sdk.example.test", sdk: "sdk.example.test" },
		authGateway: {
			issuer: "https://sdk.example.test/v1/auth",
			jwksUrl: "https://sdk.example.test/v1/auth/.well-known/application-jwks.json",
		},
	};
	assert.deepEqual(authenticationSurfaceErrors(target), []);
	assert.equal(
		authenticationSurfaceErrors({
			...target,
			authGateway: { ...target.authGateway, issuer: "https://sdk.example.test" },
		}).length,
		1,
	);
	assert.equal(
		authenticationSurfaceErrors({
			...target,
			authGateway: {
				...target.authGateway,
				jwksUrl: "https://sdk.example.test/.well-known/jwks.json",
			},
		}).length,
		1,
	);
	assert.deepEqual(
		authenticationSurfaceErrors({
			domains: { auth: "auth.example.test", sdk: "sdk.example.test" },
			authGateway: {
				issuer: "https://auth.example.test",
				jwksUrl: "https://auth.example.test/.well-known/jwks.json",
			},
		}),
		[],
	);
});
