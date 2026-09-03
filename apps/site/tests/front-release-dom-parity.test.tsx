import { resolveFrontRequest, type CompiledFrontRelease } from "@superboard/supbrd-core";
import { createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

import parityRelease from "../../../config/superboard-parity-release.json";
import seed from "../seed/seed.json";
import { NativeFrontApp } from "../src/components/NativeFrontApp.js";
import type { FrontPageModel } from "../src/lib/front-page.js";
import { projectNativeFrontPresentation } from "../src/lib/native-front-presentation.js";
import { editableViewFromEntry } from "../src/lib/native-front-views.js";

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the generator verifies the signed artifact before this test runs
const compiledRelease = parityRelease.release as unknown as CompiledFrontRelease;
const release = compiledRelease.payload;

test("renders every active Release route and submenu in the client without an error", async () => {
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
			const element = releaseRouteElement(route);
			const container = document.createElement("div");
			document.body.append(container);
			const root = createRoot(container, {
				onRecoverableError: (error) => clientErrors.push([error]),
			});
			root.render(element);
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(container.querySelector(".native-front"), route.route_id).not.toBeNull();
			expect(container.innerHTML.length, route.route_id).toBeGreaterThan(100);
			expect(container.innerHTML, route.route_id).not.toContain(
				"View configuration is incomplete.",
			);
			expect(container.innerHTML, route.route_id).not.toContain(
				"No data available for this surface yet.",
			);
			root.unmount();
			container.remove();
		}
		expect(clientErrors).toEqual([]);
	} finally {
		errorSpy.mockRestore();
	}
}, 60_000);

function releaseRouteElement(
	route: CompiledFrontRelease["payload"]["front_route_manifest"]["routes"][number],
): ReactElement {
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
	return createElement(NativeFrontApp, { projection });
}
