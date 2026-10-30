import {
	registerRouter,
	registeredRequestDefinition,
	resolveRegisteredRoute,
} from "@superboard/contracts/route-registry";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type { AnalyticsEventV1 } from "@superboard/contracts/analytics";
import { consumeCoreCollection } from "@superboard/contracts/core-collection";
import { signPluginTaskRequest } from "@superboard/contracts/plugin-task";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it } from "vitest";

import { app as apiRouter } from "../../../../../../../packages/plugins/superboard-core/api/src/index.js";
import { collectAnalyticsProjection } from "../../../../../../../packages/plugins/superboard-analytics/worker/src/core-collection.js";
import type { Env as AnalyticsEnv } from "../../../../../../../packages/plugins/superboard-analytics/worker/src/types.js";
import { collectMarketingSignals } from "../../../../../../../packages/plugins/superboard-communication/marketing/src/core-collection.js";
import { marketingIdentityHashCandidates } from "../../../../../../../packages/plugins/superboard-communication/marketing/src/identity.js";
import { dispatchDueJourneyEnrollments } from "../../../../../../../packages/plugins/superboard-communication/marketing/src/journeys.js";
import {
	collectEvents,
	readCollectedEvents,
	eraseCollectedSubject,
} from "../../../../../../../packages/plugins/superboard-core/api/src/lib/core-collection.js";
import {
	DOMAIN_SDK_ROUTES,
	proxyDomainSdkModule,
} from "../../../../../../../packages/plugins/superboard-core/api/src/lib/domain-modules.js";
import { pluginHttpAdmission } from "../../../../../../../packages/plugins/superboard-core/api/src/lib/plugin-http-admission.js";
import collection, {
	collectSdkTelemetry,
} from "../../../../../../../packages/plugins/superboard-core/api/src/routes/core-collection.js";
import type { Env } from "../../../../../../../packages/plugins/superboard-core/api/src/types.js";
import { collectCustomerProjection } from "../../../../../../../packages/plugins/superboard-core/app/src/core-collection.js";
import { sqliteD1 } from "../../helpers/sqlite-d1.js";

let sqlite: DatabaseSync;
let db: D1Database;

beforeEach(() => {
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec(
		"PRAGMA foreign_keys=ON; CREATE TABLE projects (id INTEGER PRIMARY KEY,instance_id INTEGER,is_test INTEGER); INSERT INTO projects VALUES (1,10,0),(2,10,1);",
	);
	for (const name of ["0059_analytics_fact_outbox.sql", "0071_core_collection.sql"]) {
		const migration = readFileSync(
			new URL(
				`../../../../../../../packages/plugins/superboard-core/api/migrations/${name}`,
				import.meta.url,
			),
			"utf8",
		);
		sqlite.exec(migration);
		sqlite.exec(migration);
	}
	db = sqliteD1(sqlite) as unknown as D1Database;
});
afterEach(() => sqlite.close());

const event = (id: string): AnalyticsEventV1 => ({
	schema_version: 1,
	event_id: id,
	event_name: "screen.viewed",
	source: "sdk",
	application_id: "com.example.app",
	occurred_at: "2026-09-24T10:00:00.000Z",
	properties: {},
	context: {},
});

it("owns all public telemetry ingestion aliases while leaving plugin reads owned by their plugins", () => {
	for (const path of [
		"/event",
		"/events",
		"/api/v1/sdk/event",
		"/api/v1/collection/events",
		"/api/v1/analytics/events",
		"/api/v1/app/events",
	])
		expect(resolveRegisteredRoute(apiRouter, "POST", "sdk", path)?.route.pluginId).toBe(
			"supbrd-core",
		);
	expect(
		registeredRequestDefinition(
			apiRouter.router
				.match("GET", "/api/v1/analytics/projects/10-prod/events")[0]
				.map(([[, route]]) => route),
		)?.pluginId,
	).toBe("superboard-analytics");
});

it("accepts telemetry without any plugin and lets independent readers replay the same journal", async () => {
	await collectEvents(db, 1, [event("first"), event("second")]);
	const first = await readCollectedEvents(db, { after: 0, limit: 1, projectId: 1 });
	expect(first.items.map((item) => item.event.event_id)).toEqual(["first"]);
	const second = await readCollectedEvents(db, { after: first.nextCursor, limit: 1, projectId: 1 });
	expect(second.items.map((item) => item.event.event_id)).toEqual(["second"]);
	expect(
		(await readCollectedEvents(db, { after: 0, limit: 100, projectId: 1 })).items,
	).toHaveLength(2);
	expect(
		(await readCollectedEvents(db, { after: 0, limit: 100, projectId: 2 })).items,
	).toHaveLength(0);
});

it("deduplicates retries and rejects a conflicting batch without partially accepting it", async () => {
	await collectEvents(db, 1, [event("same")]);
	await collectEvents(db, 1, [event("same")]);
	await expect(
		collectEvents(db, 1, [event("new"), { ...event("same"), event_name: "different" }]),
	).rejects.toThrow();
	expect(
		(await readCollectedEvents(db, { after: 0, limit: 100, projectId: 1 })).items.map(
			(item) => item.event.event_id,
		),
	).toEqual(["same"]);
});

it("captures legacy native and verified billing facts atomically without delivering them to a plugin", async () => {
	await db
		.prepare(
			"INSERT INTO analytics_fact_outbox (id,project_id,fact_key,event_id,payload_json) VALUES (?,?,?,?,?)",
		)
		.bind("legacy", "1", "native:first", "first", JSON.stringify(event("first")))
		.run();
	const result = await readCollectedEvents(db, { after: 0, limit: 100, projectId: 1 });
	expect(result.items[0]?.event.event_id).toBe("first");
	expect(result.items[0]?.project.projectId).toBe(1);
});

function coreEnvironment(): Env {
	return { DB: db, MODULE_INTERNAL_TOKEN: "collection-test-secret" } as Env;
}
function mountedCollection() {
	const router = registerRouter(new Hono<{ Bindings: Env }>(), {
		service: "api",
		module: "collection-test",
		pluginId: "supbrd-core",
		surface: "sdk",
		access: "sdk-key",
	});
	router.route("/internal/collection/v1", collection);
	return { fetch: (request: Request) => router.fetch(request, coreEnvironment()) };
}

it("requires signed plugin reads and rejects a signature reused for another project", async () => {
	await collectEvents(db, 1, [event("private")]);
	const service = mountedCollection();
	const url =
		"https://api.internal/internal/collection/v1/superboard-analytics/events?project_id=1";
	expect((await service.fetch(new Request(url))).status).toBe(401);
	const request = new Request(url);
	const headers = await signPluginTaskRequest(request, "collection-test-secret");
	expect((await service.fetch(new Request(request, { headers }))).status).toBe(200);
	expect(
		(await service.fetch(new Request(url.replace("project_id=1", "project_id=2"), { headers })))
			.status,
	).toBe(401);
});

it("validates SDK telemetry, prevents fabricated verified revenue, and accepts customer events with no plugin binding", async () => {
	const router = registerRouter(new Hono<{ Bindings: Env }>(), {
		service: "api",
		module: "collection-test",
		pluginId: "supbrd-core",
		surface: "sdk",
		access: "sdk-key",
	});
	router.post("/analytics", (c) => collectSdkTelemetry(c, 1));
	router.post("/customer", (c) => collectSdkTelemetry(c, 1, "customer"));
	const post = (path: string, body: unknown) =>
		router.request(
			path,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", IDENTIFIER: "com.example.app" },
				body: JSON.stringify(body),
			},
			coreEnvironment(),
		);
	expect(
		(
			await post("/analytics", {
				...event("spoof"),
				event_name: "superboard.analytics.purchase.verified.v1",
				source: "billing",
			})
		).status,
	).toBe(422);
	expect(
		(
			await post("/customer", {
				events: [{ id: "customer-open", type: "app_open", occurred_at: "2026-09-24T10:00:00Z" }],
			})
		).status,
	).toBe(202);
	expect(
		(await readCollectedEvents(db, { projectId: 1, after: 0, limit: 100 })).items[0],
	).toMatchObject({ trusted: false, event: { event_name: "customer.app_open" } });
	expect((await post("/analytics", event("valid"))).status).toBe(202);
	expect((await post("/analytics", { ...event("valid"), event_name: "conflict" })).status).toBe(
		409,
	);
});

it("lets Analytics catch up after inactivity and replay without duplicating its durable receipts", async () => {
	for (const name of [
		"0001_analytics.sql",
		"0002_countly_capabilities.sql",
		"0003_core_collection_cursor.sql",
	])
		sqlite.exec(
			readFileSync(
				new URL(
					`../../../../../../../packages/plugins/superboard-analytics/worker/migrations/${name}`,
					import.meta.url,
				),
				"utf8",
			),
		);
	const env = {
		DB: db,
		API_SERVICE: mountedCollection(),
		INTERNAL_API_TOKEN: "collection-test-secret",
		ANALYTICS_ID_HASH_KEY: "test-hash",
		ANALYTICS_INGEST_QUEUE: { send: async () => undefined },
	} as unknown as AnalyticsEnv;
	await collectEvents(db, 1, [event("offline-one"), event("offline-two")]);
	expect(sqlite.prepare("SELECT COUNT(*) count FROM analytics_event_receipts").get()?.count).toBe(
		0,
	);
	expect(await collectAnalyticsProjection(env)).toEqual({ consumed: 2, failedProjects: 0 });
	expect(sqlite.prepare("SELECT COUNT(*) count FROM analytics_event_receipts").get()?.count).toBe(
		2,
	);
	sqlite.exec("DELETE FROM core_collection_cursors");
	expect(await collectAnalyticsProjection(env)).toEqual({ consumed: 2, failedProjects: 0 });
	expect(sqlite.prepare("SELECT COUNT(*) count FROM analytics_event_receipts").get()?.count).toBe(
		2,
	);
	expect(
		(await readCollectedEvents(db, { projectId: 1, after: 0, limit: 100 })).items,
	).toHaveLength(2);
});

it("does not acknowledge failed consumption and keeps another project progressing", async () => {
	sqlite.exec(
		"CREATE TABLE core_collection_cursors(consumer TEXT,project_id INTEGER,last_sequence INTEGER,PRIMARY KEY(consumer,project_id))",
	);
	await collectEvents(db, 1, [event("retry")]);
	await collectEvents(db, 2, [event("independent")]);
	const env = {
		DB: db,
		API_SERVICE: mountedCollection(),
		INTERNAL_API_TOKEN: "collection-test-secret",
	};
	expect(
		await consumeCoreCollection(
			env,
			"superboard-support",
			async (item) => item.project.projectId !== 1,
		),
	).toEqual({ consumed: 1, failedProjects: 1 });
	expect(await consumeCoreCollection(env, "superboard-support", async () => true)).toEqual({
		consumed: 1,
		failedProjects: 0,
	});
});

it("erases a subject from the journal and legacy outbox without erasing another project", async () => {
	const subject = { ...event("subject"), user_id: "erased-user" };
	await collectEvents(db, 1, [subject, event("unrelated")]);
	await collectEvents(db, 2, [subject]);
	await db
		.prepare(
			"INSERT INTO analytics_fact_outbox(id,project_id,fact_key,event_id,payload_json) VALUES ('erase-fact','1','erase-fact','legacy-subject',?)",
		)
		.bind(JSON.stringify({ ...subject, event_id: "legacy-subject" }))
		.run();
	await eraseCollectedSubject(db, 1, "erased-user");
	expect(
		(await readCollectedEvents(db, { projectId: 1, after: 0, limit: 100 })).items.map(
			(row) => row.event.event_id,
		),
	).toEqual(["unrelated"]);
	expect(
		(await readCollectedEvents(db, { projectId: 2, after: 0, limit: 100 })).items,
	).toHaveLength(1);
	expect(sqlite.prepare("SELECT COUNT(*) count FROM analytics_fact_outbox").get()?.count).toBe(0);
});

it("routes authenticated customer and Analytics SDK aliases to core even when all plugin admission is unavailable", async () => {
	sqlite.exec(
		"CREATE TABLE instances(id INTEGER PRIMARY KEY,api_key TEXT); INSERT INTO instances VALUES(10,'test-key'); CREATE TABLE applications(id INTEGER PRIMARY KEY,instance_id INTEGER,platform TEXT,enabled INTEGER); INSERT INTO applications VALUES(1,10,'ios',1); CREATE TABLE ios_configurations(application_id INTEGER,bundle_id TEXT); INSERT INTO ios_configurations VALUES(1,'com.example.app');",
	);
	const router = registerRouter(new Hono<{ Bindings: Env }>(), {
		service: "api",
		module: "collection-test",
		pluginId: "supbrd-core",
		surface: "sdk",
		access: "sdk-key",
	});
	router.use("*", pluginHttpAdmission);
	for (const route of DOMAIN_SDK_ROUTES.filter((route) =>
		["/api/v1/app/events", "/api/v1/analytics/events"].includes(route.publicPath),
	))
		router.post(route.publicPath, (c) => proxyDomainSdkModule(c, route));
	const environment = {
		...coreEnvironment(),
		SUPERBOARD_PLUGIN_LIFECYCLE: "required",
		SUPERBOARD_INSTANCE_ID: "isolated",
	};
	const post = (path: string, body: unknown, key = "test-key") =>
		router.request(
			path,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"PROJECT-KEY": key,
					PLATFORM: "ios",
					IDENTIFIER: "com.example.app",
					"Idempotency-Key": "test-batch",
				},
				body: JSON.stringify(body),
			},
			environment,
		);
	expect((await post("/api/v1/analytics/events", event("routed"))).status).toBe(202);
	expect(
		(
			await post("/api/v1/app/events", {
				events: [{ id: "client-routed", type: "app_open", occurred_at: "2026-09-24T10:00:00Z" }],
			})
		).status,
	).toBe(202);
	expect((await post("/api/v1/analytics/events", event("forbidden"), "wrong")).status).toBe(403);
	expect(
		(await readCollectedEvents(db, { projectId: 1, after: 0, limit: 100 })).items,
	).toHaveLength(2);
});

it("projects customer events independently and keeps raw customer identifiers out of the Analytics payload", async () => {
	const appSqlite = new DatabaseSync(":memory:");
	try {
		for (const name of [
			"0001_app.sql",
			"0002_app_domain.sql",
			"0003_customer_analytics.sql",
			"0004_sdk_secret_references.sql",
			"0005_core_collection_cursor.sql",
		])
			appSqlite.exec(
				readFileSync(
					new URL(
						`../../../../../../../packages/plugins/superboard-core/app/migrations/${name}`,
						import.meta.url,
					),
					"utf8",
				),
			);
		appSqlite.exec(
			"INSERT INTO customers(id,project_id,external_id) VALUES('private-customer','1','external')",
		);
		const router = registerRouter(new Hono<{ Bindings: Env }>(), {
			service: "api",
			module: "collection-test",
			pluginId: "supbrd-core",
			surface: "sdk",
			access: "sdk-key",
		});
		router.post("/events", (c) => collectSdkTelemetry(c, 1, "customer"));
		expect(
			(
				await router.request(
					"/events",
					{
						method: "POST",
						headers: { "Content-Type": "application/json", IDENTIFIER: "com.example.app" },
						body: JSON.stringify({
							events: [
								{
									id: "customer-event",
									type: "time_spent",
									occurred_at: "2026-09-24T10:00:00Z",
									customer_id: "private-customer",
									engagement_time: 12,
								},
							],
						}),
					},
					coreEnvironment(),
				)
			).status,
		).toBe(202);
		const base = { API_SERVICE: mountedCollection(), INTERNAL_API_TOKEN: "collection-test-secret" };
		const appEnv = { ...base, DB: sqliteD1(appSqlite) } as Parameters<
			typeof collectCustomerProjection
		>[0];
		expect(await collectCustomerProjection(appEnv)).toEqual({ consumed: 1, failedProjects: 0 });
		expect(
			appSqlite.prepare("SELECT customer_id,engagement_time FROM customer_events").get(),
		).toEqual({ customer_id: "private-customer", engagement_time: 12 });
		for (const name of [
			"0001_analytics.sql",
			"0002_countly_capabilities.sql",
			"0003_core_collection_cursor.sql",
		])
			sqlite.exec(
				readFileSync(
					new URL(
						`../../../../../../../packages/plugins/superboard-analytics/worker/migrations/${name}`,
						import.meta.url,
					),
					"utf8",
				),
			);
		expect(
			await collectAnalyticsProjection({
				...base,
				DB: db,
				ANALYTICS_ID_HASH_KEY: "test-hash",
				ANALYTICS_INGEST_QUEUE: { send: async () => undefined },
			} as unknown as AnalyticsEnv),
		).toEqual({ consumed: 1, failedProjects: 0 });
		const stored = String(
			sqlite.prepare("SELECT payload_json FROM analytics_ingest_outbox").get()?.payload_json,
		);
		expect(stored).not.toContain("private-customer");
		expect(stored).toContain('"engagement_time":12');
		await collectEvents(db, 1, [
			{
				...event("spoof-customer"),
				event_name: "customer.time_spent",
				properties: { customer_event: { id: "spoof", customer_id: "private-customer" } },
			},
		]);
		expect(await collectCustomerProjection(appEnv)).toEqual({ consumed: 1, failedProjects: 0 });
		expect(appSqlite.prepare("SELECT COUNT(*) count FROM customer_events").get()?.count).toBe(1);
	} finally {
		appSqlite.close();
	}
});

it("pauses Analytics processing of native facts while core keeps collecting and resumes later", async () => {
	for (const name of [
		"0001_analytics.sql",
		"0002_countly_capabilities.sql",
		"0003_core_collection_cursor.sql",
	])
		sqlite.exec(
			readFileSync(
				new URL(
					`../../../../../../../packages/plugins/superboard-analytics/worker/migrations/${name}`,
					import.meta.url,
				),
				"utf8",
			),
		);
	sqlite.exec(
		"INSERT INTO analytics_project_settings(project_id,data_collection_enabled) VALUES('1',0)",
	);
	await db
		.prepare(
			"INSERT INTO analytics_fact_outbox(id,project_id,fact_key,event_id,payload_json) VALUES ('pause-fact','1','pause-fact','native',?)",
		)
		.bind(JSON.stringify(event("native")))
		.run();
	const env = {
		DB: db,
		API_SERVICE: mountedCollection(),
		INTERNAL_API_TOKEN: "collection-test-secret",
		ANALYTICS_ID_HASH_KEY: "test-hash",
		ANALYTICS_INGEST_QUEUE: { send: async () => undefined },
	} as unknown as AnalyticsEnv;
	expect(await collectAnalyticsProjection(env)).toEqual({ consumed: 0, failedProjects: 1 });
	await collectEvents(db, 1, [event("while-paused")]);
	expect(
		(await readCollectedEvents(db, { projectId: 1, after: 0, limit: 100 })).items,
	).toHaveLength(2);
	sqlite.exec(
		"UPDATE analytics_project_settings SET data_collection_enabled=1 WHERE project_id='1'",
	);
	expect(await collectAnalyticsProjection(env)).toEqual({ consumed: 2, failedProjects: 0 });
});

it("upgrades a populated legacy outbox, resumes a partial migration and retains cursor order for late events", async () => {
	sqlite.exec("DROP TRIGGER core_collect_legacy_fact; DROP TABLE core_collected_events;");
	const insert = sqlite.prepare(
		"INSERT INTO analytics_fact_outbox(id,project_id,fact_key,event_id,payload_json,status) VALUES (?,'1',?,?,?,'delivered')",
	);
	sqlite.exec("BEGIN");
	for (let index = 0; index < 5000; index++) {
		const id = `legacy-${String(index).padStart(5, "0")}`;
		insert.run(id, id, id, JSON.stringify(event(id)));
	}
	sqlite.exec("COMMIT");
	const migration = readFileSync(
		new URL(
			"../../../../../../../packages/plugins/superboard-core/api/migrations/0071_core_collection.sql",
			import.meta.url,
		),
		"utf8",
	);
	sqlite.exec(migration.slice(0, migration.indexOf("CREATE TRIGGER")));
	sqlite.exec(migration);
	sqlite.exec(migration);
	expect(sqlite.prepare("SELECT COUNT(*) count FROM core_collected_events").get()?.count).toBe(
		5000,
	);
	const last = Number(
		sqlite.prepare("SELECT MAX(sequence) sequence FROM core_collected_events").get()?.sequence,
	);
	await collectEvents(db, 1, [{ ...event("late"), occurred_at: "2000-01-01T00:00:00.000Z" }]);
	const page = await readCollectedEvents(db, { projectId: 1, after: last, limit: 100 });
	expect(page.items.map((item) => item.event.event_id)).toEqual(["late"]);
});

it("lets Marketing enroll from core without Analytics and recover an interrupted delivery without duplicate enrollments", async () => {
	const marketingSqlite = new DatabaseSync(":memory:");
	try {
		const migrations = new URL(
			"../../../../../../../packages/plugins/superboard-communication/marketing/migrations/",
			import.meta.url,
		);
		for (const name of readdirSync(migrations)
			.filter((name) => name.endsWith(".sql"))
			.sort((a, b) => a.localeCompare(b)))
			marketingSqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
		let queueAvailable = false;
		const queued: unknown[] = [];
		const env = {
			DB: sqliteD1(marketingSqlite),
			API_SERVICE: mountedCollection(),
			INTERNAL_API_TOKEN: "collection-test-secret",
			ANALYTICS_ID_HASH_KEY: "test-hash",
			MARKETING_QUEUE: {
				send: async (message: unknown) => {
					if (!queueAvailable) throw new Error("Queue unavailable");
					queued.push(message);
				},
			},
		} as unknown as Parameters<typeof collectMarketingSignals>[0];
		const [hash] = await marketingIdentityHashCandidates(env, 1, "user", "marketing-user");
		marketingSqlite.exec(
			"INSERT INTO subscribers(id,project_id,email,status) VALUES('subscriber',1,'isolated@example.test','enabled')",
		);
		marketingSqlite
			.prepare(
				"INSERT INTO subscriber_identity_aliases(project_id,subscriber_id,identity_kind,identity_hash) VALUES(1,'subscriber','user',?)",
			)
			.run(hash!);
		const definition = JSON.stringify({
			start_node_id: "end",
			nodes: [{ id: "end", type: "exit" }],
			edges: [],
		});
		marketingSqlite
			.prepare(
				"INSERT INTO marketing_journeys(id,project_id,name,status,trigger_event_name,trigger_json,definition_json,created_by) VALUES('journey',1,'Isolated','active','screen.viewed','{\"event_name\":\"screen.viewed\",\"conditions\":[]}',?,'test')",
			)
			.run(definition);
		marketingSqlite
			.prepare(
				"INSERT INTO marketing_journey_versions(project_id,journey_id,version,trigger_json,definition_json,published_by) VALUES(1,'journey',1,'{}',?,'test')",
			)
			.run(definition);
		await collectEvents(db, 1, [{ ...event("marketing-source"), user_id: "marketing-user" }]);
		expect(await collectMarketingSignals(env)).toEqual({ consumed: 0, failedProjects: 1 });
		queueAvailable = true;
		expect(await collectMarketingSignals(env)).toEqual({ consumed: 1, failedProjects: 0 });
		expect(await dispatchDueJourneyEnrollments(env)).toBe(1);
		expect(queued).toHaveLength(1);
		marketingSqlite.exec("DELETE FROM core_collection_cursors");
		expect(await collectMarketingSignals(env)).toEqual({ consumed: 1, failedProjects: 0 });
		expect(
			marketingSqlite.prepare("SELECT COUNT(*) count FROM marketing_journey_enrollments").get()
				?.count,
		).toBe(1);
		expect(
			marketingSqlite
				.prepare("SELECT status,matched_journeys FROM marketing_signal_receipts")
				.get(),
		).toEqual({ status: "matched", matched_journeys: 1 });
	} finally {
		marketingSqlite.close();
	}
});
