import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { chromium } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4375");
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const databasePath = process.env.SUPERBOARD_RELEASE_TEST_DATABASE;
assert(databasePath?.startsWith("/tmp/"), "Provide the isolated test instance database under /tmp");
const database = new DatabaseSync(databasePath);
const browser = await chromium.launch();
const results = [];
let sequence = Date.now();
const nextId = () => String(++sequence).padStart(26, "0");
const identifiers = () => ({
	front_draft_id: nextId(),
	draft_snapshot_id: nextId(),
	compilation_id: nextId(),
	candidate_id: nextId(),
	release_id: nextId(),
});
try {
	const page = await browser.newPage();
	await page.goto(new URL("/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin", origin).href);
	await page.waitForURL((url) => url.pathname === "/_emdash/admin");
	await api(
		"../plugins/sync",
		{ plan_id: `issue75-${nextId()}`, expires_in_hours: 1, plugin_ids: ["supbrd-plug-audit"] },
		201,
	);
	const original = identifiers();
	await api("user-slice", original, 201);
	const snapshot = {
		input: JSON.parse(
			database
				.prepare(
					"SELECT input_json FROM superboard_front_draft_snapshots WHERE draft_snapshot_id = ?",
				)
				.get(original.draft_snapshot_id).input_json,
		),
	};

	for (const locale of ["en", "fr"]) {
		await page.goto(new URL(`/superboard-system/home?lang=${locale}`, origin).href);
		await page.locator("main h1").waitFor();
		assert.equal(await page.locator("html").getAttribute("lang"), locale);
		const releaseBefore = await page
			.locator('meta[name="superboard-release-id"]')
			.evaluateAll((nodes) => nodes[0]?.getAttribute("content") ?? null);
		for (const defect of ["wrong-owner", "missing-renderer"]) {
			const input = { ...structuredClone(snapshot.input), ...identifiers() };
			const route = {
				...input.front_route_manifest.routes[0],
				route_id: "superboard.issue75_missing_view",
				path_pattern: "/issue75-missing-view",
			};
			if (defect === "missing-renderer") route.renderer_ids = ["issue75.renderer.missing"];
			input.front_route_manifest.routes.push(route);
			database
				.prepare(
					"INSERT INTO superboard_front_drafts (front_draft_id, instance_id, revision, input_json, updated_at) VALUES (?, ?, 1, ?, ?)",
				)
				.run(input.front_draft_id, input.instance_id, JSON.stringify(input), input.created_at);
			database
				.prepare(
					"INSERT INTO superboard_front_draft_snapshots (draft_snapshot_id, front_draft_id, instance_id, draft_revision, input_json, created_at) VALUES (?, ?, ?, 1, ?, ?)",
				)
				.run(
					input.draft_snapshot_id,
					input.front_draft_id,
					input.instance_id,
					JSON.stringify(input),
					input.created_at,
				);

			const refused = await api("compile", { draft_snapshot_id: input.draft_snapshot_id }, 422);
			assert.equal(refused.error.code, "ROUTE_VIEW_NOT_LOADABLE");
			assert.equal(refused.error.failures[0].route_id, route.route_id);
			assert.equal(
				refused.error.failures[0].plugin_id,
				defect === "wrong-owner" ? "supbrd-core" : "unknown",
			);
			await page.reload();
			await page.locator("main h1").waitFor();
			assert.equal(
				await page
					.locator('meta[name="superboard-release-id"]')
					.evaluateAll((nodes) => nodes[0]?.getAttribute("content") ?? null),
				releaseBefore,
			);
			results.push({
				locale,
				defect,
				candidateId: input.candidate_id,
				status: 422,
				diagnostic: refused.error,
				releaseBefore,
				releaseAfter: releaseBefore,
			});
		}
	}
	const valid = await api("compile", { draft_snapshot_id: original.draft_snapshot_id }, 201);
	assert.equal(valid.status, "validated");
	const protectedActivation = await api(
		"activate",
		{
			candidate_id: original.candidate_id,
			activation_id: nextId(),
			expected_active_release_id: null,
		},
		409,
	);
	assert.equal(protectedActivation.error.code, "CANDIDATE_NOT_APPROVED");
	results.push({
		candidateId: original.candidate_id,
		compilationStatus: 201,
		activationStatus: 409,
		diagnostic: protectedActivation.error,
	});

	async function api(endpoint, body, status) {
		const response = await page.request.post(
			new URL(`/_emdash/api/superboard/releases/${endpoint}`, origin).href,
			{
				headers: { Origin: origin.origin, "X-EmDash-Request": "1" },
				data: body,
			},
		);
		const text = await response.text();
		assert.equal(response.status(), status, text.slice(0, 500));
		return JSON.parse(text);
	}
} finally {
	database.close();
	await browser.close();
	if (process.env.SUPERBOARD_RELEASE_ROUTE_REPORT)
		await writeFile(
			process.env.SUPERBOARD_RELEASE_ROUTE_REPORT,
			JSON.stringify({ origin: origin.origin, results }, null, 2),
		);
}
console.log(JSON.stringify({ origin: origin.origin, results }, null, 2));
