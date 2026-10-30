import {
	authenticationSettingsFromEnvironment,
	type AuthenticationSettingsSnapshot,
} from "@superboard/contracts/authentication-settings";
import { QueryClient, QueryClientProvider } from "@superboard/front-ui/query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import SettingsPage from "../../../../packages/plugins/superboard-authentification/src/front/SettingsPage.js";

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), request: vi.fn() }));
vi.mock("../../../../packages/plugins/superboard-authentification/src/front/transport.js", () => ({
	GET: api.get,
	PUT: api.put,
	request: api.request,
}));
vi.mock("@superboard/front-ui/context", () => ({
	useFrontContext: () => ({
		locale: "fr",
		pluginId: "superboard-user",
		path: "/auth/settings",
		operator: { id: "operator", email: "operator@example.test", name: "Operator", role: 100 },
	}),
	useOptionalFrontContext: () => ({
		locale: "fr",
		pluginId: "superboard-user",
		path: "/auth/settings",
	}),
}));
vi.mock("../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: { id: "1-test" } }),
}));

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let stored: AuthenticationSettingsSnapshot;
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	history.replaceState({}, "", "/auth/settings?lang=fr&tab=appearance");
	api.request.mockReset();
	stored = {
		revision: 0,
		updatedAt: null,
		values: authenticationSettingsFromEnvironment({
			EMAIL_SENDER_NAME: "Before",
			SUPPORTED_LOCALES: ["en", "fr"],
		}),
	};
	api.get.mockReset().mockImplementation(async () => ({ data: structuredClone(stored) }));
	api.put
		.mockReset()
		.mockImplementation(
			async (_path: string, body: { revision: number; values: Record<string, string> }) => {
				stored = {
					...stored,
					revision: body.revision + 1,
					values: { ...stored.values, ...body.values },
				};
				return { data: structuredClone(stored) };
			},
		);
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	client.clear();
	vi.unstubAllGlobals();
	container.remove();
});

async function render() {
	await act(async () => {
		root.render(
			<QueryClientProvider client={client}>
				<SettingsPage />
			</QueryClientProvider>,
		);
	});
}
async function click(label: string) {
	const button = [...container.querySelectorAll<HTMLButtonElement>("nav button")].find(
		(item) => item.textContent === label,
	);
	if (!button) throw new Error(`Missing tab: ${label}`);
	await act(async () => {
		button.click();
	});
}

test("settings tabs preserve unsaved fields and follow browser navigation", async () => {
	await render();
	await vi.waitFor(() =>
		expect(container.querySelector("#setting-EMAIL_SENDER_NAME")).not.toBeNull(),
	);
	const input = container.querySelector<HTMLInputElement>("#setting-EMAIL_SENDER_NAME");
	if (!input) throw new Error("Sender input missing");
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
			input,
			"Unsaved name",
		);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await click("Sécurité");
	expect(location.search).toContain("tab=security");
	expect(container.querySelector("#setting-AUTHORIZATION_CODE_EXPIRES_IN")).not.toBeNull();
	await act(async () => {
		history.replaceState({}, "", "/auth/settings?lang=fr&tab=appearance");
		dispatchEvent(new PopStateEvent("popstate"));
	});
	expect(container.querySelector<HTMLInputElement>("#setting-EMAIL_SENDER_NAME")?.value).toBe(
		"Unsaved name",
	);
	expect(api.put).not.toHaveBeenCalled();
});

test("Configuration remains a directly accessible tab when sign-in settings fail", async () => {
	api.get.mockRejectedValue(new Error("Settings unavailable"));
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json({
				pluginId: "superboard-authentification",
				label: "Authentication",
				lifecycle: { state: "active", changedAt: null, reason: null },
				configuration: {
					pluginId: "superboard-authentification",
					version: "1",
					label: "Authentication",
					capabilities: [],
					failurePolicies: { reads: "unavailable", writes: "fail_closed" },
				},
				health: { status: "unknown", checkedAt: null, reason: null },
				dependencies: [],
				workers: [],
				routes: { views: [], api: [] },
			}),
		),
	);
	await render();
	await click("Configuration");
	await vi.waitFor(() => expect(container.textContent).toContain("Santé vérifiée"));
	expect(location.search).toContain("tab=configuration");
	expect(container.querySelector('nav [aria-pressed="true"]')?.textContent).toBe("Configuration");
	const labels = Array.from(
		container.querySelectorAll("nav button"),
		(button) => button.textContent ?? "",
	);
	expect(labels.every((label) => /^\S+$/u.test(label))).toBe(true);
});

test("operators create and edit a role in Settings without opening another view", async () => {
	history.replaceState({}, "", "/auth/settings?lang=fr&tab=roles");
	const roles: Array<{
		id: number;
		name: string;
		note: string;
		createdAt: string;
		updatedAt: string;
	}> = [];
	api.get.mockImplementation(async (path: string) => ({
		data: path.endsWith("/configuration")
			? structuredClone(stored)
			: path.endsWith("/apps")
				? { apps: [] }
				: { configs: {} },
	}));
	api.request.mockImplementation(
		async (method: string, path: string, body?: { name: string; note: string }) => {
			if (path.endsWith("/roles")) {
				if (method === "POST" && body) {
					roles.push({ id: 42, ...body, createdAt: "2026-09-26", updatedAt: "2026-09-26" });
					return { data: { role: structuredClone(roles[0]) } };
				}
				return { data: { roles: structuredClone(roles) } };
			}
			if (path.endsWith("/roles/42/users")) return { data: { users: [] } };
			if (path.endsWith("/roles/42")) {
				if (method === "PUT" && body) Object.assign(roles[0] ?? {}, body);
				return { data: { role: structuredClone(roles[0]) } };
			}
			throw new Error(`Unexpected request ${method} ${path}`);
		},
	);
	await render();
	await vi.waitFor(() => expect(container.querySelector('a[href*="id=new"]')).not.toBeNull());
	const create = container.querySelector<HTMLAnchorElement>('a[href*="id=new"]');
	await act(async () => {
		create?.click();
	});
	await vi.waitFor(() =>
		expect(document.querySelector('[role="dialog"] [data-testid="nameInput"]')).not.toBeNull(),
	);
	const fillField = async (field: string, value: string) => {
		const input = document.querySelector<HTMLInputElement>(
			`[role="dialog"] [data-testid="${field}"]`,
		);
		if (!input) throw new Error(`Missing input ${field}`);
		await act(async () => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
	};
	const dialogButton = async (label: string) => {
		const button = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
			(item) => item.textContent?.trim() === label,
		);
		if (!button) throw new Error(`Missing button ${label}`);
		await act(async () => {
			button.click();
		});
	};
	await fillField("nameInput", "reviewer");
	await dialogButton("Enregistrer");
	await vi.waitFor(() => expect(new URLSearchParams(location.search).get("id")).toBe("42"));
	await vi.waitFor(() =>
		expect(
			document.querySelector<HTMLInputElement>('[role="dialog"] [data-testid="nameInput"]')?.value,
		).toBe("reviewer"),
	);
	await vi.waitFor(() =>
		expect(document.querySelector('[role="dialog"] h1')?.textContent).toBe("reviewer"),
	);
	expect(location.pathname).toBe("/auth/settings");
	await fillField("noteInput", "Updated from the panel");
	await dialogButton("Enregistrer");
	await vi.waitFor(() => expect(roles[0]?.note).toBe("Updated from the panel"));
	await dialogButton("Fermer");
	await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
	expect(new URLSearchParams(location.search).get("editor")).toBeNull();
	expect(container.textContent).toContain("reviewer");
	expect(location.pathname).toBe("/auth/settings");
});
