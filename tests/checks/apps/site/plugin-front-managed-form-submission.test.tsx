import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import AuditPage from "../../../../packages/plugins/superboard-core/src/front/audit/AuditPage.js";
import GatewayPage from "../../../../packages/plugins/superboard-core/src/front/gateway/GatewayPage.js";
import ContentPage from "../../../../packages/plugins/superboard-data/src/front/content/ContentPage.js";

const state = vi.hoisted(() => ({
	archives: [] as Record<string, unknown>[],
	routes: [] as Record<string, unknown>[],
	items: [] as Record<string, unknown>[],
}));
vi.mock("@superboard/front-ui/context", () => ({ useFrontContext: () => ({ locale: "en" }) }));
vi.mock("../../../../packages/plugins/superboard-core/src/front/audit/transport.js", () => ({
	GET: async (path: string) => ({
		data: {
			data: { items: path.endsWith("/archives") ? state.archives : [], next_cursor: null },
		},
	}),
	POST: async (path: string, body: Record<string, unknown>) => {
		if (path.endsWith("/verify"))
			return { data: { data: { verified: true, entries: 2, has_more: false } } };
		state.archives.push({
			...body,
			archive_id: "saved-archive",
			checksum: "verified-archive-checksum",
		});
		return { data: { data: state.archives.at(-1) } };
	},
}));
vi.mock("../../../../packages/plugins/superboard-core/src/front/gateway/transport.js", () => ({
	GET: async (path: string) => ({
		data: {
			data: path.endsWith("/routes") ? state.routes : path.endsWith("/active-manifest") ? null : [],
		},
	}),
	PUT: async (path: string, body: Record<string, unknown>) => {
		const route = { ...body, route_id: path.split("/").at(-1), revision: 1 };
		state.routes.push(route);
		return { data: { data: route } };
	},
	POST: async (_path: string, body: Record<string, unknown>) => ({
		data: { data: { ...body, revision: 2 } },
	}),
}));
vi.mock("../../../../packages/plugins/superboard-data/src/front/content/transport.js", () => {
	const save = async (_path: string, body: Record<string, unknown>) => {
		const item = { ...body, id: "document-1", status: "draft", _rev: "revision-2" };
		state.items = [item];
		return { data: { data: { item } } };
	};
	return {
		GET: async (path: string) => {
			if (path.includes("/schema/"))
				return {
					data: {
						data: path.endsWith("/fields")
							? { items: [], next_cursor: null }
							: { items: [{ slug: "documents", label: "Documents" }] },
					},
				};
			const selected = state.items.find((item) => path.includes(String(item.id)));
			if (selected) return { data: { data: { item: selected, _rev: selected._rev } } };
			return { data: { data: { items: state.items, next_cursor: null } } };
		},
		POST: save,
		PUT: save,
	};
});
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
	state.archives = [];
	state.routes = [];
	state.items = [];
	Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
		configurable: true,
		value: true,
	});
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
async function render(node: ReactNode) {
	await act(async () => root.render(node));
}
async function click(label: string) {
	const button = [...container.querySelectorAll("button")].find(
		(item) => item.textContent === label,
	);
	expect(button).toBeDefined();
	await act(async () => button!.click());
}
async function fill(label: string, value: string) {
	const parent = [...container.querySelectorAll("label")].find(
		(item) => item.firstChild?.textContent === label,
	)!;
	const input = parent.querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea")!;
	const prototype =
		input instanceof HTMLTextAreaElement
			? HTMLTextAreaElement.prototype
			: HTMLInputElement.prototype;
	await act(async () => {
		Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}
async function check(label: string) {
	const parent = [...container.querySelectorAll("label")].find((item) =>
		item.textContent?.includes(label),
	)!;
	const input = parent.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
	await act(async () => input.click());
}
test("clicking Create immutable archive creates an archive after ledger verification", async () => {
	await render(<AuditPage />);
	await click("Synchronize and verify");
	await click("Create immutable archive");
	expect(container.textContent).toContain("verified-archive-checksum");
});
test("clicking Save draft route shows the saved route in the gateway", async () => {
	await render(<GatewayPage />);
	await fill("Route identifier", "health-check");
	await fill("Gateway path", "/public-health");
	await click("Save draft route");
	expect(
		[...container.querySelectorAll("button")].some(
			(button) => button.textContent === "GET /public-health",
		),
	).toBe(true);
});
test("clicking Update access policy shows the saved operator policy", async () => {
	await render(<GatewayPage />);
	await fill(
		"Allowed operator IDs (comma separated; empty allows authenticated operators)",
		"operator-17, operator-42",
	);
	await click("Update access policy");
	expect(container.querySelector("section section pre")?.textContent).toContain('"operator-42"');
});
test("clicking Create and Save document persists the edited content in the list", async () => {
	await render(<ContentPage />);
	await click("New document");
	await fill("Slug", "test-document");
	await check("JSON editing");
	await fill("Fields", '{"title":"Created document"}');
	await click("Create document");
	await vi.waitFor(() => {
		if (![...container.querySelectorAll("button")].some((b) => b.textContent === "Save"))
			throw new Error("created document is not selected for editing");
	});
	await check("JSON editing");
	await fill("Fields", '{"title":"Edited document"}');
	await click("Save");
	await click("Back to documents");
	await vi.waitFor(() => {
		expect(container.textContent).toContain("Edited document");
	});
	expect(container.textContent).toContain("Draft");
});
