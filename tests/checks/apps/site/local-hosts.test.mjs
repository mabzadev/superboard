import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { rm } from "node:fs/promises";
import { request } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { localSiteServerOptions } from "../../../../apps/site/local-vite-config.mjs";
import { localRuntimeConfiguration } from "../../../../scripts/local/start.mjs";

const require = createRequire(new URL("../../../../apps/site/package.json", import.meta.url));
const { dev } = await import(require.resolve("astro"));

await test("local diagnostics do not feed failed tail delivery back into the registry", () => {
	const original = {
		tail_consumers: [{ service: "observability-test" }],
		services: [{ binding: "SITE_SERVICE", service: "site-test" }],
		vars: { SUPERBOARD_PLUGIN_LIFECYCLE: "required" },
		observability: { enabled: true },
	};
	const local = localRuntimeConfiguration(original);
	assert.equal(local.tail_consumers, undefined);
	assert.deepEqual(local.services, original.services);
	assert.deepEqual(local.vars, original.vars);
	assert.deepEqual(local.observability, original.observability);
	assert.equal(original.tail_consumers.length, 1);
});

await test("local Worker requests reach the Site but unrelated hosts are rejected", async (context) => {
	const directory = mkdtempSync(join(tmpdir(), "superboard-site-hosts-"));
	mkdirSync(join(directory, "src/pages"), { recursive: true });
	symlinkSync(
		new URL("../../../../apps/site/node_modules", import.meta.url),
		join(directory, "node_modules"),
		"dir",
	);
	writeFileSync(
		join(directory, "src/pages/index.astro"),
		"<!doctype html><html><body>Site reached</body></html>",
	);
	const server = await dev({
		root: directory,
		configFile: false,
		logLevel: "silent",
		server: { host: "127.0.0.1", port: 0 },
		devToolbar: { enabled: false },
		vite: { server: localSiteServerOptions("/tmp/site-state") },
	});
	context.after(async () => {
		await server.stop();
		await rm(directory, { recursive: true, force: true, maxRetries: 3 });
	});
	const address = server.address;
	assert.ok(address && typeof address !== "string");
	const fetchHost = (host) =>
		new Promise((resolve, reject) => {
			request(
				{
					hostname: "127.0.0.1",
					port: address.port,
					path: "/",
					headers: { Host: host, Accept: "text/html" },
				},
				(response) => {
					response.resume();
					response.once("end", () => resolve(response.statusCode));
				},
			)
				.on("error", reject)
				.end();
		});
	assert.equal(await fetchHost("site.internal"), 200);
	assert.equal(await fetchHost("untrusted.example"), 403);
});
