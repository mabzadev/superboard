import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire, findPackageJSON } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
	localProcessEnvironment,
	readLocalConfiguration,
	waitForLocalListener,
} from "../../../scripts/local/start.mjs";

const repository = new URL("../../../", import.meta.url);

function siteMiniflare() {
	const site = createRequire(new URL("apps/site/package.json", repository));
	const vitePlugin = findPackageJSON(
		"@cloudflare/vite-plugin",
		pathToFileURL(site.resolve("@astrojs/cloudflare")),
	);
	return createRequire(realpathSync(vitePlugin)).resolve("miniflare");
}

function workerMiniflare() {
	const root = createRequire(new URL("package.json", repository));
	return createRequire(root.resolve("wrangler")).resolve("miniflare");
}

function registryPath(miniflare, expression, environment) {
	const result = spawnSync(
		process.execPath,
		["-e", `console.log(require(${JSON.stringify(miniflare)}).${expression})`],
		{ encoding: "utf8", env: environment },
	);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trim();
}

test("local startup reads formatted Wrangler JSONC before adding secret requirements", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-local-config-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const path = join(directory, "wrangler.jsonc");
	await writeFile(
		path,
		'{\n// Local bindings\n"name": "site",\n"secrets": {"required": ["TOKEN",],},\n}',
	);
	const configuration = await readLocalConfiguration(path);
	assert.equal(configuration.name, "site");
	assert.deepEqual(configuration.secrets.required, ["TOKEN"]);
});

test("local startup waits for the runtime instead of accepting its booting proxy", async (t) => {
	let requests = 0;
	const server = createServer((_request, response) => {
		response.writeHead(++requests < 3 ? 503 : 404);
		response.end();
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	await waitForLocalListener(`http://127.0.0.1:${server.address().port}`, {
		timeoutMs: 5000,
	});
	assert.equal(requests, 3);
});

test("local startup stops waiting when a child process exits", async () => {
	await assert.rejects(
		waitForLocalListener("http://127.0.0.1:1", { isClosed: () => true }),
		/stopped before becoming ready/u,
	);
});

test("local startup has a bounded wait for an unreachable runtime", async () => {
	await assert.rejects(
		waitForLocalListener("http://127.0.0.1:1", { timeoutMs: 50 }),
		/did not become ready/u,
	);
});

test("local startup accepts a running service while its dependencies are still starting", async (t) => {
	const server = createServer((_request, response) => {
		response.writeHead(503, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ service: "email", status: "misconfigured" }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	await waitForLocalListener(`http://127.0.0.1:${server.address().port}/health`, {
		timeoutMs: 1000,
	});
});

test("upgrading a legacy local encryption key preserves ciphertext decryption", async () => {
	const { normalizeLocalEncryptionKey } = await import("../../../scripts/local/start.mjs");
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const legacy = Buffer.from(bytes).toString("base64");
	const original = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt"]);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		original,
		new TextEncoder().encode("retained local data"),
	);
	const normalized = normalizeLocalEncryptionKey(legacy);
	const keyBytes = Buffer.from(normalized.slice("emdash_enc_v1_".length), "base64url");
	const upgraded = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
	assert.equal(
		new TextDecoder().decode(
			await crypto.subtle.decrypt({ name: "AES-GCM", iv }, upgraded, ciphertext),
		),
		"retained local data",
	);
	assert.equal(normalizeLocalEncryptionKey(normalized), normalized);
	assert.throws(
		() => normalizeLocalEncryptionKey("invalid-local-key"),
		/Invalid local encryption key/u,
	);
});

test("local Workers and the Site find each other in one development registry", () => {
	const environment = localProcessEnvironment(
		{ HOME: tmpdir(), PATH: process.env.PATH },
		"/srv/local",
	);
	const workers = registryPath(
		workerMiniflare(),
		'resolveDevRegistryPath("/srv/wrangler-registry")',
		environment,
	);
	const site = registryPath(siteMiniflare(), "getDefaultDevRegistryPath()", environment);
	assert.equal(site, workers);
});
