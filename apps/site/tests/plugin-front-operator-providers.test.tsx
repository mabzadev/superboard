import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { OperatorAccess } from "../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plug-user/OperatorAccess.js";
const state = vi.hoisted(() => ({ fail: false }));
vi.mock("@superboard/front-ui/context", () => ({ useFrontContext: () => ({ locale: "en" }) }));
vi.mock("@superboard/front-ui/navigation", () => ({
	useSearchParams: () => new URLSearchParams({ backTo: "/account" }),
}));
vi.mock(
	"../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plug-user/operator-passkey.js",
	() => ({
		operatorGet: async () => {
			if (state.fail) throw new Error("Metadata unavailable");
			return {
				providers: [
					{ id: "google", label: "Google" },
					{ id: "github", label: "GitHub" },
					{ id: "custom", label: "Company SSO" },
				],
			};
		},
		operatorPost: async () => ({}),
		registerOperatorPasskey: async () => {},
		signInWithOperatorPasskey: async () => {},
	}),
);
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
	state.fail = false;
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
test("offers configured OAuth providers and delegates custom methods to the core login", async () => {
	await act(async () => root.render(<OperatorAccess mode="login" />));
	const links = [...container.querySelectorAll("a")];
	const google = links.find((link) => link.textContent === "Google");
	expect(google).toBeDefined();
	const url = new URL(google!.href);
	expect(url.pathname).toBe("/_emdash/api/auth/oauth/google");
	expect(url.searchParams.get("redirect")).toBe("/account");
	expect(links.find((link) => link.textContent === "GitHub")?.pathname).toBe(
		"/_emdash/api/auth/oauth/github",
	);
	expect(links.find((link) => link.textContent === "Company SSO")?.pathname).toBe(
		"/_emdash/admin/login",
	);
});
test("keeps passwordless sign-in available when optional provider metadata fails", async () => {
	state.fail = true;
	await act(async () => root.render(<OperatorAccess mode="login" />));
	expect(
		[...container.querySelectorAll("button")].some(
			(button) => button.textContent === "Sign in with a passkey",
		),
	).toBe(true);
	expect(container.querySelector('input[type="email"]')).not.toBeNull();
});
