import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readLocalConfiguration, waitForLocalListener } from "../../../scripts/local/start.mjs";

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
