import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { build } from "esbuild";
import { Miniflare } from "miniflare";

import { consolidateWorkerConfigurations, deploymentGroups } from "./worker-deployment-groups.mjs";

const worker = (service, extras = {}) => ({
	service,
	config: {
		name: `example-dev-${service}`,
		main: `../../workers/${service}/src/index.ts`,
		compatibility_date: "2026-08-08",
		compatibility_flags: ["nodejs_compat"],
		vars: { ENVIRONMENT: "development" },
		...extras,
	},
});

test("a complete platform groups its real service dependencies into ten deployments", () => {
	const roles = [
		"site",
		"api",
		"identity",
		"files",
		"billing",
		"email",
		"marketing",
		"flows",
		"support",
		"analytics",
		"observability",
		"app",
		"products",
		"paywalls",
		"onboardings",
		"dynamic-links",
		"mcp",
	];
	const result = deploymentGroups(roles);
	assert.equal(result.length, 10);
	assert.deepEqual(result.find(({ id }) => id === "api").services, [
		"api",
		"app",
		"products",
		"paywalls",
		"onboardings",
		"dynamic-links",
		"mcp",
	]);
});

test("grouping preserves distinct databases, credentials, queue policies and private destinations", () => {
	const result = consolidateWorkerConfigurations([
		worker("api", { services: [{ binding: "MARKETING", service: "example-dev-marketing" }] }),
		worker("email", {
			d1_databases: [{ binding: "DB", database_id: "email-db" }],
			secrets: { required: ["TOKEN"] },
			queues: { consumers: [{ queue: "transactional", max_concurrency: 10 }] },
		}),
		worker("marketing", {
			d1_databases: [{ binding: "DB", database_id: "marketing-db" }],
			secrets: { required: ["TOKEN"] },
			queues: { consumers: [{ queue: "campaigns", max_concurrency: 2 }] },
		}),
	]);
	const communication = result.groups.find(({ id }) => id === "communications");
	assert.deepEqual(
		communication.config.d1_databases.map(({ binding, database_id }) => [binding, database_id]),
		[
			["EMAIL__DB", "email-db"],
			["MARKETING__DB", "marketing-db"],
		],
	);
	assert.deepEqual(communication.config.secrets.required, ["EMAIL__TOKEN", "MARKETING__TOKEN"]);
	assert.deepEqual(
		communication.config.queues.consumers.map(({ queue, max_concurrency }) => [
			queue,
			max_concurrency,
		]),
		[
			["transactional", 10],
			["campaigns", 2],
		],
	);
	assert.deepEqual(result.groups.find(({ id }) => id === "api").config.services[0], {
		binding: "MARKETING",
		service: "example-dev-email",
		entrypoint: "SuperboardMarketing",
	});
});

test("a queue cannot acquire two owners during consolidation", () => {
	assert.throws(
		() =>
			consolidateWorkerConfigurations([
				worker("email", { queues: { consumers: [{ queue: "shared" }] } }),
				worker("marketing", { queues: { consumers: [{ queue: "shared" }] } }),
			]),
		/MULTIPLE_QUEUE_CONSUMERS/,
	);
});

test("stateful engines require an explicit migration instead of losing their namespaces", () => {
	assert.throws(
		() =>
			consolidateWorkerConfigurations([
				worker("api"),
				worker("app", { durable_objects: { bindings: [{ name: "ROOM", class_name: "Room" }] } }),
			]),
		/STATEFUL_WORKER_REQUIRES_DEDICATED_DEPLOYMENT/,
	);
});

test("named service bindings execute against their own SQLite store and credential", async () => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-grouped-runtime-"));
	let runtime;
	try {
		const source = `export default { async fetch(request, env) { if (request.method === "POST") { await env.DB.prepare("CREATE TABLE sample(value TEXT)").run(); await env.DB.prepare("INSERT INTO sample(value) VALUES (?)").bind(await request.text()).run(); } const row = await env.DB.prepare("SELECT value FROM sample").first(); return Response.json({ value: row.value, credential: env.TOKEN, otherStoreVisible: "EMAIL__DB" in env || "MARKETING__DB" in env }); } };`;
		await writeFile(join(directory, "email.mjs"), source);
		await writeFile(join(directory, "marketing.mjs"), source);
		const result = consolidateWorkerConfigurations([
			worker("email", {
				main: "./email.mjs",
				d1_databases: [{ binding: "DB", database_id: "email-db" }],
				secrets: { required: ["TOKEN"] },
				routes: [{ pattern: "email.example", custom_domain: true }],
			}),
			worker("marketing", {
				main: "./marketing.mjs",
				d1_databases: [{ binding: "DB", database_id: "marketing-db" }],
				secrets: { required: ["TOKEN"] },
			}),
		]);
		await writeFile(join(directory, "entry.mjs"), result.groups[0].source);
		await build({
			entryPoints: [join(directory, "entry.mjs")],
			outfile: join(directory, "bundle.mjs"),
			bundle: true,
			format: "esm",
			platform: "neutral",
			external: ["cloudflare:workers"],
			logLevel: "silent",
		});
		runtime = new Miniflare({
			workers: [
				{
					name: "caller",
					modules: true,
					script:
						'export default { fetch(request, env) { return (new URL(request.url).pathname === "/email" ? env.EMAIL : env.MARKETING).fetch(request); } }',
					compatibilityDate: "2026-08-08",
					serviceBindings: {
						EMAIL: { name: "grouped", entrypoint: "SuperboardEmail" },
						MARKETING: { name: "grouped", entrypoint: "SuperboardMarketing" },
					},
				},
				{
					name: "grouped",
					modules: true,
					script: await readFile(join(directory, "bundle.mjs"), "utf8"),
					compatibilityDate: "2026-08-08",
					d1Databases: { EMAIL__DB: "email-db", MARKETING__DB: "marketing-db" },
					bindings: { EMAIL__TOKEN: "email-fixture", MARKETING__TOKEN: "marketing-fixture" },
				},
			],
		});
		await runtime.dispatchFetch("https://private.example/email", {
			method: "POST",
			body: "transactional",
		});
		await runtime.dispatchFetch("https://private.example/marketing", {
			method: "POST",
			body: "campaign",
		});
		const response = await runtime.dispatchFetch("https://private.example/marketing");
		assert.deepEqual(await response.json(), {
			value: "campaign",
			credential: "marketing-fixture",
			otherStoreVisible: false,
		});
		const direct = await runtime.dispatchFetch("https://private.example/email");
		assert.deepEqual(await direct.json(), {
			value: "transactional",
			credential: "email-fixture",
			otherStoreVisible: false,
		});
	} finally {
		await runtime?.dispose();
		await rm(directory, { recursive: true, force: true });
	}
});

test("push consumption moves to Communication without retiring a fictitious worker", () => {
	const result = consolidateWorkerConfigurations([
		worker("api", {
			vars: { PUSH_QUEUE_NAME: "push", PUSH_DLQ_NAME: "push-dlq", CREDENTIAL_KEY_SCOPE: "api" },
			d1_databases: [{ binding: "DB", database_id: "api-db" }],
			queues: { consumers: [{ queue: "push" }, { queue: "push-dlq" }, { queue: "events" }] },
		}),
		worker("email"),
	]);
	assert.deepEqual(
		result.groups.find(({ id }) => id === "api").config.queues.consumers.map(({ queue }) => queue),
		["events"],
	);
	assert.deepEqual(
		result.groups
			.find(({ id }) => id === "communications")
			.config.queues.consumers.map(({ queue }) => queue),
		["push", "push-dlq"],
	);
	assert.deepEqual(result.retiredWorkers, []);
});

test("preparation keeps queue consumers, public routes and crons on their existing owner", () => {
	const result = consolidateWorkerConfigurations([
		worker("api", {
			vars: { PUSH_QUEUE_NAME: "push", PUSH_DLQ_NAME: "push-dlq" },
			d1_databases: [{ binding: "DB", database_id: "api-db" }],
			queues: { consumers: [{ queue: "push" }, { queue: "push-dlq" }] },
		}),
		worker("app"),
		worker("email", { queues: { consumers: [{ queue: "mail" }] } }),
		worker("marketing", {
			queues: { consumers: [{ queue: "campaigns" }] },
			routes: [{ pattern: "campaign.example", custom_domain: true }],
			triggers: { crons: ["0 * * * *"] },
		}),
	]);
	const api = result.groups.find(({ id }) => id === "api");
	const communication = result.groups.find(({ id }) => id === "communications");
	assert.deepEqual(
		api.compatibilityConfig.queues?.consumers?.map(({ queue }) => queue),
		["push", "push-dlq"],
	);
	assert.deepEqual(
		communication.compatibilityConfig.queues?.consumers?.map(({ queue }) => queue),
		["mail"],
	);
	assert.deepEqual(communication.compatibilityConfig.routes ?? [], []);
	assert.deepEqual(communication.compatibilityConfig.triggers?.crons ?? [], []);
	assert.deepEqual(
		communication.config.queues.consumers.map(({ queue }) => queue),
		["mail", "campaigns", "push", "push-dlq"],
	);
	assert.deepEqual(result.cronTransfers, [
		{
			service: "marketing",
			from: "example-dev-marketing",
			to: "example-dev-email",
			crons: ["0 * * * *"],
		},
	]);
});

test("queues cannot have duplicate consumers in different deployment groups", () => {
	assert.throws(
		() =>
			consolidateWorkerConfigurations([
				worker("email", { queues: { consumers: [{ queue: "shared" }] } }),
				worker("flows", { queues: { consumers: [{ queue: "shared" }] } }),
			]),
		/MULTIPLE_QUEUE_CONSUMERS/,
	);
});

test("secret readiness includes dedicated workers as well as merged modules", () => {
	const result = consolidateWorkerConfigurations([
		worker("identity", { secrets: { required: ["SESSION_KEY"] } }),
		worker("email", { secrets: { required: ["TOKEN"] } }),
		worker("marketing", { secrets: { required: ["TOKEN"] } }),
	]);
	assert.deepEqual(result.groups.find(({ id }) => id === "auth").secrets, [
		{
			name: "SESSION_KEY",
			sourceName: "SESSION_KEY",
			sourceWorker: "example-dev-identity",
			service: "identity",
		},
	]);
	assert.deepEqual(
		result.groups.find(({ id }) => id === "communications").secrets.map(({ name }) => name),
		["EMAIL__TOKEN", "MARKETING__TOKEN"],
	);
});
