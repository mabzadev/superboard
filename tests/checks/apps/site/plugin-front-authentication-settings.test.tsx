import {
	authenticationSettingsFromEnvironment,
	type AuthenticationSettingsSnapshot,
} from "@superboard/contracts/authentication-settings";
import { QueryClient, QueryClientProvider } from "@superboard/front-ui/query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import AuthenticationSettingsPage from "../../../../packages/plugins/superboard-authentification/src/front/AuthenticationSettingsPage.js";

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("../../../../packages/plugins/superboard-authentification/src/front/transport.js", () => ({
	GET: api.get,
	PUT: api.put,
}));
vi.mock("@superboard/front-ui/context", () => ({
	useFrontContext: () => ({ locale: "fr", pluginId: "superboard-user" }),
	useOptionalFrontContext: () => ({ locale: "fr", pluginId: "superboard-user" }),
}));
vi.mock("../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: { id: "1-test" } }),
}));

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let stored: AuthenticationSettingsSnapshot;
beforeEach(() => {
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
	container.remove();
});

async function render() {
	await act(async () => {
		root.render(
			<QueryClientProvider client={client}>
				<AuthenticationSettingsPage />
			</QueryClientProvider>,
		);
	});
	await vi.waitFor(() => {
		expect(container.querySelector("form")).not.toBeNull();
	});
}
async function renderAppearance() {
	await render();
	await click("Apparence");
}
function input() {
	const element = container.querySelector("#setting-EMAIL_SENDER_NAME");
	if (!(element instanceof HTMLInputElement)) throw new Error("Sender input not rendered");
	return element;
}
async function fill(value: string) {
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input(), value);
		input().dispatchEvent(new Event("input", { bubbles: true }));
	});
}
async function click(label: string) {
	const button = [...container.querySelectorAll("button")].find(
		(item) => item.textContent === label,
	);
	if (!button) throw new Error(`Button not rendered: ${label}`);
	await act(async () => {
		button.click();
	});
}

test("operators edit and save values instead of only reading the old Overview table", async () => {
	await renderAppearance();
	expect(container.querySelector("h1")?.textContent).toBe("Paramètres d’authentification");
	await fill("Mon application");
	await vi.waitFor(
		() => {
			expect(container.textContent).toContain("Modifications enregistrées.");
		},
		{ timeout: 3000 },
	);
	expect(stored.values.EMAIL_SENDER_NAME).toBe("Mon application");
	await act(async () => {
		root.unmount();
	});
	root = createRoot(container);
	await renderAppearance();
	expect(input().value).toBe("Mon application");
});

test("a conflicting save keeps the draft and lets the operator reload current values", async () => {
	await renderAppearance();
	await fill("My draft");
	api.put.mockRejectedValue(
		Object.assign(new Error("conflict"), { code: "configuration_conflict" }),
	);
	await vi.waitFor(
		() => {
			expect(container.querySelector('[role="alert"]')?.textContent).toContain("modifiés ailleurs");
		},
		{ timeout: 3000 },
	);
	expect(input().value).toBe("My draft");
	stored = {
		...stored,
		revision: 2,
		values: { ...stored.values, EMAIL_SENDER_NAME: "Other operator" },
	};
	await click("Recharger les valeurs");
	await vi.waitFor(() => {
		expect(input().value).toBe("Other operator");
	});
});

test("durations remain readable and editable after saving", async () => {
	await render();
	await click("Avancé");
	const duration = container.querySelector<HTMLInputElement>(
		"#setting-AUTHORIZATION_CODE_EXPIRES_IN",
	);
	expect(duration?.value).toBe("30");
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
			duration,
			"120",
		);
		duration?.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await vi.waitFor(() => expect(stored.values.AUTHORIZATION_CODE_EXPIRES_IN).toBe(120), {
		timeout: 3000,
	});
	await act(async () => root.unmount());
	root = createRoot(container);
	await render();
	await click("Avancé");
	expect(
		container.querySelector<HTMLInputElement>("#setting-AUTHORIZATION_CODE_EXPIRES_IN")?.value,
	).toBe("2");
});

test("configuration tab is available and displays diagnostic component", async () => {
	await render();
	const configButton = [...container.querySelectorAll("button")].find(
		(btn) => btn.textContent === "Configuration",
	);
	expect(configButton).toBeDefined();
	await click("Configuration");
	await vi.waitFor(() => {
		expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe("Configuration");
	});
});

test("a settings service outage does not hide the diagnostic tab", async () => {
	api.get.mockRejectedValue(new Error("Service unavailable"));
	await act(async () => {
		root.render(
			<QueryClientProvider client={client}>
				<AuthenticationSettingsPage />
			</QueryClientProvider>,
		);
	});
	await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
	await click("Configuration");
	expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe("Configuration");
});

test("a settings response cannot discard a freshly checked diagnostic", async () => {
	const settings = Promise.withResolvers<{ data: AuthenticationSettingsSnapshot }>();
	api.get.mockReturnValue(settings.promise);
	const diagnostic = {
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
	};
	const health = {
		status: "unavailable",
		checkedAt: "2026-09-21T18:00:00.000Z",
		reason: "Identity service unreachable",
	};
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: unknown, init?: RequestInit) =>
			Response.json(
				init?.method === "POST" ? { health, diagnostic: { ...diagnostic, health } } : diagnostic,
			),
		),
	);
	try {
		await act(async () => {
			root.render(
				<QueryClientProvider client={client}>
					<AuthenticationSettingsPage />
				</QueryClientProvider>,
			);
		});
		await click("Configuration");
		await vi.waitFor(() => expect(container.textContent).toContain("Santé vérifiée"));
		await click("Vérifier à nouveau");
		expect(container.textContent).toContain("Identity service unreachable");
		await act(async () => {
			settings.resolve({ data: stored });
			await settings.promise;
		});
		await vi.waitFor(() =>
			expect(client.getQueryState(["authentication-settings", "1-test"])?.status).toBe("success"),
		);
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 20);
			});
		});
		expect(container.textContent).toContain("Identity service unreachable");
	} finally {
		vi.unstubAllGlobals();
	}
});
