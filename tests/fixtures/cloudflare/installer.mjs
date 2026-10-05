import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createInstaller } from "../../../infra/cloudflare-installer/worker.mjs";

export function cloudflareInstallerFixture() {
	const buildToken = "12345678-1234-1234-1234-123456789012";
	const records = new Map();
	const calls = [];
	const accounts = [
		{ id: "a".repeat(32), name: "First account" },
		{ id: "b".repeat(32), name: "Second account" },
	];
	for (const entry of accounts)
		records.set(entry.id, {
			workers: new Map(),
			triggers: [],
			variables: {},
			builds: [],
			buckets: [],
		});
	return {
		records,
		calls,
		accounts,
		buildToken,
		async fetchImpl(url, init = {}) {
			if (
				url ===
				"https://raw.githubusercontent.com/mabzadev/superboard/main/scripts/cloudflare/workers-builds.mjs"
			)
				return new Response(null, { status: 200 });
			calls.push({ url, method: init.method ?? "GET" });
			if (url === "https://api.github.com/repos/mabzadev/superboard")
				return Response.json({ id: 12, full_name: "mabzadev/superboard", owner: { id: 34 } });
			const parsed = new URL(url);
			const path = parsed.pathname.replace("/client/v4", "");
			const accountId = path.split("/")[2];
			const record = records.get(accountId);
			const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
			let result;
			if (path === "/accounts") result = accounts;
			else if (path === "/zones")
				result = [{ id: "c".repeat(32), name: "example.com", status: "active" }];
			else if (/\/zones\/[^/]+\/(?:dns_records|workers\/routes)$/u.test(path)) result = [];
			else if (path.endsWith("/builds/tokens"))
				result = [{ build_token_uuid: buildToken, build_token_name: "Instance deployment" }];
			else if (path.endsWith("/workers/subdomain")) result = { subdomain: "example" };
			else if (path.endsWith("/workers/scripts")) result = [...record.workers.values()];
			else if (body instanceof FormData) {
				const name = path.split("/").at(-1);
				result = { id: name, tag: "d".repeat(32), metadata: JSON.parse(body.get("metadata")) };
				record.workers.set(name, result);
			} else if (path.endsWith("/subdomain")) result = {};
			else if (path.endsWith("/settings"))
				result = record.workers.get(path.split("/").at(-2)).metadata;
			else if (path.endsWith("/builds/repos/connections"))
				result = { repo_connection_uuid: buildToken };
			else if (path.endsWith("/r2/buckets")) {
				record.buckets.push(body.name);
				result = { name: body.name };
			} else if (path.includes("/r2/buckets/")) {
				if (!record.buckets.includes(path.split("/").at(-1)))
					return Response.json({ success: false }, { status: 404 });
				result = { name: path.split("/").at(-1) };
			} else if (path.endsWith("/environment_variables")) {
				if (body) Object.assign(record.variables, body);
				result = record.variables;
			} else if (path.endsWith("/builds/triggers") && body) {
				result = { ...body, trigger_uuid: buildToken };
				record.triggers.push(result);
			} else if (path.endsWith("/triggers")) result = record.triggers;
			else if (path.endsWith("/builds")) {
				result = { build_uuid: buildToken, status: "queued" };
				record.builds.push({ ...body, ...result });
			} else throw new Error(`Unexpected fixture API ${path}`);
			return Response.json({ success: true, result });
		},
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const fixture = cloudflareInstallerFixture();
	const worker = createInstaller(fixture.fetchImpl);
	createServer(async (request, response) => {
		try {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const body = Buffer.concat(chunks);
			const result = await worker.fetch(
				new Request(`http://127.0.0.1:4768${request.url}`, {
					method: request.method,
					headers: request.headers,
					...(body.length ? { body } : {}),
				}),
			);
			response.writeHead(result.status, Object.fromEntries(result.headers));
			response.end(Buffer.from(await result.arrayBuffer()));
		} catch {
			response.writeHead(500);
			response.end();
		}
	}).listen(4768, "127.0.0.1", () =>
		console.log("Installer browser fixture: http://127.0.0.1:4768 (simulated Cloudflare API)"),
	);
}
