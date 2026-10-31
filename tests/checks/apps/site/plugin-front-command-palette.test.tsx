import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import type { NativeRendererMountInput } from "@superboard/supbrd-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { NativeFrontApp } from "../../../../apps/site/src/components/NativeFrontApp.js";
import { CORE_ADMIN_SHELL_DESCRIPTOR } from "../../../../apps/site/src/lib/core-front-contract.js";
import type { NativeFrontPresentationProjection } from "../../../../apps/site/src/lib/native-front-presentation.js";
import { USER_FRONT_CATALOGS } from "../../../../apps/site/src/lib/user-front-catalogs.js";

vi.mock("../../../../apps/site/src/lib/native-front-renderers.js", async () => {
	const { nativeFrontPlugin } =
		await import("../../../../apps/site/src/front-plugins/emdash-core.js");
	return {
		mountProjectedNativeFrontRenderer: ({ mount }: { mount: NativeRendererMountInput }) =>
			mount.renderer.plugin_id === "supbrd-core"
				? nativeFrontPlugin.mount_renderer(mount)
				: { kind: "surface", title: "Dynamic links", blocks: [] },
	};
});
vi.mock("../../../../apps/site/src/components/PluginFrontView.js", () => ({
	PluginFrontView: () => {
		const { selectedProject } = useProjectSelection();
		return <output>{selectedProject?.id}</output>;
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
const staging = { ...production, id: "42-test", internal_id: "12", name: "Test", is_test: true };
const operator = {
	id: "operator-1",
	name: "Ada",
	email: "ada@example.test",
	role: 50,
	disabled: false,
};
const page = (route_id: string, label: string, href: string) => ({
	route_id,
	label,
	href,
	order: 0,
	permission: "allow",
});
const projection: NativeFrontPresentationProjection = {
	instance_id: "42",
	release_id: "release",
	path: "/acquisition/dynamic-links",
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
	plugin_lock: ["supbrd-core", "superboard-acquisition", "superboard-settings"].map(
		(plugin_id) => ({
			plugin_id,
			version: "1.0.0",
			artifact_checksum: `sha256:${"a".repeat(64)}`,
			native: true,
		}),
	),
	navigation: [
		{
			group_id: "acquisition",
			label: "Acquisition",
			order: 0,
			items: [
				page("paywalls", "Paywalls", "/acquisition/paywalls"),
				page("dynamic-links", "Dynamic links", "/acquisition/dynamic-links"),
			],
		},
		{
			group_id: "settings",
			label: "Environment settings",
			order: 1,
			items: [
				page("general", "General", "/core/settings"),
				page("keys", "API keys", "/auth/settings?tab=security&section=keys"),
			],
		},
	],
	layout_mounts: [
		{
			renderer: CORE_ADMIN_SHELL_DESCRIPTOR!,
			route_id: null,
			path: "/acquisition/dynamic-links",
			view_title: null,
			parameters: {},
			operator,
		},
	],
	content_mounts: [
		{
			renderer: { ...CORE_ADMIN_SHELL_DESCRIPTOR!, plugin_id: "superboard-acquisition" },
			route_id: "dynamic-links",
			path: "/acquisition/dynamic-links",
			view_title: "Dynamic links",
			parameters: {},
			operator,
		},
	],
	state_mount: null,
};
const recentKey = "superboard:42:operator-1:recent-pages";

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
	Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
		configurable: true,
		value: true,
	});
	localStorage.clear();
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	// The palette is a lazy chunk: load it up front so opening it settles inside act().
	await import("../../../../apps/site/src/components/NativeFrontCommandPalette.js");
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function render(value = projection) {
	await act(async () => root.render(<NativeFrontApp projection={value} />));
}
async function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document) {
	await act(async () => {
		target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
	});
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const input = () => dialog()?.querySelector<HTMLInputElement>('input[role="combobox"]') ?? null;
const options = () =>
	Array.from(dialog()?.querySelectorAll<HTMLElement>('[role="option"]') ?? [], (option) => ({
		id: option.id,
		label: option.querySelector(".native-front-command-label")?.textContent,
		selected: option.getAttribute("aria-selected") === "true",
	}));
async function open() {
	await press("k", { ctrlKey: true });
	await vi.waitFor(() => expect(input()).not.toBeNull());
}
async function type(value: string) {
	const field = input()!;
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
		field.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

test("the header search button opens an accessible palette without loading it upfront", async () => {
	await render();
	const trigger = container.querySelector<HTMLButtonElement>(
		'button[aria-label="Search pages and actions"]',
	);
	expect(trigger?.getAttribute("aria-haspopup")).toBe("dialog");
	expect(trigger?.getAttribute("aria-keyshortcuts")).toBe("Meta+K Control+K");
	expect(dialog()).toBeNull();
	await act(async () => trigger!.click());
	await vi.waitFor(() => expect(input()).not.toBeNull());
	expect(dialog()?.getAttribute("aria-labelledby")).toBeTruthy();
	expect(document.getElementById(dialog()!.getAttribute("aria-labelledby")!)?.textContent).toBe(
		"Command palette",
	);
	const list = document.getElementById(input()!.getAttribute("aria-controls")!);
	expect(list?.getAttribute("role")).toBe("listbox");
	expect(input()!.getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
});

test("Ctrl+K lists quick actions and menu pages, filters them and closes again", async () => {
	await render();
	await open();
	const labels = options().map(({ label }) => label);
	expect(labels).toEqual(
		expect.arrayContaining([
			"Create a dynamic link",
			"Invite a team member",
			"API keys",
			"Switch to Test data",
			"Switch to dark mode",
			"Change language to Français",
			"Paywalls",
			"General",
		]),
	);
	expect(labels).not.toContain("Create an email");
	await type("keys");
	expect(options().map(({ label }) => label)).toEqual(["API keys"]);
	await type("zzz");
	expect(options()).toEqual([]);
	expect(dialog()?.querySelector('[role="status"]')?.textContent).toBe("No results for “zzz”");
	await press("k", { metaKey: true });
	expect(dialog()).toBeNull();
});

test("arrow keys move the active option and Enter runs it", async () => {
	await render();
	expect(container.querySelector("output")?.textContent).toBe("42-prod");
	await open();
	await type("data");
	expect(options()[0]).toMatchObject({ label: "Switch to Test data", selected: true });
	await press("ArrowUp", {}, input()!);
	expect(options().at(-1)?.selected).toBe(true);
	await press("ArrowDown", {}, input()!);
	expect(options()[0]?.selected).toBe(true);
	expect(input()!.getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
	await press("Enter", {}, input()!);
	expect(dialog()).toBeNull();
	expect(container.querySelector("output")?.textContent).toBe("42-test");
	await open();
	await type("data");
	expect(options()[0]?.label).toBe("Switch to Production data");
});

test("recent pages are kept per instance and operator, newest first, without the current page", async () => {
	localStorage.setItem(
		recentKey,
		JSON.stringify([{ href: "/core/settings", label: "General", hint: "Environment settings" }]),
	);
	await render();
	expect(JSON.parse(localStorage.getItem(recentKey)!)).toEqual([
		{ href: "/acquisition/dynamic-links", label: "Dynamic links", hint: "Acquisition" },
		{ href: "/core/settings", label: "General", hint: "Environment settings" },
	]);
	await open();
	const heading = dialog()!.querySelector('[role="group"]');
	expect(heading?.textContent).toContain("Recent pages");
	expect(options()[0]?.label).toBe("General");
	expect(heading?.textContent).not.toContain("Dynamic links");
});

test("French operators get French palette strings", async () => {
	await render({ ...projection, locale: "fr", messages: USER_FRONT_CATALOGS.fr });
	expect(
		container.querySelector('button[aria-label="Rechercher des pages et des actions"]'),
	).not.toBeNull();
	await open();
	expect(input()?.placeholder).toBe("Rechercher une page ou une action…");
	expect(options().map(({ label }) => label)).toContain("Changer la langue : English");
});
