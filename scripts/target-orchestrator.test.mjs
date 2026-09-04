import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	assertFreshLocalState,
	buildLocalSite,
	prepareTarget,
	verifyLocalTargetHealth,
} from "./target-orchestrator.mjs";

const LOCAL_STATE_REQUIRED_PATTERN = /requires --local-state/u;
const EMPTY_LOCAL_STATE_REQUIRED_PATTERN = /requires an empty local state directory/u;

test("the blank Instance exercise refuses reused or implicit local state", async () => {
	await assert.rejects(assertFreshLocalState({}), LOCAL_STATE_REQUIRED_PATTERN);
	const directory = await mkdtemp(join(tmpdir(), "superboard-target-exercise-test-"));
	try {
		await assertFreshLocalState({ "local-state": directory });
		await writeFile(join(directory, "existing-state"), "occupied");
		await assert.rejects(
			assertFreshLocalState({ "local-state": directory }),
			EMPTY_LOCAL_STATE_REQUIRED_PATTERN,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("the local target health gate probes every Worker through its declared contract", async () => {
	const prepared = await prepareTarget({
		targetName: "mbza-development",
		environment: "local",
		adapter: "local",
	});
	const requests = [];
	const receipts = await verifyLocalTargetHealth(
		prepared.materialization,
		{ observability: { OBSERVABILITY_INTERNAL_TOKEN: "generated-secret" } },
		{
			attempts: 1,
			fetchImpl: async (request) => {
				requests.push(request);
				return Response.json({ status: "ok" });
			},
		},
	);

	assert.equal(receipts.length, prepared.materialization.services.length);
	assert.ok(receipts.every(({ status }) => status === 200));
	assert.ok(
		requests.some(
			(request) =>
				request.url === "http://127.0.0.1:8787/internal/v1/health" &&
				request.headers.get("x-observability-token") === "generated-secret",
		),
	);
	assert.ok(requests.some((request) => request.url === "http://127.0.0.1:8791/internal/v1/health"));
	assert.ok(
		requests.some((request) => request.url === "http://127.0.0.1:8802/superboard-system/health"),
	);
});

test("local target start builds the Site with the selected target email settings", () => {
	const calls = [];
	buildLocalSite(
		{
			target: {
				mail: {
					fromAddress: "noreply@mbza.dev",
					fromName: "SuperBoard Development",
					replyToAddress: "support@mbza.dev",
				},
			},
		},
		(command, args, env) => calls.push({ command, args, env }),
		{},
	);

	assert.deepEqual(calls, [
		{
			command: "pnpm",
			args: ["--filter", "@superboard/site...", "build"],
			env: {
				SUPERBOARD_SITE_EMAIL_FROM_ADDRESS: "noreply@mbza.dev",
				SUPERBOARD_SITE_EMAIL_FROM_NAME: "SuperBoard Development",
				SUPERBOARD_SITE_EMAIL_REPLY_TO: "support@mbza.dev",
			},
		},
	]);
});
