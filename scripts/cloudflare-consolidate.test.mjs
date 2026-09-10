import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	assertConsolidatedDeploymentReady,
	runConsolidatedDeployment,
} from "./cloudflare-consolidate.mjs";
import { renderRootPackage } from "./emdash-overlay.mjs";

for (const source of ["checkout", "upstream regeneration"]) {
	void test(`Cloudflare MCP validation works without Docker after ${source}`, (context) => {
		const directory = mkdtempSync(join(tmpdir(), "superboard-mcp-without-docker-"));
		context.after(() => rmSync(directory, { recursive: true, force: true }));
		const manifest =
			source === "checkout"
				? JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
				: renderRootPackage(
						{},
						JSON.parse(
							readFileSync(new URL("../config/emdash-root.overlay.json", import.meta.url), "utf8"),
						),
					);
		writeFileSync(
			join(directory, "pnpm"),
			'#!/bin/sh\nif [ "$1 $2" = "run mcp:docker:check" ]; then exit 127; fi\nexit 0\n',
			{ mode: 0o755 },
		);
		writeFileSync(
			join(directory, "docker"),
			'#!/bin/sh\necho "Docker is unavailable" >&2\nexit 127\n',
			{ mode: 0o755 },
		);
		const log = join(directory, "validation.log");
		writeFileSync(
			join(directory, "node"),
			'#!/bin/sh\nprintf "%s\\n" "$*" >> "$MCP_VALIDATION_LOG"\n',
			{ mode: 0o755 },
		);
		const options = {
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${directory}:${process.env.PATH}`,
				MCP_VALIDATION_LOG: log,
			},
		};
		const result = spawnSync("/bin/sh", ["-c", manifest.scripts["mcp:check"]], options);
		assert.equal(result.status, 0, result.stderr);
		assert.match(readFileSync(log, "utf8"), /cloudflare-dry-run\.mjs --service mcp/);
	});
}

const group = (id) => ({
	id,
	label: id,
	services: [id],
	workerName: `example-${id}`,
	configPath: `${id}.jsonc`,
	prepareConfigPath: `${id}-prepare.jsonc`,
	secrets: [],
});
const manifest = {
	groups: [group("api")],
	retiredWorkerCandidates: [],
	queueTransfers: [],
};

test("readiness checks the active version after a successful consolidation", () => {
	const old = {
		created_on: "2026-09-07T00:00:00Z",
		versions: [{ version_id: "old", percentage: 100 }],
	};
	const current = {
		created_on: "2026-09-08T00:00:00Z",
		versions: [{ version_id: "current", percentage: 100 }],
	};
	const run = (_command, args) => {
		if (args.includes("deployments"))
			return JSON.stringify(args.includes("status") ? current : [old, current]);
		if (args.includes("view"))
			return JSON.stringify({
				resources: {
					bindings: [
						{
							name: "SUPERBOARD_DEPLOYMENT_LAYOUT",
							text: args.includes("current") ? "consolidated" : "preparing",
						},
					],
				},
			});
		throw new Error(`Unexpected command: ${args.join(" ")}`);
	};
	assert.equal(assertConsolidatedDeploymentReady(manifest, { env: {} }, run).consolidated, true);
});

test("resuming a partially consolidated deployment preserves already transferred consumers", async () => {
	const api = group("api"),
		communications = group("communications");
	const partial = {
		...manifest,
		groups: [api, communications],
		queueTransfers: [{ queue: "push", from: api.workerName, to: communications.workerName }],
	};
	let owner = communications.workerName;
	const run = (_command, args) => {
		if (args.includes("deployments"))
			return JSON.stringify({
				versions: [{ version_id: args[args.indexOf("--name") + 1], percentage: 100 }],
			});
		if (args.includes("view"))
			return JSON.stringify({
				resources: {
					bindings: [
						{
							name: "SUPERBOARD_DEPLOYMENT_LAYOUT",
							text: args.includes(api.workerName) ? "preparing" : "consolidated",
						},
					],
				},
			});
		if (args.includes("info")) return `Number of Consumers: 1\nConsumers: ${owner}\n`;
		if (args.includes("remove")) {
			owner = null;
			return "";
		}
		if (args.includes("deploy")) {
			const config = args[args.indexOf("--config") + 1];
			if (config === api.prepareConfigPath && owner !== api.workerName)
				throw new Error("QUEUE_ALREADY_OWNED_BY_COMMUNICATIONS");
			return "";
		}
		throw new Error(`Unexpected command: ${args.join(" ")}`);
	};
	await runConsolidatedDeployment({ manifest: partial, env: {} }, run);
	assert.equal(owner, communications.workerName);
});

test("upload-only adds secrets to the uploaded version without publishing active traffic", async () => {
	const api = { ...group("api"), secrets: [{ name: "API__TOKEN" }] };
	let secretPath;
	let uploadedSecrets;
	let activeDeployments = 0;
	const run = (_command, args) => {
		if (args.includes("deploy") || args.includes("bulk")) activeDeployments++;
		if (args.includes("upload")) {
			secretPath = args[args.indexOf("--secrets-file") + 1];
			uploadedSecrets = JSON.parse(readFileSync(secretPath, "utf8"));
			assert.equal(statSync(secretPath).mode & 0o777, 0o600);
		}
		return "";
	};
	await runConsolidatedDeployment(
		{
			manifest: { ...manifest, groups: [api] },
			readiness: { consolidated: true },
			uploadOnly: true,
			env: { API__TOKEN: "fixture-secret" },
		},
		run,
	);
	assert.equal(activeDeployments, 0);
	assert.deepEqual(uploadedSecrets, { API__TOKEN: "fixture-secret" });
	assert.equal(existsSync(secretPath), false);
});

test("failed uploads remove their temporary secret material", async () => {
	let secretPath;
	await assert.rejects(
		runConsolidatedDeployment(
			{
				manifest: { ...manifest, groups: [{ ...group("api"), secrets: [{ name: "API__TOKEN" }] }] },
				readiness: { consolidated: true },
				uploadOnly: true,
				env: { API__TOKEN: "fixture-secret" },
			},
			(_command, args) => {
				secretPath = args[args.indexOf("--secrets-file") + 1];
				throw new Error("UPLOAD_FAILED");
			},
		),
		/UPLOAD_FAILED/,
	);
	assert.equal(existsSync(secretPath), false);
});

test("an unexpected owner is detected before any worker or consumer is changed", async () => {
	const api = group("api"),
		communications = group("communications");
	let mutations = 0;
	await assert.rejects(
		runConsolidatedDeployment(
			{
				manifest: {
					...manifest,
					groups: [api, communications],
					queueTransfers: [
						{ queue: "push", from: api.workerName, to: communications.workerName },
						{ queue: "campaign", from: "old-marketing", to: communications.workerName },
					],
				},
				readiness: { consolidated: false },
				env: {},
			},
			(_command, args) => {
				if (args.includes("info"))
					return `Number of Consumers: 1\nConsumers: ${args.includes("push") ? api.workerName : "unrelated-worker"}\n`;
				mutations++;
				return "";
			},
		),
		/QUEUE_TRANSFER_OWNER_MISMATCH:campaign/,
	);
	assert.equal(mutations, 0);
});

test("an interrupted queue transfer can resume while the queue has no consumer", async () => {
	const api = group("api"),
		communications = group("communications");
	let owner = null;
	const run = (_command, args) => {
		if (args.includes("info"))
			return `Number of Consumers: ${owner ? 1 : 0}\nConsumers: ${owner ?? ""}\n`;
		if (args.includes("deploy") && args.includes(communications.configPath))
			owner = communications.workerName;
		return "";
	};
	await runConsolidatedDeployment(
		{
			manifest: {
				...manifest,
				groups: [api, communications],
				queueTransfers: [{ queue: "push", from: api.workerName, to: communications.workerName }],
			},
			readiness: {
				consolidated: false,
				groupLayouts: { api: "consolidated", communications: "preparing" },
			},
			env: {},
		},
		run,
	);
	assert.equal(owner, communications.workerName);
});

test("unreadable queue state cannot be treated as an empty consumer list", async () => {
	const api = group("api"),
		communications = group("communications");
	await assert.rejects(
		runConsolidatedDeployment(
			{
				manifest: {
					...manifest,
					groups: [api, communications],
					queueTransfers: [{ queue: "push", from: api.workerName, to: communications.workerName }],
				},
				readiness: { consolidated: true },
				env: {},
			},
			() => "Queue details unavailable",
		),
		/QUEUE_TRANSFER_STATE_UNAVAILABLE/,
	);
});

test("legacy schedules stay active during preparation and stop before the grouped schedule starts", async () => {
	const api = group("api"),
		communications = group("communications");
	const events = [];
	let legacyScheduled = true;
	let groupedScheduled = false;
	const run = (_command, args) => {
		const config = args[args.indexOf("--config") + 1];
		if (config === communications.prepareConfigPath) {
			assert.equal(legacyScheduled, true);
			assert.equal(groupedScheduled, false);
		}
		if (args.includes("triggers")) {
			legacyScheduled = false;
			events.push("stop-legacy");
		} else if (config === communications.configPath) {
			assert.equal(legacyScheduled, false);
			groupedScheduled = true;
			events.push("activate-group");
		} else events.push(config);
		return "";
	};
	await runConsolidatedDeployment(
		{
			manifest: {
				...manifest,
				groups: [api, communications],
				cronTransfers: [
					{
						from: "old-marketing",
						to: communications.workerName,
						crons: ["* * * * *"],
						configPath: "marketing-retire-crons.jsonc",
					},
				],
			},
			readiness: { consolidated: false, groupLayouts: { api: "legacy", communications: "legacy" } },
			env: {},
		},
		run,
	);
	assert.deepEqual(events.slice(-2), ["stop-legacy", "activate-group"]);
	assert.equal(groupedScheduled, true);
});

test("a failed cron removal aborts before starting the grouped schedule and can be retried", async () => {
	const communications = group("communications");
	const input = {
		manifest: {
			...manifest,
			groups: [communications],
			cronTransfers: [
				{
					from: "old-marketing",
					to: communications.workerName,
					crons: ["* * * * *"],
					configPath: "marketing-retire-crons.jsonc",
				},
			],
		},
		readiness: { consolidated: false, groupLayouts: { communications: "preparing" } },
		env: {},
	};
	let removalAttempts = 0;
	let legacyScheduled = true;
	let groupedScheduled = false;
	const run = (_command, args) => {
		if (args.includes("triggers")) {
			legacyScheduled = false;
			if (++removalAttempts === 1) throw new Error("CRON_REMOVAL_RESPONSE_LOST");
		} else if (args.includes(communications.configPath)) {
			assert.equal(legacyScheduled, false);
			groupedScheduled = true;
		}
		return "";
	};
	await assert.rejects(runConsolidatedDeployment(input, run), /CRON_REMOVAL_RESPONSE_LOST/);
	assert.equal(groupedScheduled, false);
	await runConsolidatedDeployment(input, run);
	assert.equal(groupedScheduled, true);
	assert.equal(removalAttempts, 2);
});

test("resuming a finalized group never reapplies the retired worker routes", async () => {
	const communications = group("communications"),
		api = group("api");
	let groupedDeployments = 0;
	await runConsolidatedDeployment(
		{
			manifest: {
				...manifest,
				groups: [api, communications],
				cronTransfers: [
					{
						from: "old-marketing",
						to: communications.workerName,
						crons: ["* * * * *"],
						configPath: "marketing-retire-crons.jsonc",
					},
				],
			},
			readiness: {
				consolidated: false,
				groupLayouts: { communications: "consolidated", api: "preparing" },
			},
			env: {},
		},
		(_command, args) => {
			assert.equal(args.includes("triggers"), false);
			if (args.includes(communications.configPath)) groupedDeployments++;
			return "";
		},
	);
	assert.equal(groupedDeployments, 1);
});
