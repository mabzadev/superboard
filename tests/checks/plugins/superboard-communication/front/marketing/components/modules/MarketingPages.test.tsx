import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	fireEvent,
	render,
	screen,
	waitFor,
} from "../../../../../../packages/supbrd-front-ui/render.js";

const projectSelection = vi.hoisted(() => ({ project: { id: "10-test", name: "Test" } }));
const studio = vi.hoisted(() => ({ getStudioSettings: vi.fn(), saveStudioSettings: vi.fn() }));
vi.mock(
	"../../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/service.js",
	() => studio,
);

const transactional = vi.hoisted(() => ({
	getSmtpSettings: vi.fn(),
	getDeliveryOutbox: vi.fn(),
	getEmailDeadLetters: vi.fn(),
	getProviderEvents: vi.fn(),
	testSmtpSettings: vi.fn(),
}));
vi.mock(
	"../../../../../../../../packages/plugins/superboard-communication/src/front/email/api/email/emailService.js",
	() => transactional,
);
import { EmailAdministration } from "../../../../../../../../packages/plugins/superboard-communication/src/front/email/components/modules/EmailAdministration.js";

const marketing = vi.hoisted(() => ({
	getEmailCampaigns: vi.fn(),
	getEmailTemplates: vi.fn(),
	getMarketingMedia: vi.fn(),
	getSubscriberLists: vi.fn(),
	getSubscriberSegments: vi.fn(),
	getSmtpSettings: vi.fn(),
	getProviderWebhooks: vi.fn(),
	getDeliveryOutbox: vi.fn(),
	getMarketingAudit: vi.fn(),
	getMarketingDeadLetters: vi.fn(),
	replayMarketingDeadLetter: vi.fn(),
	discardMarketingDeadLetter: vi.fn(),
	scheduleEmailCampaign: vi.fn(),
	testEmailCampaign: vi.fn(),
	testSmtpSettings: vi.fn(),
}));

vi.mock(
	"../../../../../../../../packages/plugins/superboard-communication/src/front/marketing/api/marketing/marketingService.js",
	() => marketing,
);
vi.mock("../../../../../../../../packages/supbrd-front-ui/src/shared/lib/config.js", () => ({
	config: {
		apiPath: "/api/v1",
		apiUrl: "https://api.example.test",
		clientId: "dashboard-test",
	},
}));
vi.mock(
	"../../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({
			selectedProject: projectSelection.project,
		}),
	}),
);
vi.mock("../../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js", () => ({
	showErrorNotification: vi.fn(),
	showSuccessNotification: vi.fn(),
}));
vi.mock("../../../../../../packages/supbrd-front-ui/empty-shell.js", () => ({
	default: () => <header>Marketing</header>,
}));
vi.mock("@superboard/front-ui/plugin-configuration-tab", () => ({
	PluginConfigurationTab: () => <div data-testid="plugin-config-tab">Plugin configuration</div>,
}));

import { FrontContextProvider } from "@superboard/front-ui/context";

import {
	MarketingListPage,
	MarketingDeliveryPanel,
	MarketingSettingsPage,
} from "../../../../../../../../packages/plugins/superboard-communication/src/front/marketing/components/modules/MarketingPages.js";

describe("Marketing campaign operations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		projectSelection.project = { id: "10-test", name: "Test" };
		window.history.replaceState(null, "", "/communication/settings");
		marketing.getEmailCampaigns.mockResolvedValue([
			{
				id: "campaign-1",
				name: "Welcome",
				subject: "Welcome aboard",
				status: "draft",
				tracking_enabled: true,
			},
			{
				id: "campaign-2",
				name: "Newsletter",
				subject: "August news",
				status: "draft",
				tracking_enabled: true,
			},
		]);
		marketing.getEmailTemplates.mockResolvedValue([]);
		marketing.getMarketingMedia.mockResolvedValue([]);
		marketing.getSubscriberLists.mockResolvedValue([]);
		marketing.getSubscriberSegments.mockResolvedValue([]);
		marketing.getSmtpSettings.mockResolvedValue({
			configured: false,
			profiles: [],
		});
		marketing.getProviderWebhooks.mockResolvedValue([]);
		marketing.getDeliveryOutbox.mockResolvedValue([]);
		marketing.getMarketingAudit.mockResolvedValue([]);
		marketing.getMarketingDeadLetters.mockResolvedValue([]);
		marketing.replayMarketingDeadLetter.mockResolvedValue({
			id: "dead-letter-1",
			status: "replayed",
		});
		marketing.discardMarketingDeadLetter.mockResolvedValue({
			id: "dead-letter-1",
			status: "discarded",
		});
		marketing.scheduleEmailCampaign.mockResolvedValue({});
		marketing.testEmailCampaign.mockResolvedValue({ ok: true });
		marketing.testSmtpSettings.mockResolvedValue({ ok: true });
	});

	it("keeps scheduling and test-recipient input isolated per campaign", async () => {
		render(<MarketingListPage kind="campaigns" />);

		await screen.findByText("Welcome aboard");

		const welcomeSchedule = screen.getByLabelText("Schedule Welcome");
		const newsletterSchedule = screen.getByLabelText("Schedule Newsletter");
		fireEvent.change(welcomeSchedule, {
			target: { value: "2026-08-10T10:00" },
		});

		expect(welcomeSchedule).toHaveValue("2026-08-10T10:00");
		expect(newsletterSchedule).toHaveValue("");

		const welcomeRecipient = screen.getByLabelText("Test recipient for Welcome");
		const newsletterRecipient = screen.getByLabelText("Test recipient for Newsletter");
		fireEvent.change(welcomeRecipient, {
			target: { value: "qa@example.test" },
		});

		expect(welcomeRecipient).toHaveValue("qa@example.test");
		expect(newsletterRecipient).toHaveValue("");

		const testButtons = screen.getAllByRole("button", { name: "Test" });
		fireEvent.click(testButtons[0]!);

		await waitFor(() =>
			expect(marketing.testEmailCampaign).toHaveBeenCalledWith(
				"10-test",
				"campaign-1",
				"qa@example.test",
			),
		);
	});

	it("inspects and replays an individual Marketing dead letter", async () => {
		marketing.getMarketingDeadLetters.mockResolvedValue([
			{
				id: "dead-letter-1",
				source_queue: "marketing-delivery-dlq",
				queue_message_id: "queue-message-1",
				job_type: "marketing.email.deliver",
				resource_id: "delivery-1",
				replayable: true,
				attempts: 6,
				status: "quarantined",
				resolution: null,
				received_at: "2026-08-10T10:00:00.000Z",
				resolved_at: null,
			},
		]);

		render(<MarketingDeliveryPanel section="operations" />);

		await screen.findByText("marketing.email.deliver");
		expect(screen.getByText("delivery-1")).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Replay dead letter dead-letter-1",
			}),
		);

		await waitFor(() =>
			expect(marketing.replayMarketingDeadLetter).toHaveBeenCalledWith("10-test", "dead-letter-1"),
		);
	});

	it("renders delivery settings and switches to configuration tab", async () => {
		render(<MarketingSettingsPage />);

		expect(await screen.findByRole("tab", { name: "Delivery settings" })).toBeInTheDocument();
		const configTab = screen.getByRole("tab", { name: "Configuration" });
		expect(configTab).toBeInTheDocument();

		fireEvent.mouseDown(configTab, { button: 0, ctrlKey: false });

		await waitFor(() => {
			expect(screen.getByTestId("plugin-config-tab")).toHaveTextContent("Plugin configuration");
		});
	});

	it("keeps operational delivery controls out of Settings", async () => {
		render(<MarketingSettingsPage />);
		await screen.findByRole("tab", { name: "Delivery settings" });
		expect(screen.queryByText("Delivery outbox")).not.toBeInTheDocument();
		expect(screen.queryByText("Marketing dead letters")).not.toBeInTheDocument();
		expect(
			screen.queryByPlaceholderText("Delivery test recipient (optional)"),
		).not.toBeInTheDocument();
	});

	it("runs sender tests only from delivery operations with an explicit recipient", async () => {
		marketing.getSmtpSettings.mockResolvedValue({
			configured: true,
			profiles: [
				{
					id: "sender-1",
					name: "Sender",
					configured: true,
					enabled: true,
					from_email: "sender@example.test",
				},
			],
		});
		render(<MarketingDeliveryPanel section="operations" />);
		const send = await screen.findByRole("button", { name: "Test Sender" });
		expect(send).toBeDisabled();
		fireEvent.change(screen.getByPlaceholderText("Test recipient"), {
			target: { value: "test@example.test" },
		});
		expect(send).toBeEnabled();
		fireEvent.click(send);
		await waitFor(() =>
			expect(marketing.testSmtpSettings).toHaveBeenCalledWith(
				"10-test",
				"sender-1",
				"test@example.test",
			),
		);
	});

	it("can test a disabled transactional sender before enabling its delivery pool", async () => {
		transactional.getSmtpSettings.mockResolvedValue({
			configured: true,
			profiles: [{ id: "candidate", name: "Candidate", enabled: false, configured: true }],
		});
		transactional.getDeliveryOutbox.mockResolvedValue([]);
		transactional.getEmailDeadLetters.mockResolvedValue([]);
		transactional.getProviderEvents.mockResolvedValue([]);
		transactional.testSmtpSettings.mockResolvedValue({ ok: true });
		render(<EmailAdministration section="operations" />);
		const send = await screen.findByRole("button", { name: "Test Candidate" });
		expect(send).toBeDisabled();
		fireEvent.change(screen.getByPlaceholderText("Test recipient"), {
			target: { value: "qa@example.test" },
		});
		expect(send).toBeEnabled();
		fireEvent.click(send);
		await waitFor(() =>
			expect(transactional.testSmtpSettings).toHaveBeenCalledWith(
				"10-test",
				"candidate",
				"qa@example.test",
			),
		);
	});

	it("opens shared language settings from the consolidated settings view", async () => {
		studio.getStudioSettings.mockResolvedValue({
			locales: ["en", "fr"],
			fallback_locale: "en",
			marketing_frequency_hours: 24,
			glossary: [],
		});
		render(<MarketingSettingsPage />);
		await screen.findByRole("tab", { name: "Delivery settings" });
		fireEvent.mouseDown(screen.getByRole("tab", { name: "Languages" }));
		await waitFor(() => expect(studio.getStudioSettings).toHaveBeenCalledWith("10-test"));
		expect(await screen.findByDisplayValue("en, fr")).toBeVisible();
	});

	it("renders settings tabs in French", async () => {
		render(
			<FrontContextProvider
				value={{
					instanceId: "1",
					pluginId: "supbrd-plug-communication",
					path: "/communication/settings",
					parameters: {},
					locale: "fr",
					operator: null,
					projectScope: null,
					activePluginIds: ["supbrd-plug-communication"],
				}}
			>
				<MarketingSettingsPage />
			</FrontContextProvider>,
		);

		expect(await screen.findByRole("tab", { name: "Paramètres d’envoi" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Configuration" })).toBeInTheDocument();
	});
});
