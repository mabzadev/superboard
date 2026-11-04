import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "../../../../../packages/supbrd-front-ui/render.js";

const services = vi.hoisted(() => ({
	getSettings: vi.fn(),
	updateSettings: vi.fn(),
	getOperations: vi.fn(),
	listDeadLetters: vi.fn(),
	replayDeadLetter: vi.fn(),
	discardDeadLetter: vi.fn(),
	listChannels: vi.fn(),
	listProviders: vi.fn(),
	listInboxes: vi.fn(),
	createProvider: vi.fn(),
	listNotifications: vi.fn(),
	getNotificationPreferences: vi.fn(),
	updateNotificationPreferences: vi.fn(),
	readAllNotifications: vi.fn(),
	readNotification: vi.fn(),
	snoozeNotification: vi.fn(),
	deleteNotification: vi.fn(),
	notifySuccess: vi.fn(),
	notifyError: vi.fn(),
}));

vi.mock(
	"../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({
			selectedProject: { id: "project-1", name: "Production" },
			selectedInstance: { role: "owner" },
		}),
	}),
);
vi.mock(
	"../../../../../../../packages/plugins/superboard-support/src/front/api/support/settingsService.js",
	() => ({
		getSupportSettings: services.getSettings,
		updateSupportSettings: services.updateSettings,
		getMessagingSettings: services.getSettings,
		updateMessagingSettings: services.updateSettings,
	}),
);
vi.mock(
	"../../../../../../../packages/plugins/superboard-support/src/front/api/support/operationsHealthService.js",
	() => ({
		getSupportOperationsHealth: services.getOperations,
		listSupportDeadLetters: services.listDeadLetters,
		replaySupportDeadLetter: services.replayDeadLetter,
		discardSupportDeadLetter: services.discardDeadLetter,
	}),
);
vi.mock(
	"../../../../../../../packages/plugins/superboard-support/src/front/api/support/channelsService.js",
	() => ({
		listSupportChannels: services.listChannels,
		listSupportProviders: services.listProviders,
		createSupportProvider: services.createProvider,
		deleteSupportProvider: vi.fn(),
		saveSupportProviderCredentials: vi.fn(),
		startSupportProviderOAuth: vi.fn(),
	}),
);
vi.mock(
	"../../../../../../../packages/plugins/superboard-support/src/front/api/support/workforceService.js",
	() => ({
		listSupportInboxes: services.listInboxes,
	}),
);
vi.mock(
	"../../../../../../../packages/plugins/superboard-support/src/front/api/support/operationsService.js",
	() => ({
		getSupportNotifications: services.listNotifications,
		getSupportNotificationPreferences: services.getNotificationPreferences,
		updateSupportNotificationPreferences: services.updateNotificationPreferences,
		markAllSupportNotificationsRead: services.readAllNotifications,
		markSupportNotificationRead: services.readNotification,
		snoozeSupportNotification: services.snoozeNotification,
		deleteSupportNotification: services.deleteNotification,
	}),
);
vi.mock("../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js", () => ({
	showErrorNotification: services.notifyError,
	showSuccessNotification: services.notifySuccess,
}));

import { FrontContextProvider } from "@superboard/front-ui/context";
import { ApiError, getErrorMessage } from "@superboard/front-ui/lib/ApiError.js";

import SupportChannelsPage from "../../../../../../../packages/plugins/superboard-support/src/front/components/modules/SupportChannelsPage.js";
import SupportInboxWorkspace from "../../../../../../../packages/plugins/superboard-support/src/front/components/modules/SupportInboxWorkspace.js";
import SupportSettingsPage from "../../../../../../../packages/plugins/superboard-support/src/front/components/modules/SupportSettingsPage.js";

describe("native Support Grow pages", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		services.getSettings.mockResolvedValue({
			data: {
				settings: {
					business_name: "Reference application Care",
					locale: "en",
					timezone: "Europe/Zurich",
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
				queues: [{ queue_name: "events", status: "queued", count: 2 }],
				dead_letters: [],
				providers: [{ provider: "telegram", status: "processed", count: 4 }],
				knowledge: [{ status: "indexed", count: 6 }],
				imports: [],
				exports: [],
			},
		});
		services.listDeadLetters.mockResolvedValue({
			data: [],
			pagination: { limit: 50, has_more: false, next_cursor: null },
		});
		services.listChannels.mockResolvedValue({ data: [] });
		services.listProviders.mockResolvedValue({
			data: [
				{
					id: "provider-1",
					provider: "telegram",
					display_name: "Customer Telegram",
					status: "configuration_required",
				},
			],
			pagination: { limit: 50, has_more: false, next_cursor: null },
		});
		services.listInboxes.mockResolvedValue({
			data: [
				{
					id: "inbox-1",
					name: "Web support",
					identifier: "web-support",
					channel_type: "widget",
					status: "active",
					auto_assignment: true,
					allow_reopen: true,
					csat_enabled: true,
					created_at: "2026-08-13T00:00:00.000Z",
					updated_at: "2026-08-13T00:00:00.000Z",
				},
			],
			pagination: { limit: 50, has_more: false, next_cursor: null },
		});
		services.createProvider.mockResolvedValue({
			data: {
				id: "provider-created",
				inbox_id: "inbox-1",
				provider: "widget",
				display_name: "Customer care",
				status: "configuration_required",
			},
		});
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
		services.updateNotificationPreferences.mockResolvedValue({
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

	it("renders typed project settings and live operations without migration language", async () => {
		const user = userEvent.setup();
		const { container } = render(<SupportSettingsPage />);

		expect(await screen.findByDisplayValue("Reference application Care")).toBeInTheDocument();
		expect(screen.getByLabelText("Feature flags")).not.toBeVisible();
		await user.click(screen.getByText("Advanced settings"));
		expect(screen.getByLabelText("Feature flags")).toBeVisible();
		await user.click(screen.getByRole("tab", { name: "Operations" }));
		await waitFor(() => expect(screen.getByText("Queued jobs")).toBeInTheDocument());
		expect(screen.getAllByText("2").length).toBeGreaterThan(0);
		expect(container.textContent).not.toMatch(/coming soon|migration|legacy/i);
	});

	it("presents an unconfigured provider as a normal SuperBoard state and masks credentials", async () => {
		const { container } = render(<SupportChannelsPage />);

		expect(await screen.findByText("Customer Telegram")).toBeInTheDocument();
		expect(screen.getByText("Not configured")).toBeInTheDocument();
		expect(container.textContent).not.toContain("client_secret");
		expect(container.textContent).not.toMatch(/coming soon|migration|legacy/i);
	});

	it("explains a failed connection list in French", async () => {
		services.listProviders.mockRejectedValue(new ApiError(getErrorMessage(404), 404));
		render(
			<FrontContextProvider
				value={{
					instanceId: "1",
					pluginId: "superboard-support",
					path: "/support/inbox",
					parameters: {},
					locale: "fr",
					operator: null,
					projectScope: null,
					activePluginIds: ["superboard-support"],
				}}
			>
				<SupportChannelsPage />
			</FrontContextProvider>,
		);

		const alert = await screen.findByRole("alert");
		expect(within(alert).getByText("Impossible de charger les données du support")).toBeVisible();
		expect(within(alert).getByText("La ressource demandée est introuvable.")).toBeVisible();
		expect(screen.getByRole("heading", { level: 3, name: "Connexions" })).toBeVisible();
	});

	it("shows channels and connections as stacked sections without sub-tabs", async () => {
		render(<SupportChannelsPage />);

		expect(await screen.findByRole("heading", { level: 3, name: "Channels" })).toBeVisible();
		expect(screen.getByRole("heading", { level: 3, name: "Connections" })).toBeVisible();
		expect(await screen.findByText("Customer Telegram")).toBeVisible();
		expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
	});

	it("attaches every new channel connection to a compatible active inbox", async () => {
		const user = userEvent.setup();
		render(<SupportChannelsPage />);
		await screen.findByRole("option", { name: "Web support" });
		await user.type(screen.getByPlaceholderText("Customer care"), "Customer care");
		await user.selectOptions(screen.getByLabelText("Inbox"), "inbox-1");
		await user.click(screen.getByRole("button", { name: /add/i }));

		await waitFor(() =>
			expect(services.createProvider).toHaveBeenCalledWith("project-1", {
				provider: "widget",
				display_name: "Customer care",
				inbox_id: "inbox-1",
				status: "configuration_required",
				settings: {},
			}),
		);
	});

	it("reaches project-wide Inbox sections through in-page tabs", async () => {
		window.history.replaceState(null, "", "/support/inbox?lang=en");
		const user = userEvent.setup();
		render(<SupportInboxWorkspace />);

		const sections = within(screen.getByRole("tablist", { name: "Inbox sections" }));
		expect(sections.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"Inboxes",
			"Channels",
			"Automations",
			"Proactive Support",
			"Reports",
		]);
		expect(await screen.findByText("Web support")).toBeInTheDocument();
		await user.click(sections.getByRole("tab", { name: "Channels" }));
		expect(new URL(window.location.href).searchParams.get("section")).toBe("channels");
		await user.click(sections.getByRole("tab", { name: "Inboxes" }));
		expect(new URL(window.location.href).searchParams.has("section")).toBe(false);
	});

	it("opens the requested Inbox section from legacy Support links", async () => {
		window.history.replaceState(null, "", "/support/inbox?section=channels");
		render(<SupportInboxWorkspace />);

		const sections = within(screen.getByRole("tablist", { name: "Inbox sections" }));
		expect(sections.getByRole("tab", { name: "Channels" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		expect(await screen.findByText("Customer Telegram")).toBeInTheDocument();
		expect(screen.getAllByRole("tablist")).toHaveLength(1);
	});

	it.each([
		["success", "configuration_pending", "notifySuccess", "Support channel authorized"],
		[
			"error",
			"authorization_failed",
			"notifyError",
			"Support channel authorization was not completed",
		],
	] as const)(
		"reports a channel authorization %s on the Inbox channels and clears the return address",
		async (result, code, notification, message) => {
			window.history.replaceState(
				null,
				"",
				`/support/inbox?section=channels&connection=provider-1&support_result=${result}&support_code=${code}&lang=en`,
			);
			render(<SupportInboxWorkspace />);

			expect(await screen.findByText("Customer Telegram")).toBeInTheDocument();
			await waitFor(() => expect(services[notification]).toHaveBeenCalledWith(message));
			const address = new URL(window.location.href);
			expect(address.searchParams.get("section")).toBe("channels");
			expect(address.searchParams.get("lang")).toBe("en");
			expect(address.searchParams.has("connection")).toBe(false);
			expect(address.searchParams.has("support_result")).toBe(false);
			expect(address.searchParams.has("support_code")).toBe(false);
		},
	);

	it("exposes native notification preferences and read-all controls", async () => {
		services.listNotifications.mockResolvedValue({
			data: [
				{
					id: "notification-1",
					notification_type: "assignment.updated",
					title: "Conversation assigned",
					body: "A priority conversation was assigned to you.",
					read_at: null,
					created_at: "2026-08-13T12:00:00.000Z",
				},
			],
		});
		services.readAllNotifications.mockResolvedValue({ data: { updated: 1 } });
		const user = userEvent.setup();
		render(<SupportSettingsPage />);

		await user.click(screen.getByRole("tab", { name: "Notifications" }));
		expect(await screen.findByText("Conversation assigned")).toBeInTheDocument();
		expect(screen.getByLabelText("Mobile push")).toBeChecked();
		await user.click(screen.getByRole("button", { name: /read all/i }));
		await waitFor(() => expect(services.readAllNotifications).toHaveBeenCalledWith("project-1"));
	});
});
