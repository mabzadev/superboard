import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";

import worker from "../../../packages/plugins/superboard-core/api/src/index.js";
import type { Env } from "../../../packages/plugins/superboard-core/api/src/types.js";
import { sqliteD1 } from "../../checks/plugins/superboard-core/api/helpers/sqlite-d1.js";

const sqlite = new DatabaseSync(":memory:");
const migrations = new URL(
	"../../../packages/plugins/superboard-core/api/migrations/",
	import.meta.url,
);
for (const file of readdirSync(migrations)
	.filter((name) => name.endsWith(".sql"))
	.sort())
	sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
sqlite.exec(
	"INSERT INTO instances(id,api_key,uri_scheme) VALUES(10,'browser-sdk-key','test'); INSERT INTO projects(id,instance_id,is_test,name,identifier) VALUES(1,10,0,'Browser','browser'); INSERT INTO applications(id,platform,instance_id,enabled) VALUES(1,'ios',10,1); INSERT INTO ios_configurations(application_id,bundle_id) VALUES(1,'com.example.routing');",
);
const env = {
	DB: sqliteD1(sqlite),
	API_DOMAIN: "api.example.test",
	SDK_DOMAIN: "sdk.example.test",
	AUTH_DOMAIN: "sdk.example.test",
	FILES_DOMAIN: "sdk.example.test",
	SHORTLINK_DOMAIN: "in.example.test",
	ENVIRONMENT: "test",
	SUPERBOARD_INSTANCE_ID: "routing-browser",
	SUPERBOARD_PLUGIN_LIFECYCLE: "required",
	SITE_OPERATOR_BRIDGE_TOKEN: "isolated-routing-secret",
	SITE_SERVICE: {
		fetch: async () => Response.json({ error: { code: "PLUGIN_NOT_ACTIVE" } }, { status: 404 }),
	},
} as unknown as Env;

const server = createServer(async (incoming, outgoing) => {
	try {
		const local = new URL(incoming.url ?? "/", "http://127.0.0.1:4411");
		const match = /^\/(sdk|api|in)(\/.*)$/u.exec(local.pathname);
		if (match) {
			const chunks: Buffer[] = [];
			for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
			const headers = new Headers();
			for (const [name, value] of Object.entries(incoming.headers))
				if (typeof value === "string" && name !== "host") headers.set(name, value);
			const method = incoming.method ?? "GET";
			const response = await worker.fetch(
				new Request(`https://${match[1]}.example.test${match[2]}${local.search}`, {
					method,
					headers,
					...(!["GET", "HEAD"].includes(method) ? { body: Buffer.concat(chunks) } : {}),
				}),
				env,
				{
					waitUntil: () => undefined,
					passThroughOnException: () => undefined,
				} as unknown as ExecutionContext,
			);
			outgoing.writeHead(response.status, Object.fromEntries(response.headers));
			outgoing.end(Buffer.from(await response.arrayBuffer()));
			return;
		}
		if (local.pathname === "/count") {
			outgoing.setHeader("Content-Type", "application/json");
			outgoing.end(
				JSON.stringify(sqlite.prepare("SELECT COUNT(*) count FROM core_collected_events").get()),
			);
			return;
		}
		const french = local.searchParams.get("lang") === "fr";
		outgoing.setHeader("Content-Type", "text/html; charset=utf-8");
		outgoing.end(`<!doctype html><html lang="${french ? "fr" : "en"}"><meta charset="utf-8"><title>SDK</title><h1>${french ? "Collecte SDK" : "SDK collection"}</h1><button>${french ? "Envoyer" : "Send"}</button><output></output><script>
		document.querySelector('button').onclick = async () => {
		const response = await fetch('/sdk/v1/data/events' + (document.documentElement.lang === 'fr' ? '/' : ''), {method:'POST',headers:{'Content-Type':'application/json','PROJECT-KEY':'browser-sdk-key',PLATFORM:'ios',IDENTIFIER:'com.example.routing'},body:JSON.stringify({schema_version:1,event_id:crypto.randomUUID(),event_name:'screen.viewed',source:'sdk',application_id:'com.example.routing',occurred_at:new Date().toISOString(),properties:{}})});
		document.querySelector('output').textContent = String(response.status);
		};</script></html>`);
	} catch (error) {
		console.error(error);
		outgoing.writeHead(500);
		outgoing.end("ERROR");
	}
});
server.listen(4411, "127.0.0.1", () => console.log("http://127.0.0.1:4411"));
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, () =>
		server.close(() => {
			sqlite.close();
			process.exit(0);
		}),
	);
