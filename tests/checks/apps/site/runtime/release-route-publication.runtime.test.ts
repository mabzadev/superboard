import { views } from "@superboard/plugin-analytics/front/index.ts";
import { compileFrontRelease, type FrontReleaseInput } from "@superboard/supbrd-core";
import { SELF, env } from "cloudflare:test";
import { beforeAll, expect, test, vi } from "vitest";

import { composeFrontReleaseInput } from "../../../../../apps/site/src/lib/front-release-composer.js";
import {
	createFrontDraftWithSnapshot,
	getFrontReleaseCandidate,
} from "../../../../../apps/site/src/lib/front-workflow-repository.js";
import {
	createD1FrontReleaseRepository,
	persistReleaseApproval,
	stageCompiledFrontRelease,
} from "../../../../../apps/site/src/lib/release-repository.js";
import { superBoardRuntimePluginCatalog } from "../../../../../apps/site/src/lib/superboard-plugin-catalog.js";

const repository = createD1FrontReleaseRepository(env.DB);
let sequence = 7500;
let activeReleaseId: string;

beforeAll(async () => {
	const synchronized = await request("../plugins/sync", {
		plan_id: "route-view-plan",
		expires_in_hours: 1,
		plugin_ids: ["supbrd-plug-audit"],
	});
	expect(synchronized.status).toBe(201);
	const input = releaseInput();
	await compile(input);
	await approve(input);
	const response = await activate(input);
	expect(await response.json()).toMatchObject({
		status: "activated",
		active_release_id: input.release_id,
	});
	expect(response.status).toBe(201);
	activeReleaseId = input.release_id;
});

test("compilation rejects a business route attributed to core and preserves the active release", async () => {
	const input = releaseInput();
	input.front_route_manifest.routes.push({
		...input.front_route_manifest.routes[0]!,
		route_id: "superboard.communication_statistics",
		path_pattern: "/communication/statistics",
	});
	const before = await repository.getActive(input.instance_id);
	const response = await compile(input, 422);
	expect(await response.json()).toMatchObject({
		error: {
			code: "ROUTE_VIEW_NOT_LOADABLE",
			failures: [{ plugin_id: "supbrd-core", route_id: "superboard.communication_statistics" }],
		},
	});
	expect(response.status).toBe(422);
	expect(await repository.getActive(input.instance_id)).toEqual(before);
	expect(await getFrontReleaseCandidate(env.DB, input.candidate_id)).toBeNull();
});

test("compilation validates every mounted renderer", async () => {
	const input = releaseInput();
	input.front_route_manifest.routes[0]!.renderer_ids.push("missing.renderer");
	const response = await compile(input, 422);
	expect(response.status).toBe(422);
	expect(await response.json()).toMatchObject({ error: { code: "ROUTE_VIEW_NOT_LOADABLE" } });
});

test("compilation rejects a renderer build unavailable in the runtime", async () => {
	const input = releaseInput();
	const rendererId = input.front_route_manifest.routes[0]!.renderer_ids[0];
	input.renderers.find(({ renderer_id }) => renderer_id === rendererId)!.build_checksum =
		`sha256:${"f".repeat(64)}`;
	const response = await compile(input, 422);
	expect(response.status).toBe(422);
	expect(await response.json()).toMatchObject({ error: { code: "ROUTE_VIEW_NOT_LOADABLE" } });
});

test.each(["missing-registration", "import-failure"] as const)(
	"compilation rejects %s in the owning plugin",
	async (defect) => {
		const input = analyticsInput();
		const routeId = "superboard.analytics";
		const renderer = input.renderers.find(
			({ plugin_id }) => plugin_id === "supbrd-plugmod-analytics",
		)!;
		const original = views[routeId];
		if (defect === "missing-registration") Reflect.deleteProperty(views, routeId);
		else vi.spyOn(views, routeId).mockRejectedValue(new Error("Dynamic import failed"));
		try {
			const before = await repository.getActive(input.instance_id);
			const response = await compile(input, 422);
			expect(response.status).toBe(422);
			expect(await response.json()).toMatchObject({
				error: {
					code: "ROUTE_VIEW_NOT_LOADABLE",
					failures: [{ plugin_id: renderer.plugin_id, route_id: routeId }],
				},
			});
			expect(await repository.getActive(input.instance_id)).toEqual(before);
		} finally {
			vi.restoreAllMocks();
			views[routeId] = original;
		}
	},
);

test.each(["missing-registration", "import-failure"] as const)(
	"activation rechecks %s after approval",
	async (defect) => {
		const input = analyticsInput();
		await compile(input);
		await approve(input);
		const routeId = "superboard.analytics";
		const original = views[routeId];
		if (defect === "missing-registration") Reflect.deleteProperty(views, routeId);
		else vi.spyOn(views, routeId).mockRejectedValue(new Error("Dynamic import failed"));
		try {
			const before = await repository.getActive(input.instance_id);
			const response = await activate(input);
			expect(response.status).toBe(409);
			expect(await response.json()).toMatchObject({
				error: {
					code: "ACTIVATION_PREFLIGHT_FAILED",
					errors: expect.arrayContaining([
						expect.stringContaining(
							"ROUTE_VIEW_NOT_LOADABLE:supbrd-plugmod-analytics:superboard.analytics",
						),
					]),
				},
			});
			expect(await repository.getActive(input.instance_id)).toEqual(before);
		} finally {
			vi.restoreAllMocks();
			views[routeId] = original;
		}
	},
);

test("activation rechecks an approved candidate's missing view and leaves the pointer unchanged", async () => {
	const input = releaseInput();
	input.front_route_manifest.routes.push({
		...input.front_route_manifest.routes[0]!,
		route_id: "superboard.missing_view",
		path_pattern: "/missing-view",
	});
	const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]);
	const release = await compileFrontRelease(input, {
		kid: "route-view-regression",
		private_key: keys.privateKey,
	});
	await stageCompiledFrontRelease(
		env.DB,
		release,
		{ ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "route-view-regression" },
		input.created_at,
	);
	await persistReleaseApproval(env.DB, {
		operator_id: "operator-1",
		candidate_id: input.candidate_id,
		release_id: input.release_id,
		content_checksum: release.content_checksum,
		signature: release.signature,
		validation_set_checksum: release.validation_set_checksum,
		warnings_acknowledged: [],
		approved_at: input.created_at,
		reauthenticated_at: input.created_at,
	});
	const before = await repository.getActive(input.instance_id);
	const response = await activate(input);
	expect(await response.json()).toMatchObject({
		error: {
			code: "ACTIVATION_PREFLIGHT_FAILED",
			errors: expect.arrayContaining([
				expect.stringContaining("ROUTE_VIEW_NOT_LOADABLE:supbrd-core:superboard.missing_view"),
			]),
		},
	});
	expect(response.status).toBe(409);
	expect(await repository.getActive(input.instance_id)).toEqual(before);
});

test.each(["missing", "other-candidate", "stale-artifact"] as const)(
	"activation rejects %s renderer evidence",
	async (defect) => {
		const input = releaseInput();
		await compile(input);
		await approve(input);
		const candidate = await getFrontReleaseCandidate(env.DB, input.candidate_id);
		if (!candidate) throw new Error("Candidate missing");
		const release = candidate.release;
		if (defect === "missing") {
			release.validation_receipts = release.validation_receipts.filter(
				({ layer }) => layer !== "renderer_compatibility",
			);
		} else if (defect === "other-candidate") {
			const other = releaseInput();
			await compile(other);
			const donor = await getFrontReleaseCandidate(env.DB, other.candidate_id);
			if (!donor) throw new Error("Donor missing");
			release.validation_receipts = donor.release.validation_receipts;
			release.validation_set_checksum = donor.release.validation_set_checksum;
		} else {
			release.payload.renderers[0]!.build_checksum = `sha256:${"f".repeat(64)}`;
		}
		await env.DB.prepare(
			"UPDATE superboard_front_release_candidates SET release_json = ? WHERE candidate_id = ?",
		)
			.bind(JSON.stringify(release), input.candidate_id)
			.run();
		const before = await repository.getActive(input.instance_id);
		const response = await activate(input);
		const body = await response.json<{ error: { code: string; errors: string[] } }>();
		expect(response.status).toBe(409);
		expect(body.error.code).toBe("ACTIVATION_PREFLIGHT_FAILED");
		expect(body.error.errors).toContain(
			defect === "missing"
				? "RENDERERS_NOT_READY"
				: defect === "other-candidate"
					? "VALIDATION_RECEIPT_CHECKSUM_MISMATCH"
					: "CONTENT_CHECKSUM_MISMATCH",
		);
		expect(await repository.getActive(input.instance_id)).toEqual(before);
	},
);

test("a valid candidate still requires approval and recent reauthentication", async () => {
	const input = releaseInput();
	await compile(input);
	let response = await activate(input);
	expect(response.status).toBe(409);
	expect(await response.json()).toMatchObject({ error: { code: "CANDIDATE_NOT_APPROVED" } });
	await approve(input);
	response = await request(
		"activate",
		{
			candidate_id: input.candidate_id,
			activation_id: crypto.randomUUID(),
			expected_active_release_id: activeReleaseId,
		},
		false,
	);
	expect(response.status).toBe(403);
	expect(await response.json()).toMatchObject({ error: { code: "STRONG_REAUTH_REQUIRED" } });
	expect((await repository.getActive(input.instance_id))?.active_release_id).toBe(activeReleaseId);
});

function analyticsInput() {
	const input = releaseInput();
	const routeId = "superboard.analytics";
	const manifest = superBoardRuntimePluginCatalog().plugins.find(
		(entry) => entry.manifest.plugin_id === "supbrd-plugmod-analytics",
	)!.manifest;
	const renderer = manifest.renderers.find(
		({ renderer_id }) => renderer_id === "supbrd-plugmod-analytics.renderer.admin_surface",
	)!;
	input.plugin_lock.push({
		plugin_id: manifest.plugin_id,
		version: manifest.plugin_version,
		artifact_checksum: manifest.artifact_checksum,
		native: false,
	});
	input.renderers.push(renderer);
	input.front_route_manifest.routes.push({
		...input.front_route_manifest.routes[0]!,
		route_id: routeId,
		path_pattern: "/analytics",
		renderer_ids: [renderer.renderer_id],
	});
	return input;
}

function releaseInput(): FrontReleaseInput {
	const nextId = () => String(++sequence).padStart(26, "0");
	return structuredClone(
		composeFrontReleaseInput(
			{
				instance_id: "reference-production",
				front_draft_id: nextId(),
				draft_snapshot_id: nextId(),
				compilation_id: nextId(),
				candidate_id: nextId(),
				release_id: nextId(),
				release_sequence: sequence,
				previous_release_id: activeReleaseId ?? null,
				plugin_lock: [],
				created_at: new Date().toISOString(),
			},
			[],
			[],
		),
	);
}

async function compile(input: FrontReleaseInput, expectedStatus = 201) {
	await createFrontDraftWithSnapshot(env.DB, { ...input, value: input });
	const response = await request("compile", { draft_snapshot_id: input.draft_snapshot_id });
	expect(response.status).toBe(expectedStatus);
	return response;
}

async function approve(input: FrontReleaseInput) {
	const response = await request("approve", {
		candidate_id: input.candidate_id,
		warnings_acknowledged: [],
	});
	expect(response.status).toBe(201);
}

function activate(input: FrontReleaseInput) {
	return request("activate", {
		candidate_id: input.candidate_id,
		activation_id: crypto.randomUUID(),
		expected_active_release_id: activeReleaseId ?? null,
	});
}

function request(endpoint: string, body: unknown, reauthenticated = true) {
	return SELF.fetch(`https://site.example/_emdash/api/superboard/releases/${endpoint}`, {
		method: "POST",
		headers: {
			Origin: "https://site.example",
			"X-EmDash-Request": "1",
			"X-Parity-Operator": "1",
			"Content-Type": "application/json",
			...(reauthenticated ? { "X-Parity-Reauthenticated": "1" } : {}),
		},
		body: JSON.stringify(body),
	});
}
