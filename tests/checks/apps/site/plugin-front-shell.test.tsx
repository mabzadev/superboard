import { useFrontContext } from "@superboard/front-ui/context";
import { useParams } from "@superboard/front-ui/navigation";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { NativeFrontApp } from "../../../../apps/site/src/components/NativeFrontApp.js";
import { CORE_ADMIN_SHELL_DESCRIPTOR } from "../../../../apps/site/src/lib/core-front-contract.js";
import type { NativeFrontPresentationProjection } from "../../../../apps/site/src/lib/native-front-presentation.js";
import { USER_FRONT_CATALOGS } from "../../../../apps/site/src/lib/user-front-catalogs.js";
import { useProjectSelection } from "../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js";

vi.mock("../../../../apps/site/src/lib/native-front-plugins.js", () => ({
	mountNativeFrontRenderer: ({ mount }: { mount: { renderer: { plugin_id: string } } }) =>
		mount.renderer.plugin_id === "supbrd-core"
			? {
					kind: "layout",
					title: "SuperBoard",
					home_href: "/superboard-system/home",
					navigation_label: "Product sections",
					actions: [{ label: "EmDash", href: "/_emdash/admin" }],
				}
			: { kind: "surface", title: "Products", blocks: [] },
}));
vi.mock("../../../../apps/site/src/components/PluginFrontView.js", () => ({
	PluginFrontView: () => {
		const { selectedProject } = useProjectSelection();
		const { locale } = useFrontContext();
		const { lang } = useParams();
		return (
			<>
				<output data-testid="view-project">{selectedProject?.id}</output>
				<span data-testid="view-language">
					{locale}:{lang}
				</span>
			</>
		);
	},
}));

const production = {
	id: "42-prod",
	internal_id: "11",
	name: "Production",
	identifier: "production",
	is_test: false,
	created_at: "2026-01-01",
	updated_at: "2026-01-01",
};
const staging = {
	...production,
	id: "42-test",
	internal_id: "12",
	name: "Test",
	identifier: "test",
	is_test: true,
};
const operator = {
	id: "operator-1",
	name: "Ada",
	email: "ada@example.test",
	role: 50,
	disabled: false,
};
const projection: NativeFrontPresentationProjection = {
	instance_id: "42",
	release_id: "release",
	path: "/products/offerings",
	locale: "en",
	theme: {},
	messages: USER_FRONT_CATALOGS.en,
	operator,
	project_scope: {
		production_project_ref: production.id,
		test_project_ref: staging.id,
		instance: {
			id: "42",
			name: "Example instance",
			uri_scheme: "example",
			get_started_dismissed: true,
			created_at: "2026-01-01",
			updated_at: "2026-01-01",
			production,
			test: staging,
			projects: [production, staging],
		},
	},
	plugin_lock: [
		"supbrd-core",
		"supbrd-plug-products",
		"supbrd-plug-user",
		"supbrd-plug-settings",
	].map((plugin_id) => ({
		plugin_id,
		version: "1.0.0",
		artifact_checksum: `sha256:${"a".repeat(64)}`,
		native: true,
	})),
	navigation: [
		{
			group_id: "products",
			label: "Products",
			order: 0,
			items: [
				{
					route_id: "products",
					href: "/products/offerings",
					label: "Offerings",
					order: 0,
					permission: "allow",
				},
			],
		},
	],
	layout_mounts: [
		{
			renderer: CORE_ADMIN_SHELL_DESCRIPTOR!,
			route_id: null,
			path: "/products/offerings",
			view_title: null,
			parameters: {},
			operator,
		},
	],
	content_mounts: [
		{
			renderer: { ...CORE_ADMIN_SHELL_DESCRIPTOR!, plugin_id: "supbrd-plug-products" },
			route_id: "products",
			path: "/products/offerings",
			view_title: "Products",
			parameters: {},
			operator,
		},
	],
	state_mount: null,
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
		configurable: true,
		value: true,
	});
	localStorage.clear();
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

test("a previously published translation cannot restore a retired product name", async () => {
	for (const locale of ["en", "fr"] as const) {
		await act(async () =>
			root.render(
				<NativeFrontApp
					projection={{
						...projection,
						locale,
						messages: { "site.front.title": "Retired product" },
					}}
				/>,
			),
		);
		expect(container.textContent).toContain("SuperBoard");
		expect(container.textContent).not.toContain("Retired product");
	}
});
async function render(value = projection) {
	await act(async () => root.render(<NativeFrontApp projection={value} />));
}
async function click(name: string) {
	const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
		(node) => node.getAttribute("aria-label") === name || node.textContent === name,
	);
	expect(button, name).toBeDefined();
	await act(async () => button!.click());
}

test("environment selection reaches plugin views and survives a page remount", async () => {
	await render();
	expect(container.querySelector("output")?.textContent).toBe("42-prod");
	const select = container.querySelector<HTMLSelectElement>('select[aria-label="Project data"]');
	expect(select).not.toBeNull();
	await act(async () => {
		select!.value = "test";
		select!.dispatchEvent(new Event("change", { bubbles: true }));
	});
	expect(container.querySelector("output")?.textContent).toBe("42-test");
	await act(async () => root.unmount());
	root = createRoot(container);
	await render();
	expect(container.querySelector("output")?.textContent).toBe("42-test");
});

test("account controls expose active plugin destinations and report a failed logout", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ error: { message: "Unavailable" } }, { status: 503 })),
	);
	await render();
	await click("Open Ada account menu");
	expect(document.querySelector('a[role="menuitem"][href="/account"]')).not.toBeNull();
	expect(document.querySelector('a[role="menuitem"][href="/project-settings"]')).not.toBeNull();
	await click("Log out");
	expect(container.querySelector('[role="alert"]')?.textContent).toContain("Sign out failed");
	vi.unstubAllGlobals();
});

test("desktop navigation can collapse and mobile navigation closes with Escape", async () => {
	await render();
	await click("Collapse sidebar");
	expect(container.querySelector('button[aria-label="Expand sidebar"]')).not.toBeNull();
	await click("Open navigation");
	expect(
		container.querySelector('button[aria-label="Open navigation"]')?.getAttribute("aria-expanded"),
	).toBe("true");
	await act(async () =>
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
	);
	expect(
		container.querySelector('button[aria-label="Open navigation"]')?.getAttribute("aria-expanded"),
	).toBe("false");
});

test("opening another section closes the previous section and a reduced menu reopens its links", async () => {
	await render({
		...projection,
		navigation: [
			...projection.navigation,
			{
				group_id: "other",
				label: "Other",
				order: 1,
				items: [
					{ route_id: "other", href: "/other", label: "Other page", order: 0, permission: "allow" },
				],
			},
		],
	});
	const other = [...container.querySelectorAll("summary")].find((node) =>
		node.textContent?.includes("Other"),
	);
	expect(other).toBeDefined();
	await act(async () => other!.click());
	expect(container.querySelectorAll("details[open]")).toHaveLength(1);
	expect(container.querySelector('a[href="/other"]')?.closest("details")?.open).toBe(true);
	expect(container.querySelector('a[href="/products/offerings"]')?.closest("details")?.open).toBe(
		false,
	);
	await click("Collapse sidebar");
	await act(async () => other!.click());
	expect(container.querySelector('button[aria-label="Collapse sidebar"]')).not.toBeNull();
	expect(container.querySelector('a[href="/other"]')?.closest("details")?.open).toBe(true);
});

test("theme choice changes the document and persists after remount", async () => {
	await render();
	await click("Open Ada account menu");
	await click("Dark mode");
	expect(document.documentElement.classList.contains("dark")).toBe(true);
	await act(async () => root.unmount());
	root = createRoot(container);
	await render();
	expect(document.documentElement.classList.contains("dark")).toBe(true);
});

test("French selection reaches plugin route parameters even when its published URL contains en", async () => {
	await render({
		...projection,
		locale: "fr",
		messages: {},
		content_mounts: projection.content_mounts.map((mount) => ({
			...mount,
			parameters: { lang: "en" },
		})),
	});
	expect(container.querySelector('[data-testid="view-language"]')?.textContent).toBe("fr:fr");
	expect(container.querySelector('[role="combobox"][aria-label="Langue"]')?.textContent).toContain(
		"Français",
	);
});

test("the front language selector offers only English and French", async () => {
	await render();
	const selector = container.querySelector<HTMLButtonElement>(
		'[role="combobox"][aria-label="Language"]',
	);
	expect(selector).not.toBeNull();
	await act(async () => selector!.click());
	expect(
		Array.from(document.querySelectorAll('[role="option"]'), (item) => item.textContent?.trim()),
	).toEqual(["English", "Français"]);
});
