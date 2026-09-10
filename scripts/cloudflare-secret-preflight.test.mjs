import "./test-targets.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import { requiredSecretInventory, secretInventory } from "./cloudflare-secret-inventory.mjs";
import { evaluateSecretReadiness, parseSecretNames } from "./cloudflare-secret-preflight.mjs";
import { loadTarget } from "./cloudflare-target.mjs";

test("secret readiness parses JSON after package-manager warnings", () => {
	assert.deepEqual(
		parseSecretNames(
			'[WARN] dependencies are out of sync\n[\n {"name":"SIGNING_KEY","type":"secret_text"}\n]\n',
		),
		["SIGNING_KEY"],
	);
	assert.throws(() => parseSecretNames('[]\n[{"name":"KEY"}]'), /parse Wrangler secret list/);
});

test("Email can be deployed before configuring an AWS or SMTP provider", async () => {
	for (const [targetName, environment] of [
		["mbza-development", "development"],
		["reference-production", "production"],
	]) {
		const { target } = await loadTarget(targetName);
		for (const provider of ["aws-ses", "smtp"]) {
			const configured = { ...target, mail: { ...target.mail, transport: "smtp", provider } };
			const requirement = requiredSecretInventory(configured, environment).find(
				({ service }) => service === "email",
			);
			assert.equal(
				evaluateSecretReadiness([requirement], {
					email: ["EMAIL_INTERNAL_TOKEN", "EMAIL_SMTP_ENCRYPTION_KEY"],
				}).ready,
				true,
				`${targetName}/${provider}`,
			);
			assert.equal(evaluateSecretReadiness([requirement], { email: [] }).ready, false);
		}
	}
});

test("every required secret is declared in the upload allowlist", async () => {
	for (const [targetName, environment] of [
		["mbza-development", "development"],
		["reference-production", "production"],
	]) {
		const target = (await loadTarget(targetName)).target;
		const allowed = new Map(
			secretInventory(target).map(({ service, names }) => [service, new Set(names)]),
		);
		for (const requirement of requiredSecretInventory(target, environment)) {
			for (const name of requirement.names) {
				assert.ok(
					allowed.get(requirement.service)?.has(name),
					`${targetName}/${requirement.service} does not allow ${name}`,
				);
			}
			for (const { oneOf } of requirement.alternatives) {
				for (const name of oneOf) {
					assert.ok(
						allowed.get(requirement.service)?.has(name),
						`${targetName}/${requirement.service} does not allow ${name}`,
					);
				}
			}
		}
	}
});

test("billing encryption accepts the keyring or transitional single key", async () => {
	const target = (await loadTarget("reference-production")).target;
	const requirement = requiredSecretInventory(target, "production").find(
		({ service }) => service === "billing",
	);
	const base = Object.fromEntries(requirement.names.map((name) => [name, true]));
	const configured = {
		billing: [...Object.keys(base), "STORE_CREDENTIALS_ENCRYPTION_KEYS"],
	};
	assert.equal(evaluateSecretReadiness([requirement], configured).ready, true);
	assert.equal(evaluateSecretReadiness([requirement], { billing: Object.keys(base) }).ready, false);
});

test("API encryption is required independently from the billing execution mode", async () => {
	for (const [targetName, environment] of [
		["mbza-development", "development"],
		["reference-production", "production"],
	]) {
		const target = (await loadTarget(targetName)).target;
		const requirement = requiredSecretInventory(target, environment).find(
			({ service }) => service === "api",
		);
		assert.ok(requirement.names.includes("STORE_CREDENTIALS_ACTIVE_KEY_VERSION"));
		assert.deepEqual(requirement.alternatives, [
			{
				oneOf: ["STORE_CREDENTIALS_ENCRYPTION_KEYS", "STORE_CREDENTIALS_ENCRYPTION_KEY"],
			},
		]);
	}
});

test("readiness reports names only and pinpoints missing services", () => {
	const report = evaluateSecretReadiness(
		[{ service: "files", names: ["FILES_INTERNAL_TOKEN"], alternatives: [] }],
		{ files: [] },
	);
	assert.equal(report.values_included, false);
	assert.equal(report.ready, false);
	assert.equal(report.services[0].inspectionError, null);
	assert.deepEqual(report.services[0].missing, ["FILES_INTERNAL_TOKEN"]);
});

test("an unavailable Worker inventory blocks readiness without exposing command output", () => {
	const report = evaluateSecretReadiness(
		[{ service: "files", names: ["FILES_INTERNAL_TOKEN"], alternatives: [] }],
		{
			files: ["FILES_INTERNAL_TOKEN"],
		},
		{
			files: "Secret inventory unavailable for Worker opengrow-files-production",
		},
	);

	assert.equal(report.values_included, false);
	assert.equal(report.ready, false);
	assert.deepEqual(report.services[0], {
		service: "files",
		ready: false,
		inspectionError: "Secret inventory unavailable for Worker opengrow-files-production",
		configuredNames: ["FILES_INTERNAL_TOKEN"],
		missing: [],
		unsatisfiedAlternatives: [],
	});
	assert.equal(JSON.stringify(report).includes("stderr"), false);
});

test("Wrangler secret output parser ignores surrounding status text", () => {
	assert.deepEqual(parseSecretNames('status\n[{"name":"ONE"},{"name":"TWO"}]\n'), ["ONE", "TWO"]);
});
