import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	fireEvent,
	render,
	screen,
	waitFor,
} from "../../../../../../packages/supbrd-front-ui/render.js";

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
}));

vi.mock(
	"../../../../../../../../packages/plugins/supbrd-plug-communication/src/front/marketing/api/marketing/marketingService.js",
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
			selectedProject: { id: "10-test", name: "Test" },
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

import {
	MarketingListPage,
	MarketingSettingsPage,
} from "../../../../../../../../packages/plugins/supbrd-plug-communication/src/front/marketing/components/modules/MarketingPages.js";

describe("Marketing campaign operations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
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

		render(<MarketingSettingsPage />);

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
});
