import { describe, expect, test } from "vitest";

import { validateReleaseRouteViews } from "../../../../apps/site/src/lib/plugin-client-catalog.js";

describe("Front Release Route View Validation", () => {
	const validRenderers = [
		{
			renderer_id: "supbrd-plugmod-analytics.renderer.admin_surface",
			plugin_id: "supbrd-plugmod-analytics",
		},
		{
			renderer_id: "supbrd-plugmod-billing.renderer.admin_surface",
			plugin_id: "supbrd-plugmod-billing",
		},
		{
			renderer_id: "supbrd-plugmod-marketing.renderer.admin_surface",
			plugin_id: "supbrd-plugmod-marketing",
		},
		{
			renderer_id: "emdash.core.renderer.operator_login",
			plugin_id: "supbrd-core",
		},
	];

	test("passes when all routes have loadable views in their owning plugins", async () => {
		const routes = [
			{
				route_id: "superboard.analytics",
				path_pattern: "/analytics",
				renderer_ids: ["supbrd-plugmod-analytics.renderer.admin_surface"],
			},
			{
				route_id: "superboard.communication_statistics",
				path_pattern: "/communication/statistics",
				renderer_ids: ["supbrd-plugmod-marketing.renderer.admin_surface"],
			},
			{
				route_id: "emdash.core.operator_login",
				path_pattern: "/_emdash/admin/login",
				renderer_ids: ["emdash.core.renderer.operator_login"],
			},
		];

		const failures = await validateReleaseRouteViews(routes, validRenderers);
		expect(failures).toEqual([]);
	});

	test("fails with diagnostic identifying plugin and route when component is missing or unmapped", async () => {
		const routes = [
			{
				route_id: "superboard.missing_view_route",
				path_pattern: "/missing-view",
				renderer_ids: ["supbrd-plugmod-analytics.renderer.admin_surface"],
			},
		];

		const failures = await validateReleaseRouteViews(routes, validRenderers);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			route_id: "superboard.missing_view_route",
			path_pattern: "/missing-view",
			plugin_id: "supbrd-plugmod-analytics",
		});
		expect(failures[0]?.error).toContain("View is not registered by supbrd-plugmod-analytics");
	});

	test("fails with diagnostic identifying plugin and route when route is attached to the wrong plugin", async () => {
		const routes = [
			{
				route_id: "superboard.communication_statistics",
				path_pattern: "/communication/statistics",
				renderer_ids: ["supbrd-plugmod-billing.renderer.admin_surface"],
			},
		];

		const failures = await validateReleaseRouteViews(routes, validRenderers);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			route_id: "superboard.communication_statistics",
			path_pattern: "/communication/statistics",
			plugin_id: "supbrd-plugmod-billing",
		});
		expect(failures[0]?.error).toContain("View is not registered by supbrd-plugmod-billing");
	});

	test("fails when renderer descriptor is missing", async () => {
		const routes = [
			{
				route_id: "superboard.orphan_route",
				path_pattern: "/orphan",
				renderer_ids: ["unknown.renderer"],
			},
		];

		const failures = await validateReleaseRouteViews(routes, validRenderers);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			route_id: "superboard.orphan_route",
			path_pattern: "/orphan",
			plugin_id: "unknown",
		});
	});

	test("candidateEvidence marks renderers_ready false and adds route diagnostics when views are not loadable", async () => {
		const candidate = {
			status: "approved" as const,
			approval: null,
			release: {
				payload: {
					instance_id: "test-instance",
					candidate_id: "candidate-1",
					release_id: "release-1",
					created_at: "2026-09-21T00:00:00.000Z",
					front_route_manifest: {
						routes: [
							{
								route_id: "superboard.unmapped_view",
								path_pattern: "/unmapped",
								renderer_ids: ["supbrd-plugmod-analytics.renderer.admin_surface"],
							},
						],
					},
					renderers: validRenderers,
					dependency_policies: [],
				},
				content_checksum: "sha256:1111",
				signature: { algorithm: "ES256" as const, kid: "test-key", value: "sig" },
				validation_receipts: [
					{
						receipt_id: "candidate-1:renderer_compatibility",
						layer: "renderer_compatibility" as const,
						level: "info" as const,
						status: "passed" as const,
						candidate_id: "candidate-1",
						release_id: "release-1",
						content_checksum: "sha256:1111",
						message: "renderer_compatibility validation passed",
						receipt_checksum: "sha256:2222",
					},
				],
				validation_set_checksum: "sha256:3333",
				verification_status: "verified" as const,
			},
		};

		const mockDb = {
			prepare: () => ({
				bind: () => ({
					first: async () => null,
					all: async () => ({ results: [] }),
				}),
			}),
		} as unknown as D1Database;

		const { candidateEvidence } =
			await import("../../../../apps/site/src/lib/front-workflow-repository.js");
		const { validateFrontReleaseCandidate } = await import("@superboard/supbrd-core");

		const evidence = await candidateEvidence(mockDb, candidate as any);
		expect(evidence.renderers_ready).toBe(false);
		expect(evidence.verification.errors.some((e) => e.includes("superboard.unmapped_view"))).toBe(
			true,
		);

		const verification = validateFrontReleaseCandidate(candidate as any, evidence);
		expect(verification.valid).toBe(false);
		expect(verification.errors).toContain("RENDERERS_NOT_READY");
		expect(verification.errors.some((e) => e.includes("superboard.unmapped_view"))).toBe(true);
	});
});
