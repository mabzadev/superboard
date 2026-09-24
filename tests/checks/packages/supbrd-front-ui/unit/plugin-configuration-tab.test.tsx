// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { PluginDiagnosticData } from "@superboard/contracts/plugin-diagnostic";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import {
	FrontContextProvider,
	type FrontContextValue,
} from "../../../../../packages/supbrd-front-ui/src/context.js";
import { PluginConfigurationTab } from "../../../../../packages/supbrd-front-ui/src/plugin-configuration-tab.js";

const mockDiagnosticData: PluginDiagnosticData = {
	pluginId: "supbrd-plug-identity",
	label: "Authentification",
	lifecycle: {
		state: "active",
		changedAt: "2026-09-01T12:00:00.000Z",
		reason: null,
		artifactChecksum: "sha256:abc123456789",
		planId: "plan-1",
		activatedReleaseId: "rel-1",
	},
	configuration: {
		pluginId: "supbrd-plug-identity",
		version: "1.2.0",
		label: "Authentification",
		capabilities: ["auth.login", "auth.register"],
		failurePolicies: {
			reads: "unavailable",
			writes: "fail_closed",
		},
		settingsSchema: {
			type: "object",
			properties: {
				session_ttl: { type: "number" },
			},
		},
	},
	health: {
		status: "ready",
		checkedAt: "2026-09-01T12:05:00.000Z",
		reason: null,
	},
	dependencies: [
		{
			id: "dep.db",
			status: "ready",
			expiresAt: "2026-09-01T13:00:00.000Z",
			checkedAt: "2026-09-01T12:05:00.000Z",
		},
	],
	workers: [
		{
			service: "identity",
			workerName: "identity",
			physicalName: "identity-worker",
			deploymentGroup: "auth",
			modules: ["identity"],
			isShared: false,
			sharedWith: [],
		},
	],
	routes: {
		views: [
			{ routeId: "auth.login", path: "/login", method: "GET" },
			{ routeId: "auth.register", path: "/register", method: "GET" },
		],
		api: [{ method: "POST", path: "/api/auth/login", surface: "api" }],
	},
};

describe("PluginConfigurationTab", () => {
	const originalFetch = globalThis.fetch;

	it("loads configuration from the active View and follows a plugin change without a manual identifier", async () => {
		globalThis.fetch = vi.fn(async (url) => {
			const pluginId = String(url).includes("superboard-acquisition")
				? "superboard-acquisition"
				: "superboard-analytics";
			return Response.json({
				...mockDiagnosticData,
				pluginId,
				configuration: { ...mockDiagnosticData.configuration, pluginId },
			});
		});
		const context: FrontContextValue = {
			pluginId: "supbrd-plugmod-flows",
			path: "/acquisition/settings",
			locale: "en",
			parameters: {},
			instanceId: "local",
			operator: null,
			projectScope: null,
			activePluginIds: ["supbrd-plugmod-flows", "supbrd-plugmod-analytics"],
		};
		const view = render(
			<FrontContextProvider value={context}>
				<PluginConfigurationTab pluginId="supbrd-plug-identity" />
			</FrontContextProvider>,
		);
		expect(await screen.findByText("superboard-acquisition")).toBeInTheDocument();
		view.rerender(
			<FrontContextProvider
				value={{ ...context, pluginId: "supbrd-plugmod-analytics", path: "/analytics/settings" }}
			>
				<PluginConfigurationTab />
			</FrontContextProvider>,
		);
		expect(await screen.findByText("superboard-analytics")).toBeInTheDocument();
		expect(screen.queryByText("superboard-acquisition")).not.toBeInTheDocument();
	});

	afterEach(() => {
		cleanup();
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("renders loading state initially", () => {
		globalThis.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
		render(<PluginConfigurationTab pluginId="supbrd-plug-identity" locale="en" />);
		expect(screen.getByText("Loading configuration and diagnostic...")).toBeInTheDocument();
	});

	it("rejects a ready result without a verification date", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			Response.json({
				...mockDiagnosticData,
				health: { status: "ready", checkedAt: null, reason: null },
			}),
		);
		render(<PluginConfigurationTab pluginId="supbrd-plug-identity" locale="en" />);
		expect(await screen.findByText("Failed to load diagnostic")).toBeInTheDocument();
		expect(screen.queryByText("Verified Health")).not.toBeInTheDocument();
	});

	it("refuses a diagnostic belonging to another plugin", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(Response.json({ ...mockDiagnosticData, pluginId: "supbrd-plug-support" }));
		render(<PluginConfigurationTab pluginId="supbrd-plug-identity" locale="en" />);
		expect(await screen.findByText("Failed to load diagnostic")).toBeInTheDocument();
	});

	it("translates lifecycle and health states and never invents a physical Worker name", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			Response.json({
				...mockDiagnosticData,
				workers: [
					{ ...mockDiagnosticData.workers[0], workerName: "guessed-worker", physicalName: null },
				],
			}),
		);
		render(<PluginConfigurationTab pluginId="supbrd-plug-identity" locale="fr" />);
		expect(await screen.findByText("Actif")).toBeInTheDocument();
		expect(screen.getAllByText("Disponible").length).toBeGreaterThan(0);
		expect(screen.queryByText("guessed-worker")).not.toBeInTheDocument();
	});

	it("renders all diagnostic sections when data loads", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => mockDiagnosticData,
		});

		render(<PluginConfigurationTab pluginId="supbrd-plug-identity" locale="en" />);

		await waitFor(() => {
			expect(screen.getByText("Plugin Lifecycle")).toBeInTheDocument();
		});

		expect(screen.getByText("Declared Configuration")).toBeInTheDocument();
		expect(screen.getByText("Verified Health")).toBeInTheDocument();
		expect(screen.getByText("Dependencies")).toBeInTheDocument();
		expect(screen.getByText("Associated Services & Workers")).toBeInTheDocument();
		expect(screen.getByText("Routes & Views")).toBeInTheDocument();

		// Check values
		expect(screen.getByText("Active")).toBeInTheDocument();
		expect(screen.getByText("1.2.0")).toBeInTheDocument();
		expect(screen.getAllByText("auth.login").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("Ready").length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText("dep.db")).toBeInTheDocument();
		expect(screen.getByText("identity-worker")).toBeInTheDocument();
		expect(screen.getByText("/login")).toBeInTheDocument();
	});

	it("reports a missing diagnostic endpoint without claiming the plugin is disabled", async () => {
		globalThis.fetch = vi
			.fn()
			.mockImplementation(() => Promise.resolve(new Response("Not found", { status: 404 })));
		render(<PluginConfigurationTab pluginId="supbrd-plug-identity" locale="en" />);
		expect(await screen.findByText("Failed to load diagnostic")).toBeInTheDocument();
		expect(screen.queryByText("Plugin Disabled")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByText("Failed to load diagnostic")).toBeInTheDocument();
		expect(screen.queryByText("Plugin Disabled")).not.toBeInTheDocument();
	});

	it("renders disabled state when the API confirms the plugin is inactive", async () => {
		globalThis.fetch = vi
			.fn()
			.mockImplementation(() =>
				Promise.resolve(Response.json({ error: { code: "PLUGIN_NOT_ACTIVE" } }, { status: 404 })),
			);

		render(<PluginConfigurationTab pluginId="supbrd-plugmod-paywalls" locale="en" />);

		await waitFor(() => {
			expect(screen.getByText("Plugin Disabled")).toBeInTheDocument();
		});
		expect(
			screen.getByText("This plugin is currently disabled in this environment."),
		).toBeInTheDocument();
	});

	it("supports French localization", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => mockDiagnosticData,
		});

		render(<PluginConfigurationTab pluginId="supbrd-plug-identity" locale="fr" />);

		await waitFor(() => {
			expect(screen.getByText("Cycle de vie du plugin")).toBeInTheDocument();
		});

		expect(screen.getByText("Configuration déclarée")).toBeInTheDocument();
		expect(screen.getByText("Santé vérifiée")).toBeInTheDocument();
		expect(screen.getByText("Dépendances")).toBeInTheDocument();
		expect(screen.getByText("Services et Workers associés")).toBeInTheDocument();
		expect(screen.getByText("Routes et Vues")).toBeInTheDocument();
		expect(screen.getByText("Vérifier à nouveau")).toBeInTheDocument();
	});

	it("localizes network failures in French", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
		render(<PluginConfigurationTab pluginId="supbrd-plug-identity" locale="fr" />);
		expect(
			await screen.findByText(
				"Une erreur est survenue lors de la récupération des données de diagnostic.",
			),
		).toBeInTheDocument();
		expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
	});

	it("triggers re-check health and updates diagnostic", async () => {
		const fetchMock = vi.fn();
		// First fetch: diagnostic
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => mockDiagnosticData,
		});
		// Second fetch: health POST
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({
				status: "ready",
				checkedAt: "2026-09-01T12:10:00.000Z",
				reason: null,
			}),
		});
		// Third fetch: diagnostic refetch
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({
				...mockDiagnosticData,
				health: {
					status: "ready",
					checkedAt: "2026-09-01T12:10:00.000Z",
					reason: null,
				},
			}),
		});

		globalThis.fetch = fetchMock;

		render(<PluginConfigurationTab pluginId="supbrd-plug-identity" locale="en" />);

		await waitFor(() => {
			expect(screen.getByText("Re-check Health")).toBeInTheDocument();
		});

		const recheckBtn = screen.getByRole("button", { name: /Re-check Health/i });
		fireEvent.click(recheckBtn);

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				"/_emdash/api/superboard/plugins/supbrd-plug-identity/health",
				expect.objectContaining({
					method: "POST",
					headers: { "X-EmDash-Request": "1" },
				}),
			);
		});
	});

	it("shows the latest failed health probe instead of restoring an older successful receipt", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(Response.json(mockDiagnosticData))
			.mockResolvedValueOnce(
				Response.json({
					health: {
						status: "unavailable",
						checkedAt: "2026-09-21T15:00:00.000Z",
						reason: "WORKER_UNAVAILABLE",
					},
				}),
			);
		render(<PluginConfigurationTab pluginId="supbrd-plug-identity" locale="en" />);
		fireEvent.click(await screen.findByRole("button", { name: "Re-check Health" }));
		expect((await screen.findAllByText("WORKER_UNAVAILABLE")).length).toBeGreaterThan(0);
		expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
	});

	it("updates each service independently when the refreshed diagnostic reports a partial outage", async () => {
		const checkedAt = "2026-09-21T15:00:00.000Z";
		const health = { status: "unavailable", checkedAt, reason: "WORKER_BINDING_UNAVAILABLE" };
		const refreshed = {
			...mockDiagnosticData,
			health,
			workers: [
				{ ...mockDiagnosticData.workers[0], health },
				{
					service: "app",
					workerName: "app",
					physicalName: "api-worker",
					deploymentGroup: "api",
					modules: ["api", "app"],
					isShared: true,
					sharedWith: ["api"],
					health: { status: "ready", checkedAt, reason: null },
				},
			],
		};
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(Response.json(mockDiagnosticData))
			.mockResolvedValueOnce(Response.json({ health, diagnostic: refreshed }));
		render(<PluginConfigurationTab pluginId="supbrd-plug-identity" locale="en" />);
		fireEvent.click(await screen.findByRole("button", { name: "Re-check Health" }));
		const identity = await screen.findByRole("row", { name: /^identity / });
		expect(await within(identity).findByText("Unavailable")).toBeInTheDocument();
		const app = await screen.findByRole("row", { name: /^app / });
		expect(within(app).getByText("Ready")).toBeInTheDocument();
		expect(within(app).getByText("api-worker")).toBeInTheDocument();
	});

	it("keeps route pagination usable when a refreshed inventory has fewer pages", async () => {
		const routes = Array.from({ length: 17 }, (_, index) => ({
			method: "GET",
			path: `/api/${index}`,
		}));
		const initial = {
			...mockDiagnosticData,
			routes: { ...mockDiagnosticData.routes, api: routes },
		};
		const health = { ...mockDiagnosticData.health, checkedAt: "2026-09-21T15:00:00.000Z" };
		const refreshed = {
			...initial,
			health,
			routes: { ...initial.routes, api: routes.slice(0, 9) },
		};
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(Response.json(initial))
			.mockResolvedValueOnce(Response.json({ health, diagnostic: refreshed }));
		render(<PluginConfigurationTab pluginId="supbrd-plug-identity" locale="en" />);
		fireEvent.click(await screen.findByRole("button", { name: "API Routes (17)" }));
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(screen.getByText("/api/16")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Re-check Health" }));
		expect(await screen.findByText("/api/8")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Previous" }));
		expect(screen.getByText("/api/0")).toBeInTheDocument();
	});

	it("retains declared information but stops claiming service availability after a failed request", async () => {
		const initial = {
			...mockDiagnosticData,
			workers: mockDiagnosticData.workers.map((worker) => ({
				...worker,
				health: mockDiagnosticData.health,
			})),
		};
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(Response.json(initial))
			.mockRejectedValueOnce(new Error("Connection failed"));
		render(<PluginConfigurationTab pluginId="supbrd-plug-identity" locale="en" />);
		fireEvent.click(await screen.findByRole("button", { name: "Re-check Health" }));
		const row = await screen.findByRole("row", { name: /^identity / });
		expect(await within(row).findByText("Unknown")).toBeInTheDocument();
		expect(within(row).getByText("identity-worker")).toBeInTheDocument();
		expect(screen.getByText("1.2.0")).toBeInTheDocument();
	});
});
