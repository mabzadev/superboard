import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

import { verifyLocalTargetHealth } from "../../../scripts/cloudflare/target-orchestrator.mjs";

test("local readiness rejects an empty EmDash admin even when the workers report success", async () => {
	await withSite("", async (materialization) => {
		await assert.rejects(
			verifyLocalTargetHealth(materialization, {}, { attempts: 1 }),
			/admin shell/iu,
		);
	});
});

test("local readiness rejects a front page accidentally served instead of EmDash admin", async () => {
	await withSite(
		"<!doctype html><html><body>Superboard works</body></html>",
		async (materialization) => {
			await assert.rejects(
				verifyLocalTargetHealth(materialization, {}, { attempts: 1 }),
				/admin shell/iu,
			);
		},
	);
});

test("local readiness accepts the native admin shell together with the worker health", async () => {
	await withSite(
		'<!doctype html><html><body><div id="admin-root">Loading EmDash</div></body></html>',
		async (materialization) => {
			const receipts = await verifyLocalTargetHealth(materialization, {}, { attempts: 1 });
			assert.ok(
				receipts.some(({ url, status }) => url.endsWith("/_emdash/admin/login") && status === 200),
			);
		},
	);
});

test("cancelled startup stops health verification instead of continuing to poll", async () => {
	await withSite("", async (materialization) => {
		const controller = new AbortController();
		controller.abort(new Error("Startup cancelled"));
		await assert.rejects(
			verifyLocalTargetHealth(materialization, {}, { attempts: 1, signal: controller.signal }),
			/Startup cancelled/u,
		);
	});
});

async function withSite(adminHtml, run) {
	const server = createServer((request, response) => {
		if (request.url === "/_emdash/admin/login") {
			response.writeHead(200, { "Content-Type": "text/html" });
			response.end(adminHtml);
			return;
		}
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end('{"status":"ok"}');
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	try {
		await run({
			healthChecks: [
				{
					id: "health.site",
					service: "site",
					kind: "worker",
					url: `http://127.0.0.1:${address.port}/superboard-system/health`,
				},
			],
		});
	} finally {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
}
