import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";

import { installerPage } from "../../../infra/cloudflare-installer/page.mjs";
import { createInstaller, startInstallation } from "../../../infra/cloudflare-installer/worker.mjs";
import { desiredCloudflareResources } from "../../../scripts/cloudflare/bootstrap-core.mjs";
import { installationTarget } from "../../../scripts/cloudflare/installation-target.mjs";
import { validateTarget } from "../../../scripts/cloudflare/target.mjs";
import { cloudflareInstallerFixture } from "../../fixtures/cloudflare/installer.mjs";

const id = "12345678-1234-1234-1234-123456789012";
const input = {
	name: "vocostar",
	domain: "example.com",
	email: "admin@example.com",
	workersDevSubdomain: "example",
	installationId: id,
	accountId: "a".repeat(32),
	buildTokenUuid: id,
	automaticUpdates: true,
	analyticsToken: "simulated-read-only-analytics-token",
};

test("unpublished installation sources stop before any Cloudflare operation", async () => {
	const api = cloudflareInstallerFixture();
	await assert.rejects(
		startInstallation(input, "test-token", (url, init) =>
			url.startsWith("https://raw.githubusercontent.com/")
				? new Response(null, { status: 404 })
				: api.fetchImpl(url, init),
		),
		/INSTALLATION_SOURCE_NOT_PUBLISHED/u,
	);
	assert.equal(api.calls.length, 0);
});

test("source readiness is public and reports an unavailable release", async () => {
	const worker = createInstaller(() => new Response(null, { status: 404 }));
	const response = await worker.fetch(new Request("https://install.example.com/api/readiness"));
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { available: false });
});

test("both localized installer pages contain executable browser code", () => {
	for (const language of ["fr", "en"]) {
		const script = installerPage(language).match(/<script>([\s\S]+)<\/script>/u)[1];
		assert.doesNotThrow(() => new Script(script));
	}
});

test("fresh installations validate and cannot relabel an existing target", async () => {
	const target = installationTarget(input);
	await validateTarget(target);
	await assert.rejects(
		validateTarget({ ...target, target: "existing-instance" }),
		/FRESH_INSTALLATION_IDENTITY_INVALID/u,
	);
	assert.throws(
		() => installationTarget({ ...input, name: "../escape" }),
		/INSTALLATION_NAME_INVALID/u,
	);
	assert.throws(
		() => installationTarget({ ...input, domain: "https://example.com" }),
		/INSTALLATION_DOMAIN_INVALID/u,
	);
});

test("accepted instance names fit the Cloudflare R2 bucket limit", () => {
	let accepted = 0;
	for (let length = 2; length <= 31; length += 1) {
		let target;
		try {
			target = installationTarget({ ...input, name: "a".repeat(length) });
		} catch (error) {
			assert.match(error.message, /INSTALLATION_NAME_INVALID/u);
			continue;
		}
		accepted += 1;
		for (const resource of desiredCloudflareResources(target, "production").filter(
			({ kind }) => kind === "r2",
		))
			assert.ok(resource.name.length <= 63, resource.name);
	}
	assert.ok(accepted > 0);
});

test("installing in a second account creates independent builds and preserves the first account", async () => {
	const api = cloudflareInstallerFixture();
	const first = await startInstallation(input, "test-token", api.fetchImpl);
	const original = structuredClone(api.records.get(input.accountId));
	const second = await startInstallation(
		{ ...input, accountId: "b".repeat(32), name: "punks" },
		"test-token",
		api.fetchImpl,
	);
	assert.equal(first.status, "queued");
	assert.equal(second.status, "queued");
	assert.deepEqual(api.records.get(input.accountId), original);
	for (const state of api.records.values()) {
		assert.equal(state.builds[0].branch, "main");
		assert.deepEqual(state.triggers[0].branch_excludes, ["*"]);
		assert.equal(state.variables.SUPERBOARD_SETUP_API_TOKEN.is_secret, true);
		assert.equal(state.variables.SUPERBOARD_BACKUP_ENCRYPTION_KEY.is_secret, true);
	}
	assert.ok(!JSON.stringify(first).includes("test-token"));
});

test("retrying the same installation does not replace the Worker or launch a second build", async () => {
	const api = cloudflareInstallerFixture();
	await startInstallation(input, "test-token", api.fetchImpl);
	const result = await startInstallation(input, "test-token", api.fetchImpl);
	assert.equal(result.status, "registered");
	assert.equal(api.records.get(input.accountId).builds.length, 1);
	assert.equal(
		api.calls.filter(({ method, url }) => method === "PUT" && url.includes("/workers/scripts/"))
			.length,
		1,
	);
});

test("foreign origins cannot use installer credentials", async () => {
	const api = cloudflareInstallerFixture();
	const worker = createInstaller(api.fetchImpl);
	const response = await worker.fetch(
		new Request("https://install.example.com/api/install", {
			method: "POST",
			headers: {
				Origin: "https://foreign.example",
				Authorization: "Bearer " + "a".repeat(30),
				"X-SuperBoard-Request": "1",
			},
			body: JSON.stringify(input),
		}),
	);
	assert.equal(response.status, 403);
	assert.equal(api.calls.length, 0);
});

test("an API failure cannot report that installation succeeded or expose credentials", async () => {
	const worker = createInstaller(() =>
		Response.json({ success: false, errors: [{ message: "private-token" }] }, { status: 403 }),
	);
	const response = await worker.fetch(
		new Request("https://install.example.com/api/accounts", {
			method: "POST",
			headers: {
				Origin: "https://install.example.com",
				Authorization: "Bearer " + "a".repeat(30),
				"X-SuperBoard-Request": "1",
			},
			body: "{}",
		}),
	);
	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), { error: "CLOUDFLARE_API_403" });
});
