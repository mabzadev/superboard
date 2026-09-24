import {
	parsePluginDiagnostic,
	parsePluginHealth,
	type PluginDiagnosticData,
} from "@superboard/contracts/plugin-diagnostic";
import { expect, test } from "vitest";

const diagnostic: PluginDiagnosticData = {
	pluginId: "supbrd-plug-identity",
	label: "Authentification",
	lifecycle: {
		state: "active",
		changedAt: "2026-09-21T12:00:00.000Z",
		reason: "Initial deployment",
		artifactChecksum: "sha256:abc123",
		planId: "plan-1",
		activatedReleaseId: "rel-1",
	},
	configuration: {
		pluginId: "supbrd-plug-identity",
		version: "1.4.0",
		label: "Authentification",
		capabilities: ["renderer.mount"],
		failurePolicies: {
			reads: "unavailable",
			writes: "fail_closed",
		},
		settingsSchema: {
			type: "object",
			properties: {
				EMAIL_SENDER_NAME: { type: "string" },
			},
		},
	},
	health: {
		status: "ready",
		checkedAt: "2026-09-21T12:05:00.000Z",
		reason: null,
	},
	dependencies: [
		{
			id: "dependency.supbrd_plug_identity",
			status: "ready",
			expiresAt: "2026-09-21T13:00:00.000Z",
			checkedAt: "2026-09-21T12:00:00.000Z",
		},
	],
	workers: [
		{
			service: "identity",
			workerName: "identity",
			physicalName: "mbza-dev-auth",
			deploymentGroup: "auth",
			modules: ["identity"],
			isShared: false,
			sharedWith: [],
		},
	],
	routes: {
		views: [
			{
				routeId: "superboard.auth_settings",
				path: "/auth/settings",
				method: "GET",
			},
		],
		api: [
			{
				method: "POST",
				path: "/api/v1/auth/sign-in",
				surface: "api",
				worker: "identity",
			},
		],
	},
};

test("reads the diagnostic over a JSON boundary without truncating its routes or losing ownership", () => {
	const payload = {
		...diagnostic,
		routes: {
			...diagnostic.routes,
			views: Array.from({ length: 125 }, (_, index) => ({
				routeId: `view-${index}`,
				path: `/views/${index}`,
				method: "GET",
			})),
		},
	};
	const parsed = parsePluginDiagnostic(JSON.parse(JSON.stringify(payload)));
	expect(parsed.pluginId).toBe(payload.pluginId);
	expect(parsed.routes.views).toEqual(payload.routes.views);
	expect(parsed.workers).toEqual(payload.workers);
});

test.each([
	{ status: "ready", checkedAt: null, reason: null },
	{ status: "ready", checkedAt: "invalid", reason: null },
	{ status: "successful", checkedAt: "2026-09-21T12:00:00Z", reason: null },
])("rejects a health result that cannot establish the claimed availability: %j", (health) => {
	expect(() => parsePluginHealth(health)).toThrow("PLUGIN_DIAGNOSTIC_INVALID");
});

test("preserves unknown availability and missing physical names instead of inventing healthy Workers", () => {
	const parsed = parsePluginDiagnostic({
		...diagnostic,
		health: { status: "unknown", checkedAt: null, reason: null },
		workers: diagnostic.workers.map((worker) => ({ ...worker, physicalName: null })),
	});
	expect(parsed.health.status).toBe("unknown");
	expect(parsed.workers[0]?.physicalName).toBeNull();
});

test("rejects malformed service and route inventories before they reach the renderer", () => {
	expect(() => parsePluginDiagnostic({ ...diagnostic, workers: { service: "identity" } })).toThrow(
		"PLUGIN_DIAGNOSTIC_INVALID",
	);
	expect(() =>
		parsePluginDiagnostic({
			...diagnostic,
			routes: { views: [], api: [{ method: "GET", path: { secret: "never-render-this-object" } }] },
		}),
	).toThrow("PLUGIN_DIAGNOSTIC_INVALID");
});
