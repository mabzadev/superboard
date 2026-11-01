import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	fireEvent,
	render,
	screen,
	waitFor,
} from "../../../../../../packages/supbrd-front-ui/render.js";

const projectSelection = vi.hoisted(() => ({ project: { id: "10-test", name: "Test" } }));

const transactional = vi.hoisted(() => ({
	getSmtpSettings: vi.fn(),
	getDeliveryOutbox: vi.fn(),
	getEmailDeadLetters: vi.fn(),
	getProviderEvents: vi.fn(),
	testSmtpSettings: vi.fn(),
	retryDeliveryOutbox: vi.fn(),
}));
vi.mock(
	"../../../../../../../../packages/plugins/superboard-communication/src/front/email/api/email/emailService.js",
	() => transactional,
);

const marketing = vi.hoisted(() => ({
	getDeliveryOutbox: vi.fn(),
	getMarketingAudit: vi.fn(),
	getMarketingDeadLetters: vi.fn(),
	replayMarketingDeadLetter: vi.fn(),
	discardMarketingDeadLetter: vi.fn(),
	retryDeliveryOutbox: vi.fn(),
}));
vi.mock(
	"../../../../../../../../packages/plugins/superboard-communication/src/front/marketing/api/marketing/marketingService.js",
	() => marketing,
);
vi.mock(
	"../../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({ selectedProject: projectSelection.project }),
	}),
);
vi.mock("../../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js", () => ({
	showErrorNotification: vi.fn(),
	showSuccessNotification: vi.fn(),
}));

import { EmailAdministration } from "../../../../../../../../packages/plugins/superboard-communication/src/front/email/components/modules/EmailAdministration.js";
import { MarketingOperations } from "../../../../../../../../packages/plugins/superboard-communication/src/front/marketing/components/modules/MarketingPages.js";

describe("Communication delivery operations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		marketing.getDeliveryOutbox.mockResolvedValue([]);
		marketing.getMarketingAudit.mockResolvedValue([]);
		marketing.getMarketingDeadLetters.mockResolvedValue([]);
		marketing.replayMarketingDeadLetter.mockResolvedValue({ id: "dead-letter-1" });
		transactional.getSmtpSettings.mockResolvedValue({ configured: false, profiles: [] });
		transactional.getDeliveryOutbox.mockResolvedValue([]);
		transactional.getEmailDeadLetters.mockResolvedValue([]);
		transactional.getProviderEvents.mockResolvedValue([]);
		transactional.testSmtpSettings.mockResolvedValue({ ok: true });
		transactional.retryDeliveryOutbox.mockResolvedValue({ queued: true });
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

		render(<MarketingOperations />);

		await screen.findByText("marketing.email.deliver");
		expect(screen.getByText("delivery-1")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Replay dead letter dead-letter-1" }));

		await waitFor(() =>
			expect(marketing.replayMarketingDeadLetter).toHaveBeenCalledWith("10-test", "dead-letter-1"),
		);
	});

	it("can test a disabled transactional sender before enabling its delivery pool", async () => {
		transactional.getSmtpSettings.mockResolvedValue({
			configured: true,
			profiles: [{ id: "candidate", name: "Candidate", enabled: false, configured: true }],
		});
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

	it("only lists waiting or failed transactional emails and retries them", async () => {
		transactional.getDeliveryOutbox.mockResolvedValue([
			{
				id: "sent-1",
				subject: "Receipt",
				job_type: "transactional",
				status: "sent",
				created_at: "",
			},
			{
				id: "failed-1",
				subject: "Password reset",
				job_type: "transactional",
				status: "failed",
				last_error: "smtp_timeout",
				created_at: "",
			},
		]);
		render(<EmailAdministration section="operations" />);
		expect(await screen.findByText("Password reset")).toBeVisible();
		expect(screen.queryByText("Receipt")).not.toBeInTheDocument();
		expect(screen.getByText("Email dead letters")).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(transactional.retryDeliveryOutbox).toHaveBeenCalledWith("10-test", "failed-1"),
		);
	});
});
