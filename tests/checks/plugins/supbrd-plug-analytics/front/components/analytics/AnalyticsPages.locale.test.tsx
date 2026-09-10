import { FrontContextProvider, type FrontContextValue } from "@superboard/front-ui/context";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	EmptyProject,
	ModulePage,
} from "../../../../../../../packages/supbrd-front-ui/src/shared/components/modules/ModulePage.js";

const state = vi.hoisted(() => ({
	project: { id: "project-1", name: "Reference application" } as {
		id: string;
		name: string;
	} | null,
	events: vi.fn(),
	reports: vi.fn(),
	operations: vi.fn(),
	success: vi.fn(),
}));

vi.mock(
	"../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({ selectedProject: state.project, projectType: "production" }),
	}),
);
vi.mock("../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js", () => ({
	showErrorNotification: vi.fn(),
	showSuccessNotification: state.success,
}));
vi.mock(
	"../../../../../../../packages/plugins/supbrd-plug-analytics/src/front/api/analytics/analyticsService.js",
	() => ({
		getAnalyticsOverview: vi.fn().mockResolvedValue({ events: 1234, series: [] }),
		getAnalyticsEvents: state.events,
		getAnalyticsEventAnalysis: vi.fn().mockResolvedValue(null),
		getAnalyticsInstallations: vi.fn().mockResolvedValue({ items: [] }),
		getAnalyticsPurchases: vi.fn().mockResolvedValue({ items: [] }),
		getAnalyticsRetention: vi.fn().mockResolvedValue({ cohorts: [] }),
		getAnalyticsEventDefinitions: vi.fn().mockResolvedValue({ items: [] }),
		getAnalyticsReports: state.reports,
		getAnalyticsOperations: state.operations,
		createAnalyticsOperation: vi.fn().mockResolvedValue({}),
		createAnalyticsReport: vi.fn().mockResolvedValue({}),
		deleteAnalyticsReport: vi.fn().mockResolvedValue({}),
		queryAnalyticsFunnel: vi.fn().mockResolvedValue({ steps: [] }),
		getAnalyticsSettings: vi.fn().mockResolvedValue({
			data_collection_enabled: true,
			hot_retention_days: 30,
			timezone: "UTC",
		}),
		getAnalyticsApplications: vi.fn().mockResolvedValue({ items: [] }),
		getAnalyticsHooks: vi.fn().mockResolvedValue({ items: [] }),
		getAnalyticsAnnotations: vi.fn().mockResolvedValue({ items: [] }),
		updateAnalyticsSettings: vi.fn().mockResolvedValue({}),
	}),
);

import {
	AnalyticsPage,
	type AnalyticsPageKind,
} from "../../../../../../../packages/plugins/supbrd-plug-analytics/src/front/components/analytics/AnalyticsPages.js";

function Page({ kind, locale }: { kind: AnalyticsPageKind; locale: "en" | "fr" }) {
	const context: FrontContextValue = {
		locale,
		path: `/analytics/${kind}`,
		parameters: {},
		instanceId: "instance-1",
		pluginId: "supbrd-plugmod-analytics",
		operator: null,
		projectScope: null,
		activePluginIds: ["supbrd-plugmod-analytics"],
	};
	return (
		<FrontContextProvider value={context}>
			<AnalyticsPage kind={kind} />
		</FrontContextProvider>
	);
}

describe("Analytics follows the console language", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.project = { id: "project-1", name: "Reference application" };
		state.events.mockResolvedValue({ items: [] });
		state.reports.mockResolvedValue({ items: [] });
		state.operations.mockResolvedValue({ items: [] });
	});

	it("keeps shared module wrappers usable without a console provider", () => {
		render(
			<ModulePage title="Statistics" description="Project activity" error="Service unavailable">
				<EmptyProject />
			</ModulePage>,
		);
		expect(screen.getByRole("heading", { level: 1, name: "Statistics" })).toBeInTheDocument();
		expect(screen.getByText("Unable to load this module")).toBeInTheDocument();
		expect(screen.getByText("Service unavailable")).toBeInTheDocument();
		expect(screen.getByText("Select a project to manage this module.")).toBeInTheDocument();
	});

	it.each([
		["overview", "Statistiques", "Analytics"],
		["events", "Explorateur d’événements", "Event explorer"],
		["installations", "Installations", "Installations"],
		["purchases", "Achats vérifiés", "Verified purchases"],
		["insights", "Entonnoirs et rétention", "Funnels & retention"],
		["reports", "Rapports et opérations de données", "Reports & data operations"],
	] as const)(
		"changes the %s view when the console locale changes",
		async (kind, french, english) => {
			const view = render(<Page kind={kind} locale="fr" />);
			expect(await screen.findByRole("heading", { level: 1, name: french })).toBeInTheDocument();
			view.rerender(<Page kind={kind} locale="en" />);
			expect(screen.getByRole("heading", { level: 1, name: english })).toBeInTheDocument();
		},
	);

	it("filters events through French controls and preserves the typed filter on language change", async () => {
		const view = render(<Page kind="events" locale="fr" />);
		fireEvent.change(screen.getByRole("textbox", { name: "Nom de l’événement" }), {
			target: { value: "checkout.completed" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Appliquer le filtre" }));
		await waitFor(() =>
			expect(state.events).toHaveBeenCalledWith(
				"project-1",
				expect.objectContaining({ event_name: "checkout.completed" }),
			),
		);
		expect(
			screen.getByText("Aucun événement ne correspond à cette période et à ce filtre."),
		).toBeInTheDocument();
		view.rerender(<Page kind="events" locale="en" />);
		expect(screen.getByRole("textbox", { name: "Event name" })).toHaveValue("checkout.completed");
		expect(screen.getByRole("button", { name: "Apply filter" })).toBeInTheDocument();
	});

	it("queues an export from the French report view and translates its confirmation", async () => {
		render(<Page kind="reports" locale="fr" />);
		fireEvent.click(screen.getByRole("button", { name: "Exporter les événements" }));
		await waitFor(() =>
			expect(state.success).toHaveBeenCalledWith("Export ajouté à la file d’attente"),
		);
	});

	it("translates the shared empty project prompt", () => {
		state.project = null;
		render(<Page kind="overview" locale="fr" />);
		expect(screen.getByText("Sélectionnez un projet pour gérer ce module.")).toBeInTheDocument();
	});

	it.each([
		["dashboards", "Tableaux de bord", "Dashboards"],
		["users", "Utilisateurs et sessions", "Users & sessions"],
		["dimensions", "Technologie et localisation", "Technology & location"],
		["views", "Pages et écrans", "Views"],
		["cohorts", "Cohortes", "Cohorts"],
		["crashes", "Plantages", "Crashes"],
		["feedback", "Avis", "Feedback"],
		["remote-config", "Configuration à distance", "Remote Config"],
		["alerts", "Alertes", "Alerts"],
		["settings", "Paramètres des statistiques", "Analytics settings"],
	] as const)(
		"changes the %s feature view without remounting the console",
		(kind, french, english) => {
			state.project = null;
			const view = render(<Page kind={kind} locale="fr" />);
			expect(screen.getByRole("heading", { level: 1, name: french })).toBeInTheDocument();
			view.rerender(<Page kind={kind} locale="en" />);
			expect(screen.getByRole("heading", { level: 1, name: english })).toBeInTheDocument();
		},
	);

	it("renders report dates, operation states and delete labels in French", async () => {
		state.reports.mockResolvedValue({
			items: [
				{
					id: "report-1",
					name: "Rapport démo",
					report_type: "dashboard",
					updated_at: "2026-09-08T12:00:00Z",
				},
			],
		});
		state.operations.mockResolvedValue({
			items: [
				{
					id: "operation-1",
					operation_type: "export",
					status: "queued",
					created_at: "2026-09-08T12:00:00Z",
				},
			],
		});
		render(<Page kind="reports" locale="fr" />);
		expect(
			await screen.findByRole("button", { name: "Supprimer Rapport démo" }),
		).toBeInTheDocument();
		expect(screen.getByText("En attente")).toBeInTheDocument();
		expect(screen.getByText(/Tableau de bord · mis à jour le .*sept\./)).toBeInTheDocument();
	});

	it("saves data collection settings through the French feature view", async () => {
		const user = userEvent.setup();
		render(<Page kind="settings" locale="fr" />);
		await user.click(screen.getByRole("tab", { name: "Collecte des données" }));
		await user.click(await screen.findByRole("button", { name: "Enregistrer les paramètres" }));
		await waitFor(() =>
			expect(state.success).toHaveBeenCalledWith("Paramètres des statistiques enregistrés"),
		);
	});
});
