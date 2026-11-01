import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen, waitFor } from "../../../packages/supbrd-front-ui/render.js";

vi.mock(
	"../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({
			selectedProject: { id: "project-1", name: "Production" },
			selectedInstance: { role: "owner" },
		}),
	}),
);

const services = vi.hoisted(() => ({
	getSettings: vi.fn(),
	updateSettings: vi.fn(),
	getOperations: vi.fn(),
	listDeadLetters: vi.fn(),
	listNotifications: vi.fn(),
	getNotificationPreferences: vi.fn(),
}));

vi.mock(
	"../../../../../packages/plugins/superboard-support/src/front/api/support/settingsService.js",
	() => ({
		getSupportSettings: services.getSettings,
		updateSupportSettings: services.updateSettings,
		getMessagingSettings: services.getSettings,
		updateMessagingSettings: services.updateSettings,
	}),
);

vi.mock(
	"../../../../../packages/plugins/superboard-support/src/front/api/support/operationsHealthService.js",
	() => ({
		getSupportOperationsHealth: services.getOperations,
		listSupportDeadLetters: services.listDeadLetters,
		replaySupportDeadLetter: vi.fn(),
		discardSupportDeadLetter: vi.fn(),
	}),
);

vi.mock(
	"../../../../../packages/plugins/superboard-support/src/front/api/support/operationsService.js",
	() => ({
		getSupportAudit: vi.fn().mockResolvedValue({ data: [] }),
		getSupportNotifications: services.listNotifications,
		getSupportNotificationPreferences: services.getNotificationPreferences,
		updateSupportNotificationPreferences: vi.fn(),
		markSupportNotificationRead: vi.fn(),
		markAllSupportNotificationsRead: vi.fn(),
		snoozeSupportNotification: vi.fn(),
		deleteSupportNotification: vi.fn(),
	}),
);

import { FrontContextProvider } from "@superboard/front-ui/context";

import SupportSettingsPage from "../../../../../packages/plugins/superboard-support/src/front/components/modules/SupportSettingsPage.js";
import SupportConfigurationView from "../../../../../packages/plugins/superboard-support/src/front/views/superboard.support_configuration.js";

describe("SupportSettingsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.history.replaceState(null, "", "/support/settings");
		services.getSettings.mockResolvedValue({
			data: {
				settings: {
					business_name: "Care",
					locale: "en",
					timezone: "UTC",
					date_format: "YYYY-MM-DD",
					auto_resolve_minutes: 120,
					attachment_max_bytes: 10 * 1024 * 1024,
					allowed_content_types: ["image/png"],
					features: { realtime: true, captain: true },
				},
			},
		});
		services.getOperations.mockResolvedValue({
			data: {
				queues: [],
				dead_letters: [],
				providers: [],
				knowledge: [],
				imports: [],
				exports: [],
			},
		});
		services.listDeadLetters.mockResolvedValue({ data: [] });
		services.listNotifications.mockResolvedValue({ data: [] });
		services.getNotificationPreferences.mockResolvedValue({
			data: {
				email_enabled: true,
				push_enabled: true,
				browser_enabled: true,
				in_app_enabled: true,
				audio_enabled: true,
				muted_event_types: [],
			},
		});
	});

	it("restores the requested tab after reload and updates its URL", async () => {
		window.history.replaceState(null, "", "/support/settings?tab=notifications&lang=fr");
		const user = userEvent.setup();
		render(<SupportSettingsPage />);
		expect(screen.getByRole("tab", { name: "Notifications" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Save preferences" })).toBeEnabled(),
		);
		await user.click(screen.getByRole("tab", { name: "Operations" }));
		expect(new URL(window.location.href).searchParams.get("tab")).toBe("operations");
		expect(new URL(window.location.href).searchParams.get("lang")).toBe("fr");
	});

	it.each(["missing", "configuration"])("keeps the %s tab name from hiding all settings", (tab) => {
		window.history.replaceState(null, "", `/support/settings?tab=${tab}`);
		render(<SupportSettingsPage />);
		expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
	});

	it("prevents editing defaults while the existing settings are still loading", () => {
		services.getSettings.mockReturnValue(new Promise(() => {}));
		render(<SupportSettingsPage />);
		expect(screen.getByLabelText("Business name", { exact: true })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
	});

	it("loads only the section the operator opens", async () => {
		const user = userEvent.setup();
		render(<SupportSettingsPage />);
		await waitFor(() => expect(services.getSettings).toHaveBeenCalled());
		expect(services.getOperations).not.toHaveBeenCalled();
		expect(services.getNotificationPreferences).not.toHaveBeenCalled();
		await user.click(screen.getByRole("tab", { name: "Notifications" }));
		await waitFor(() => expect(services.getNotificationPreferences).toHaveBeenCalled());
		expect(services.getOperations).not.toHaveBeenCalled();
		await user.click(screen.getByRole("tab", { name: "Operations" }));
		await waitFor(() => expect(services.getOperations).toHaveBeenCalled());
	});

	it("renders settings tabs and points diagnostics to Plugins", async () => {
		render(<SupportSettingsPage />);

		expect(screen.getByText("Settings")).toBeInTheDocument();
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"General",
			"Notifications",
			"Operations",
			"Agents and teams",
			"Contacts",
			"Integrations",
			"AI assistant",
		]);
		expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Notifications" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Operations" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Open in Plugins" })).toHaveAttribute(
			"href",
			expect.stringMatching(/^\/_emdash\/admin\/plugins-manager\/[^/]+\/configuration$/),
		);
	});

	it("renders settings in French", async () => {
		render(
			<FrontContextProvider
				value={{
					instanceId: "1",
					pluginId: "superboard-support",
					path: "/support/settings",
					parameters: {},
					locale: "fr",
					operator: null,
					projectScope: null,
					activePluginIds: ["superboard-support"],
				}}
			>
				<SupportSettingsPage />
			</FrontContextProvider>,
		);

		expect(screen.getByText("Paramètres")).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Général" })).toBeInTheDocument();
		expect(screen.getByText("Profil du support")).toBeInTheDocument();
		expect(screen.getByText("Nom de l’entreprise")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Enregistrer les paramètres" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Notifications" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Opérations" })).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "Configuration" })).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Ouvrir dans Plugins" })).toBeInTheDocument();
	});

	it("renders SupportSettingsPage from support_configuration view", async () => {
		render(<SupportConfigurationView />);

		expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
	});
});
