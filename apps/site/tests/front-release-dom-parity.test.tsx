import {
	resolveFrontRequest,
	type CompiledFrontRelease,
	type FrontReleasePayload,
} from "@superboard/supbrd-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import parityRelease from "../../../config/superboard-parity-release.json";
import seed from "../seed/seed.json";
import { NativeFrontApp } from "../src/components/NativeFrontApp.js";
import type { FrontPageModel } from "../src/lib/front-page.js";
import { projectNativeFrontPresentation } from "../src/lib/native-front-presentation.js";
import { editableViewFromEntry } from "../src/lib/native-front-views.js";

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- generated artifact is schema-validated before this test runs
const release = parityRelease.release.payload as unknown as FrontReleasePayload;
const compiledRelease: CompiledFrontRelease = {
	payload: release,
	content_checksum: parityRelease.release.content_checksum,
	signature: { algorithm: "ES256", kid: "issue-70-parity", value: "verified-by-generator" },
	validation_receipts: [],
	validation_set_checksum: `sha256:${"0".repeat(64)}`,
	verification_status: "verified",
};

test("renders every active Release route and submenu without a client error", () => {
	const clientErrors: unknown[][] = [];
	const errorSpy = vi
		.spyOn(console, "error")
		.mockImplementation((...args) => clientErrors.push(args));
	const routes = new Map(
		release.front_route_manifest.routes.map((route) => [route.route_id, route]),
	);
	const submenuItems = release.presentation.navigation.flatMap(({ items }) => items);

	try {
		expect(submenuItems).toHaveLength(71);
		for (const item of submenuItems) {
			const route = routes.get(item.route_id);
			expect(route, item.route_id).toBeDefined();
			expect(route?.path_pattern.replace(":lang", "en"), item.route_id).toBe(item.href);
		}
		expect(release.front_route_manifest.routes).toHaveLength(110);
		for (const route of release.front_route_manifest.routes) {
			const markup = renderReleaseRoute(route);
			expect(markup.length, route.route_id).toBeGreaterThan(100);
			expect(markup, route.route_id).not.toContain("View configuration is incomplete.");
			expect(markup, route.route_id).not.toContain("No data available for this surface yet.");
		}
		expect(clientErrors).toEqual([]);
	} finally {
		errorSpy.mockRestore();
	}
});

function renderReleaseRoute(
	route: FrontReleasePayload["front_route_manifest"]["routes"][number],
): string {
	const path = route.path_pattern
		.replaceAll(/:lang/gu, "en")
		.replaceAll(/:[^/]+/gu, "parity-id")
		.replaceAll(/\*[^/]+/gu, "parity/path");
	const dependencyHealth = Object.fromEntries(
		release.dependency_policies.map(({ dependency_id: dependencyId }) => [
			dependencyId,
			"ready" as const,
		]),
	);
	const permissions = release.front_route_manifest.routes
		.map(({ permission_expression: permission }) => permission)
		.filter((permission) => permission !== "allow");
	const resolution = resolveFrontRequest({
		last_verified_release: {
			front_route_manifest: release.front_route_manifest,
			dependency_policies: release.dependency_policies,
		},
		requested_path: path,
		admin_session: route.auth_policy === "anonymous_only" ? "absent" : "valid",
		permissions,
		dependency_health: dependencyHealth,
	});
	const model: FrontPageModel = {
		instance_id: release.instance_id,
		requested_path: path,
		release: {
			release: compiledRelease,
			runtime_release: {
				front_route_manifest: release.front_route_manifest,
				dependency_policies: release.dependency_policies,
			},
			pointer_revision: 1,
			source: "preview",
		},
		resolution,
		page_title:
			resolution.result === "rendered"
				? (release.presentation.pages.find(({ page_id: pageId }) => pageId === resolution.page_id)
						?.title ?? null)
				: null,
		operator: {
			id: "operator-1",
			email: "operator@example.com",
			name: "Operator",
			role: 50,
			disabled: false,
		},
		permissions,
	};
	const seededView = seed.content.views.find(({ data }) => data.path === path);
	const view = seededView ? editableViewFromEntry({ data: seededView.data }) : null;
	const projection = projectNativeFrontPresentation(model, "en", view ? { view } : undefined);
	return renderToStaticMarkup(createElement(NativeFrontApp, { projection }));
}
