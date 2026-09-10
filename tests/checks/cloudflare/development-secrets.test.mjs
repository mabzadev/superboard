import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { unstable_getVarsForDev as getVarsForDev } from "wrangler";

import {
	buildDevelopmentSecretPlan,
	developmentSecretConfirmation,
	generateDevelopmentSecretAssignments,
	versionedSecretBulkArgs,
	generateReleaseSigningKey,
	withLocalSecretBindings,
} from "../../../scripts/cloudflare/development-secrets.mjs";
import { loadTarget } from "../../../scripts/cloudflare/target.mjs";

test("local Workers receive supplied optional secrets while unrelated environment values remain hidden", async (context) => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-local-bindings-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const envPath = join(directory, ".env");
	const configPath = join(directory, "wrangler.jsonc");
	await writeFile(
		envPath,
		"CURRENT_TOKEN=current\nPREVIOUS_TOKEN=previous\nPROVIDER_TOKEN=provider\nUNRELATED_TOKEN=unrelated\n",
	);
	const source = {
		vars: { ENVIRONMENT: "local" },
		secrets: { required: ["CURRENT_TOKEN"] },
	};
	const configuration = withLocalSecretBindings(source, {
		CURRENT_TOKEN: "current",
		PREVIOUS_TOKEN: "previous",
		PROVIDER_TOKEN: "provider",
	});
	await writeFile(configPath, JSON.stringify(configuration));
	const bindings = getVarsForDev(
		configPath,
		[envPath],
		configuration.vars,
		undefined,
		true,
		configuration.secrets,
	);
	assert.equal(bindings.PREVIOUS_TOKEN?.value, "previous");
	assert.equal(bindings.PROVIDER_TOKEN?.value, "provider");
	assert.equal(bindings.UNRELATED_TOKEN, undefined);
	assert.deepEqual(source.secrets.required, ["CURRENT_TOKEN"]);
	assert.ok(!JSON.stringify(configuration).includes('"provider"'));
});

test("generated release keys sign verifiable plugin releases without reusing an identity", async () => {
	const first = await generateReleaseSigningKey();
	const second = await generateReleaseSigningKey();
	assert.notEqual(first.kid, second.kid);
	const privateKey = await webcrypto.subtle.importKey(
		"jwk",
		first,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"],
	);
	const { d, ...publicJwk } = first;
	const publicKey = await webcrypto.subtle.importKey(
		"jwk",
		{ ...publicJwk, key_ops: ["verify"] },
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["verify"],
	);
	const payload = new TextEncoder().encode("plugin activation release");
	const signature = await webcrypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		privateKey,
		payload,
	);
	assert.equal(
		await webcrypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			publicKey,
			signature,
			payload,
		),
		true,
	);
	assert.ok(d);
});

test("development secret plan is value-free, account-scoped and deterministic", async () => {
	const { target } = await loadTarget("mbza-development");
	const plan = buildDevelopmentSecretPlan({
		target,
		environment: "development",
		accountId: "a".repeat(32),
		analyticsTokenConfigured: true,
		awsSesConfigured: true,
	});
	assert.equal(plan.valuesIncluded, false);
	assert.equal(plan.blockers.length, 0);
	assert.equal(JSON.stringify(plan).includes("a".repeat(32)), false);
	assert.equal(plan.confirmation, developmentSecretConfirmation(plan));
	assert.equal(
		plan.services.find(({ service }) => service === "site").strategy,
		"generate-and-upload-in-memory",
	);
});

test("development installation does not wait for AWS credentials", async () => {
	const { target } = await loadTarget("mbza-development");
	const plan = buildDevelopmentSecretPlan({
		target,
		environment: "development",
		accountId: "a".repeat(32),
		awsSesConfigured: false,
		analyticsTokenConfigured: false,
	});
	assert.deepEqual(plan.blockers, []);
	const assignments = await generateDevelopmentSecretAssignments({
		target,
		environment: "development",
		accountId: "a".repeat(32),
		appleRootBase64: "apple-root",
		awsSesSmtpUsername: "",
		awsSesSmtpPassword: "",
		awsSesSnsTopicArn: "",
		analyticsToken: "",
	});
	assert.ok(assignments.email.EMAIL_INTERNAL_TOKEN);
	assert.ok(assignments.email.EMAIL_SMTP_ENCRYPTION_KEY);
	assert.equal("AWS_SES_SMTP_PASSWORD" in assignments.email, false);
});

test("development secret plan refuses production and treats analytics credentials as optional", async () => {
	const { target } = await loadTarget("mbza-development");
	assert.throws(
		() =>
			buildDevelopmentSecretPlan({
				target,
				environment: "production",
				accountId: "a".repeat(32),
				analyticsTokenConfigured: true,
				awsSesConfigured: true,
			}),
		/forbidden outside development/u,
	);
	const plan = buildDevelopmentSecretPlan({
		target,
		environment: "development",
		accountId: "a".repeat(32),
		analyticsTokenConfigured: false,
		awsSesConfigured: true,
	});
	assert.equal(plan.blockers.length, 0);
	assert.equal(plan.optionalCapabilities.analyticsQueries, "disabled");
});

test("generated assignments satisfy every private cross-service contract without operator secrets", async () => {
	const { target } = await loadTarget("mbza-development");
	const assignments = await generateDevelopmentSecretAssignments({
		target,
		environment: "development",
		accountId: "a".repeat(32),
		analyticsToken: "",
		appleRootBase64: "apple-root",
		awsSesSmtpUsername: "ses-user",
		awsSesSmtpPassword: "ses-password",
		awsSesSnsTopicArn: "arn:aws:sns:eu-central-1:123456789012:superboard-development",
	});
	assert.equal(assignments.api.MODULE_INTERNAL_TOKEN, assignments.support.INTERNAL_API_TOKEN);
	assert.equal(assignments.api.EMAIL_INTERNAL_TOKEN, assignments.identity.EMAIL_INTERNAL_TOKEN);
	assert.equal(assignments.api.MODULE_INTERNAL_TOKEN, assignments.identity.INTERNAL_API_TOKEN);
	const melodySecrets = JSON.parse(assignments.identity.MELODY_AUTH_SECRETS);
	assert.equal(melodySecrets.v, 1);
	assert.match(melodySecrets.jp, /^[A-Za-z0-9+/]+={0,2}$/u);
	assert.ok(Buffer.byteLength(assignments.identity.MELODY_AUTH_SECRETS) <= 5 * 1024);
	assert.equal(assignments.api.MODULE_INTERNAL_TOKEN, assignments.billing.INTERNAL_API_TOKEN);
	assert.equal(assignments.api.MODULE_INTERNAL_TOKEN, assignments.analytics.INTERNAL_API_TOKEN);
	assert.equal(assignments.api.FLOWS_INTERNAL_TOKEN, assignments.flows.INTERNAL_API_TOKEN);
	assert.notEqual(assignments.api.MODULE_INTERNAL_TOKEN, assignments.api.FLOWS_INTERNAL_TOKEN);
	assert.equal(typeof assignments.analytics.ANALYTICS_ID_HASH_KEY, "string");
	assert.equal(typeof assignments.analytics.ANALYTICS_CONFIG_ENCRYPTION_KEY, "string");
	assert.equal(
		assignments.analytics.ANALYTICS_ID_HASH_KEY,
		assignments.marketing.ANALYTICS_ID_HASH_KEY,
	);
	assert.equal(assignments.api.EMAIL_INTERNAL_TOKEN, assignments.email.EMAIL_INTERNAL_TOKEN);
	assert.equal(assignments.api.EMAIL_INTERNAL_TOKEN, assignments.analytics.EMAIL_INTERNAL_TOKEN);
	assert.equal(assignments.api.EMAIL_INTERNAL_TOKEN, assignments.marketing.EMAIL_INTERNAL_TOKEN);
	assert.equal(Object.hasOwn(assignments.email, "FLOWS_EMAIL_INTERNAL_TOKEN"), false);
	assert.equal(Object.hasOwn(assignments.flows, "EMAIL_INTERNAL_TOKEN"), false);
	assert.equal(typeof assignments.flows.FLOW_USER_ENCRYPTION_KEY, "string");
	assert.equal(typeof assignments.flows.FLOW_USER_HASH_KEY, "string");
	assert.notEqual(assignments.flows.FLOW_USER_HASH_KEY, assignments.flows.FLOW_USER_ENCRYPTION_KEY);
	assert.equal(assignments.identity.FILES_INTERNAL_TOKEN, assignments.files.FILES_INTERNAL_TOKEN);
	assert.equal(typeof assignments.files.FILES_DOWNLOAD_SIGNING_KEY, "string");
	assert.equal(assignments.api.CUSTOM_WORKER_TOKEN, assignments.custom.CUSTOM_WORKER_TOKEN);
	assert.equal(
		assignments.api.PURCHASES_SIGNING_KEYSET,
		assignments.billing.PURCHASES_SIGNING_KEYSET,
	);
	assert.deepEqual(Object.keys(assignments.observability), ["OBSERVABILITY_INTERNAL_TOKEN"]);
	assert.equal(Object.hasOwn(assignments, "dashboard"), false);
	assert.match(assignments.site.EMDASH_ENCRYPTION_KEY, /^emdash_enc_v1_[A-Za-z0-9_-]{43}$/u);
});

test("development assignments include analytics credentials only when supplied", async () => {
	const { target } = await loadTarget("mbza-development");
	const assignments = await generateDevelopmentSecretAssignments({
		target,
		environment: "development",
		accountId: "a".repeat(32),
		analyticsToken: "analytics-token",
		appleRootBase64: "apple-root",
		awsSesSmtpUsername: "ses-user",
		awsSesSmtpPassword: "ses-password",
		awsSesSnsTopicArn: "arn:aws:sns:eu-central-1:123456789012:superboard-development",
	});
	assert.deepEqual(assignments.observability, {
		OBSERVABILITY_INTERNAL_TOKEN: assignments.api.OBSERVABILITY_INTERNAL_TOKEN,
		CLOUDFLARE_ANALYTICS_ACCOUNT_ID: "a".repeat(32),
		CLOUDFLARE_ANALYTICS_TOKEN: "analytics-token",
	});
});

test("secret bootstrap always creates an inactive secret version", () => {
	assert.deepEqual(
		versionedSecretBulkArgs("/tmp/generated.jsonc", "mbza-development", "development", "email"),
		[
			"wrangler",
			"versions",
			"secret",
			"bulk",
			"--config",
			"/tmp/generated.jsonc",
			"--message",
			"SuperBoard generated secrets for mbza-development/development/email",
		],
	);
});
