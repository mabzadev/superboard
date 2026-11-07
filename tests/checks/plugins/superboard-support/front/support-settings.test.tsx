import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, waitFor } from "../../../packages/supbrd-front-ui/render.js";

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
	updateNotificationPreferences: vi.fn(),
	getAudit: vi.fn(),
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
		getSupportAudit: services.getAudit,
		getSupportNotifications: services.listNotifications,
		getSupportNotificationPreferences: services.getNotificationPreferences,
		updateSupportNotificationPreferences: services.updateNotificationPreferences,
		markSupportNotificationRead: vi.fn(),
		markAllSupportNotificationsRead: vi.fn(),
		snoozeSupportNotification: vi.fn(),
		deleteSupportNotification: vi.fn(),
	}),
);

import { FrontContextProvider } from "@superboard/front-ui/context";

import SupportSettingsPage from "../../../../../packages/plugins/superboard-support/src/front/components/modules/SupportSettingsPage.js";
import SupportConfigurationView from "../../../../../packages/plugins/superboard-support/src/front/views/superboard.support_configuration.js";

const saveTimeout = { timeout: 3000 };

function storedSettings(overrides: Record<string, unknown> = {}) {
	return {
		business_name: "Care",
		locale: "en",
		timezone: "UTC",
		date_format: "YYYY-MM-DD",
		auto_resolve_minutes: 120,
		attachment_max_bytes: 10 * 1024 * 1024,
		allowed_content_types: ["image/png"],
		features: { realtime: true, captain: true },
		...overrides,
	};
}

function savedSettings() {
	const call = services.updateSettings.mock.lastCall as
		| [string, Record<string, unknown>]
		| undefined;
	return call?.[1];
}

describe("SupportSettingsPage", () => {
	beforeAll(() => {
		if (!("PointerEvent" in window))
			Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });
	});

	beforeEach(() => {
		vi.clearAllMocks();
		window.history.replaceState(null, "", "/support/settings");
		services.getSettings.mockResolvedValue({ data: { settings: storedSettings() } });
		services.updateSettings.mockResolvedValue({ data: {} });
		services.updateNotificationPreferences.mockResolvedValue({ data: {} });
		services.getAudit.mockResolvedValue({ data: [] });
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
		expect(await screen.findByRole("switch", { name: "Email" })).toBeChecked();
		await user.click(screen.getByRole("tab", { name: "Advanced" }));
		expect(new URL(window.location.href).searchParams.get("tab")).toBe("operations");
		expect(new URL(window.location.href).searchParams.get("lang")).toBe("fr");
	});

	it.each(["missing", "configuration"])("keeps the %s tab name from hiding all settings", (tab) => {
		window.history.replaceState(null, "", `/support/settings?tab=${tab}`);
		render(<SupportSettingsPage />);
		expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
	});

	it("shows no editable defaults while the existing settings are still loading", () => {
		services.getSettings.mockReturnValue(new Promise(() => {}));
		render(<SupportSettingsPage />);
		expect(screen.getByLabelText("Loading")).toBeInTheDocument();
		expect(screen.queryByLabelText("Business name", { exact: true })).not.toBeInTheDocument();
	});

	it("does not write the settings back when it loads them", async () => {
		render(<SupportSettingsPage />);
		expect(await screen.findByLabelText("Business name", { exact: true })).toHaveValue("Care");
		await new Promise((resolve) => {
			setTimeout(resolve, 900);
		});
		expect(services.updateSettings).not.toHaveBeenCalled();
	});

	it("saves a profile change automatically, without a save button", async () => {
		render(<SupportSettingsPage />);
		const name = await screen.findByLabelText("Business name", { exact: true });
		expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
		fireEvent.change(name, { target: { value: "Care team" } });
		await waitFor(
			() =>
				expect(services.updateSettings).toHaveBeenCalledWith(
					"project-1",
					expect.objectContaining({ business_name: "Care team", auto_resolve_minutes: 120 }),
				),
			saveTimeout,
		);
		expect(await screen.findByText("All changes saved.")).toBeInTheDocument();
	});

	it("keeps the auto-resolve delay hidden until the option is switched on", async () => {
		services.getSettings.mockResolvedValue({
			data: { settings: storedSettings({ auto_resolve_minutes: null }) },
		});
		render(<SupportSettingsPage />);
		const option = await screen.findByRole("switch", {
			name: "Resolve inactive conversations automatically",
		});
		expect(option).not.toBeChecked();
		expect(screen.queryByLabelText("Resolve after")).not.toBeInTheDocument();
		fireEvent.click(option);
		expect(screen.getByLabelText("Resolve after")).toHaveValue("1");
		expect(screen.getByRole("combobox", { name: "Unit" })).toHaveValue("days");
		await waitFor(() => expect(savedSettings()?.auto_resolve_minutes).toBe(1440), saveTimeout);
	});

	it("edits the auto-resolve delay in hours and saves it in minutes", async () => {
		render(<SupportSettingsPage />);
		const delay = await screen.findByLabelText("Resolve after");
		expect(delay).toHaveValue("2");
		expect(screen.getByRole("combobox", { name: "Unit" })).toHaveValue("hours");
		fireEvent.change(delay, { target: { value: "3" } });
		await waitFor(() => expect(savedSettings()?.auto_resolve_minutes).toBe(180), saveTimeout);
	});

	it("keeps limits in the advanced tab and saves them without losing stored feature flags", async () => {
		const user = userEvent.setup();
		render(<SupportSettingsPage />);
		await screen.findByLabelText("Business name", { exact: true });
		expect(screen.queryByLabelText("Maximum attachment size (MB)")).not.toBeInTheDocument();

		await user.click(screen.getByRole("tab", { name: "Advanced" }));
		const size = await screen.findByLabelText("Maximum attachment size (MB)");
		expect(size).toHaveValue("10");
		expect(screen.queryByRole("switch", { name: "realtime" })).not.toBeInTheDocument();
		fireEvent.change(size, { target: { value: "5" } });
		await waitFor(
			() =>
				expect(savedSettings()).toMatchObject({
					attachment_max_bytes: 5 * 1024 * 1024,
					features: { realtime: true, captain: true },
				}),
			saveTimeout,
		);
	});

	it("does not save an auto-resolve delay shorter than one minute", async () => {
		render(<SupportSettingsPage />);
		fireEvent.change(await screen.findByLabelText("Resolve after"), { target: { value: "0" } });
		expect(
			await screen.findByText("Enter a duration between one minute and one year."),
		).toBeVisible();
		await new Promise((resolve) => {
			setTimeout(resolve, 900);
		});
		expect(services.updateSettings).not.toHaveBeenCalled();
	});

	it("leaves the action history to the Quality page", async () => {
		window.history.replaceState(null, "", "/support/settings?tab=operations");
		render(<SupportSettingsPage />);
		await waitFor(() => expect(services.getOperations).toHaveBeenCalled());
		expect(await screen.findByLabelText("Maximum attachment size (MB)")).toBeInTheDocument();
		expect(services.getAudit).not.toHaveBeenCalled();
	});

	it("sends old contact links to the Inbox contacts", () => {
		const browserLocation = window.location;
		const replace = vi.fn<(target: URL) => void>();
		Object.defineProperty(window, "location", {
			configurable: true,
			writable: true,
			value: {
				href: "https://site.example.test/support/settings?tab=contacts&contact=contact-1",
				search: "?tab=contacts&contact=contact-1",
				pathname: "/support/settings",
				replace,
			},
		});
		try {
			render(<SupportSettingsPage />);
			const target = replace.mock.calls[0]?.[0];
			expect(target?.pathname).toBe("/support/inbox");
			expect(target?.searchParams.get("section")).toBe("contacts");
			expect(target?.searchParams.get("contact")).toBe("contact-1");
			expect(target?.searchParams.has("tab")).toBe(false);
		} finally {
			Object.defineProperty(window, "location", {
				configurable: true,
				writable: true,
				value: browserLocation,
			});
		}
	});

	it("does not save an attachment size above the limit", async () => {
		window.history.replaceState(null, "", "/support/settings?tab=operations");
		render(<SupportSettingsPage />);
		const size = await screen.findByLabelText("Maximum attachment size (MB)");
		fireEvent.change(size, { target: { value: "50" } });
		expect(await screen.findByText("Enter a size greater than 0 and at most 10 MB.")).toBeVisible();
		await new Promise((resolve) => {
			setTimeout(resolve, 900);
		});
		expect(services.updateSettings).not.toHaveBeenCalled();
	});

	it("saves notification preferences automatically, including muted events", async () => {
		window.history.replaceState(null, "", "/support/settings?tab=notifications");
		render(<SupportSettingsPage />);
		fireEvent.click(await screen.findByRole("switch", { name: "Mobile push" }));
		fireEvent.click(screen.getByRole("switch", { name: "Conversation assignments" }));
		await waitFor(
			() =>
				expect(services.updateNotificationPreferences).toHaveBeenCalledWith("project-1", {
					email_enabled: true,
					push_enabled: false,
					browser_enabled: true,
					in_app_enabled: true,
					audio_enabled: true,
					muted_event_types: ["conversation_assigned"],
				}),
			saveTimeout,
		);
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
		await user.click(screen.getByRole("tab", { name: "Advanced" }));
		await waitFor(() => expect(services.getOperations).toHaveBeenCalled());
	});

	it("renders settings tabs and points diagnostics to Plugins", async () => {
		render(<SupportSettingsPage />);

		expect(screen.getByText("Settings")).toBeInTheDocument();
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"General",
			"Notifications",
			"Agents and teams",
			"Integrations",
			"AI assistant",
			"Advanced",
		]);
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
		expect(await screen.findByText("Profil du support")).toBeInTheDocument();
		expect(screen.getByText("Nom de l’entreprise")).toBeInTheDocument();
		expect(
			screen.getByRole("switch", { name: "Résoudre automatiquement les conversations inactives" }),
		).toBeChecked();
		expect(screen.getByRole("tab", { name: "Notifications" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Avancé" })).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "Configuration" })).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Ouvrir dans Plugins" })).toBeInTheDocument();
	});

	it("renders SupportSettingsPage from support_configuration view", async () => {
		render(<SupportConfigurationView />);

		expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
	});
});
