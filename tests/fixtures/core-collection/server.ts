import { registerRouter } from "../../../packages/contracts/src/route-registry.js";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";

import { Hono } from "hono";

import { collectAnalyticsProjection } from "../../../packages/plugins/superboard-analytics/worker/src/core-collection.js";
import type { Env as AnalyticsEnv } from "../../../packages/plugins/superboard-analytics/worker/src/types.js";
import { collectMarketingSignals } from "../../../packages/plugins/superboard-communication/marketing/src/core-collection.js";
import { resolveSdkProjectContext } from "../../../packages/plugins/superboard-core/api/src/lib/domain-modules.js";
import { pluginHttpAdmission } from "../../../packages/plugins/superboard-core/api/src/lib/plugin-http-admission.js";
import coreCollection, {
	collectSdkTelemetry,
} from "../../../packages/plugins/superboard-core/api/src/routes/core-collection.js";
import type { Env } from "../../../packages/plugins/superboard-core/api/src/types.js";
import { sqliteD1 } from "../../checks/plugins/superboard-core/api/helpers/sqlite-d1.js";

const core = database("../../../packages/plugins/superboard-core/api/migrations/");
const analytics = database("../../../packages/plugins/superboard-analytics/worker/migrations/");
const marketing = database(
	"../../../packages/plugins/superboard-communication/marketing/migrations/",
);
core.sqlite.exec(
	"INSERT INTO instances(id,api_key,uri_scheme) VALUES(10,'browser-sdk-key','test'); INSERT INTO projects(id,instance_id,is_test,name,identifier) VALUES(1,10,0,'Browser','browser'); INSERT INTO applications(id,platform,instance_id,enabled) VALUES(1,'ios',10,1); INSERT INTO ios_configurations(application_id,bundle_id) VALUES(1,'com.example.collection');",
);
let active = false;
let message = "";
let number = 0;
const token = "isolated-collection-test-secret";
const environment = {
	DB: core.db,
	MODULE_INTERNAL_TOKEN: token,
	SUPERBOARD_INSTANCE_ID: "collection-browser",
	SUPERBOARD_PLUGIN_LIFECYCLE: "required",
	SITE_OPERATOR_BRIDGE_TOKEN: "isolated-site-secret",
	SITE_SERVICE: {
		async fetch(request: Request) {
			const body = (await request.json()) as {
				lease_id: string;
				action: string;
				plugin_id: string;
			};
			return active || body.plugin_id === "superboard-marketing"
				? Response.json({
						lease_id: body.lease_id,
						state: body.action === "finish" ? "finished" : "running",
						deadline_at: new Date(Date.now() + 60000).toISOString(),
					})
				: Response.json({ error: { code: "PLUGIN_NOT_ACTIVE" } }, { status: 404 });
		},
	},
} as unknown as Env;
const router = registerRouter(new Hono<{ Bindings: Env }>(), { service: "api", module: "collection-test", pluginId: "supbrd-core", surface: "sdk", access: "sdk-key" });
router.use("*", pluginHttpAdmission);
router.route("/internal/collection/v1", coreCollection);
router.post("/api/v1/analytics/events", async (c) => {
	const resolved = await resolveSdkProjectContext(c.env.DB, c.req.raw, c.env);
	if (!resolved.ok) return Response.json({ error: resolved.code }, { status: resolved.status });
	return collectSdkTelemetry(c, resolved.context.projectId);
});
const consumer = {
	DB: analytics.db,
	INTERNAL_API_TOKEN: token,
	ANALYTICS_ID_HASH_KEY: "isolated-hash-key",
	ANALYTICS_INGEST_QUEUE: { send: async () => undefined },
	API_SERVICE: {
		fetch: (request: Request) =>
			router.fetch(request, environment, {
				props: { superboard_plugin_id: "superboard-analytics" },
				waitUntil: () => undefined,
				passThroughOnException: () => undefined,
			} as unknown as ExecutionContext),
	},
} as unknown as AnalyticsEnv;
const marketingConsumer = {
	DB: marketing.db,
	INTERNAL_API_TOKEN: token,
	ANALYTICS_ID_HASH_KEY: "isolated-hash-key",
	MARKETING_QUEUE: { send: async () => undefined },
	API_SERVICE: {
		fetch: (request: Request) =>
			router.fetch(request, environment, {
				props: { superboard_plugin_id: "superboard-marketing" },
				waitUntil: () => undefined,
				passThroughOnException: () => undefined,
			} as unknown as ExecutionContext),
	},
} as unknown as Parameters<typeof collectMarketingSignals>[0];

const text = {
	fr: {
		title: "Validation isolée de la collecte",
		active: "Analytics actif",
		paused: "Analytics désactivé",
		core: "Événements dans le core",
		receipts: "Reçus durables Analytics",
		marketing: "Lire depuis Marketing",
		marketingReceipts: "Reçus durables Marketing",
		collect: "Envoyer un événement SDK",
		activate: "Activer Analytics",
		pause: "Désactiver Analytics",
		consume: "Lire depuis Analytics",
		replay: "Relire depuis le début",
		note: "Bases SQLite isolées. La disponibilité d’Analytics est simulée et les files de livraison sont neutralisées ; le routage, la signature, la collecte et la consommation utilisent le code du projet.",
	},
	en: {
		title: "Isolated collection verification",
		active: "Analytics active",
		paused: "Analytics disabled",
		core: "Events in core",
		receipts: "Durable Analytics receipts",
		marketing: "Read from Marketing",
		marketingReceipts: "Durable Marketing receipts",
		collect: "Send an SDK event",
		activate: "Enable Analytics",
		pause: "Disable Analytics",
		consume: "Read from Analytics",
		replay: "Replay from the beginning",
		note: "Isolated SQLite databases. Analytics availability is simulated and delivery queues are stubbed; routing, signing, collection and consumption use the project code.",
	},
};
const server = createServer(async (request, response) => {
	try {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		const language = url.searchParams.get("lang") === "en" ? "en" : "fr";
		const t = text[language];
		if (request.method === "POST") {
			if (url.pathname === "/activate") active = true;
			if (url.pathname === "/pause") active = false;
			if (url.pathname === "/collect") {
				const result = await router.request(
					"http://api.internal/api/v1/analytics/events",
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"PROJECT-KEY": "browser-sdk-key",
							PLATFORM: "ios",
							IDENTIFIER: "com.example.collection",
						},
						body: JSON.stringify({
							schema_version: 1,
							event_id: `browser-${++number}`,
							event_name: "screen.viewed",
							source: "sdk",
							application_id: "com.example.collection",
							occurred_at: new Date().toISOString(),
							properties: {},
						}),
					},
					environment,
				);
				message = `HTTP ${result.status}`;
			}
			if (url.pathname === "/replay") analytics.sqlite.exec("DELETE FROM core_collection_cursors");
			if (url.pathname === "/marketing")
				message = JSON.stringify(await collectMarketingSignals(marketingConsumer));
			if (["/consume", "/replay"].includes(url.pathname)) {
				try {
					message = JSON.stringify(await collectAnalyticsProjection(consumer));
				} catch {
					message = active ? "ERROR" : "PLUGIN_NOT_ACTIVE";
				}
			}
			response.writeHead(303, { Location: `/?lang=${language}` });
			response.end();
			return;
		}
		const count = (db: DatabaseSync, table: string) =>
			Number(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get()?.count ?? 0);
		const buttons = ["collect", "activate", "pause", "consume", "replay", "marketing"] as const;
		response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		response.end(
			`<!doctype html><html lang="${language}"><meta charset="utf-8"><title>${t.title}</title><style>body{font:18px system-ui;max-width:760px;margin:60px auto;padding:20px}button{font:inherit;padding:12px;margin:6px}code{display:block;padding:20px;background:#eee}</style><h1>${t.title}</h1><p>${t.note}</p><p>${active ? t.active : t.paused}</p><p>${t.core}: ${count(core.sqlite, "core_collected_events")}</p><p>${t.receipts}: ${count(analytics.sqlite, "analytics_event_receipts")}</p><p>${t.marketingReceipts}: ${count(marketing.sqlite, "marketing_signal_receipts")}</p>${buttons.map((action) => `<form action="/${action}?lang=${language}" method="post"><button>${t[action]}</button></form>`).join("")}<code>${message}</code><a href="/?lang=${language === "fr" ? "en" : "fr"}">${language === "fr" ? "English" : "Français"}</a></html>`,
		);
	} catch (error) {
		console.error(error);
		response.writeHead(500);
		response.end("ERROR");
	}
});
server.listen(4399, "127.0.0.1", () =>
	console.log("Collection browser fixture: http://127.0.0.1:4399"),
);
function database(path: string) {
	const sqlite = new DatabaseSync(":memory:");
	const directory = new URL(path, import.meta.url);
	for (const file of readdirSync(directory)
		.filter((name) => name.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b)))
		sqlite.exec(readFileSync(new URL(file, directory), "utf8"));
	return { sqlite, db: sqliteD1(sqlite) };
}
for (const signal of ["SIGTERM", "SIGINT"] as const)
	process.on(signal, () =>
		server.close(() => {
			core.sqlite.close();
			analytics.sqlite.close();
			marketing.sqlite.close();
			process.exit(0);
		}),
	);
