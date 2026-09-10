import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { OperatorProfile } from "../../../../packages/plugins/supbrd-plug-identity/src/front/OperatorProfile.js";
const state = vi.hoisted(() => ({ keys: [] as { id: string; name: string }[] }));
vi.mock("@superboard/front-ui/context", () => ({
	useFrontContext: () => ({
		locale: "en",
		operator: { id: "operator-1", email: "owner@example.test", name: "Owner", role: 50 },
	}),
}));
vi.mock("../../../../packages/plugins/supbrd-plug-identity/src/front/transport.js", () => ({
	PUT: async (_path: string, body: { name: string; email: string }) => ({
		data: { data: { item: { ...body, name: body.name.trim() } } },
	}),
	DELETE: async () => ({}),
}));
vi.mock("../../../../packages/plugins/supbrd-plug-identity/src/front/operator-passkey.js", () => ({
	operatorGet: async () => ({ items: state.keys }),
	operatorPost: async () => ({}),
	registerOperatorPasskey: async (_options: string, _verify: string, body: { name: string }) => {
		state.keys.push({ id: "registered-key", name: body.name });
	},
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
	state.keys = [];
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
async function fill(selector: string, value: string) {
	const input = container.querySelector<HTMLInputElement>(selector)!;
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}
async function click(text: string) {
	const button = [...container.querySelectorAll("button")].find(
		(element) => element.textContent === text,
	)!;
	expect(button).toBeDefined();
	await act(async () => button.click());
}
test("profile save displays the persisted server-normalized profile", async () => {
	await render(<OperatorProfile />);
	await fill('[name="name"]', "  Updated owner  ");
	await click("Save profile");
	expect(container.querySelector('[role="status"]')?.textContent).toBe("Profile saved");
	expect(container.querySelector<HTMLInputElement>('[name="name"]')?.value).toBe("Updated owner");
});
test("registering a passkey displays it in the account credential list", async () => {
	await render(<OperatorProfile security />);
	await fill("input", "Replacement security key");
	await click("Create a passkey");
	expect(container.querySelector("ul")?.textContent).toContain("Replacement security key");
	expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("");
});
