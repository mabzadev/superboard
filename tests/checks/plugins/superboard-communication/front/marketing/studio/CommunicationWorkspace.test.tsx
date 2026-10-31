import { FrontContextProvider } from "@superboard/front-ui/context";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	fireEvent,
	render,
	screen,
	waitFor,
} from "../../../../../packages/supbrd-front-ui/render.js";

// Radix switches measure themselves; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

const projectSelection = vi.hoisted(() => ({ project: { id: "10-test", name: "Test" } }));

const studio = vi.hoisted(() => ({
	getStudioSettings: vi.fn(),
	saveStudioSettings: vi.fn(),
	getStudioSenders: vi.fn(),
	getCampaignPreflight: vi.fn(),
	getStudioDeliveries: vi.fn(),
}));
vi.mock(
	"../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/service.js",
	() => studio,
);

const email = vi.hoisted(() => ({
	getSmtpSettings: vi.fn(),
	getProviderWebhooks: vi.fn(),
	createProviderWebhook: vi.fn(),
	deleteProviderWebhook: vi.fn(),
	saveSmtpSettings: vi.fn(),
	deleteSmtpSettings: vi.fn(),
	verifySmtpDomain: vi.fn(),
}));
vi.mock(
	"../../../../../../../packages/plugins/superboard-communication/src/front/email/api/email/emailService.js",
	() => email,
);

const marketing = vi.hoisted(() => ({
	getEmailTemplates: vi.fn(),
	getSmtpSettings: vi.fn(),
	migrateMarketingSenders: vi.fn(),
	getProviderWebhooks: vi.fn(),
	createProviderWebhook: vi.fn(),
	deleteProviderWebhook: vi.fn(),
	getMarketingChannelConnectors: vi.fn(),
	getEmailSuppressions: vi.fn(),
	createEmailSuppression: vi.fn(),
	deleteEmailSuppression: vi.fn(),
	getSubscriberLists: vi.fn(),
	updateSubscriberList: vi.fn(),
	createSubscriberList: vi.fn(),
	getEmailSubscriberPage: vi.fn(),
	getEmailCampaigns: vi.fn(),
	getSubscriberSegments: vi.fn(),
	updateEmailCampaign: vi.fn(),
	testEmailCampaign: vi.fn(),
}));
vi.mock(
	"../../../../../../../packages/plugins/superboard-communication/src/front/marketing/api/marketing/marketingService.js",
	() => marketing,
);
const audience = vi.hoisted(() => ({
	getContactPage: vi.fn(async () => []),
	getAudienceTags: vi.fn(async () => []),
	getAudienceFields: vi.fn(async () => []),
	getDoubleOptInSettings: vi.fn(async () => null),
	previewAudienceSegment: vi.fn(async () => ({ subscriber_count: 0 })),
	getSignupForms: vi.fn(async () => []),
}));
vi.mock(
	"../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/audience-service.js",
	() => audience,
);
vi.mock(
	"../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({ useProjectSelection: () => ({ selectedProject: projectSelection.project }) }),
);
vi.mock("../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js", () => ({
	showErrorNotification: vi.fn(),
	showSuccessNotification: vi.fn(),
}));

import CommunicationWorkspace from "../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/CommunicationWorkspace.js";
import { EmailCampaigns } from "../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/EmailCampaigns.js";

const document = (purpose: string) => ({
	source_locale: "en",
	fallback_locale: "en",
	purpose,
	locales: {},
});

describe("Communication workspace", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		studio.getStudioSettings.mockResolvedValue({
			locales: ["en", "fr"],
			fallback_locale: "en",
			marketing_frequency_hours: 24,
			glossary: [],
		});
		studio.getStudioSenders.mockResolvedValue([{ id: "sender-1", name: "Primary" }]);
		email.getSmtpSettings.mockResolvedValue({ configured: false, profiles: [] });
		email.getProviderWebhooks.mockResolvedValue([]);
		marketing.getSmtpSettings.mockResolvedValue({ configured: false, profiles: [] });
		marketing.getProviderWebhooks.mockResolvedValue([]);
		marketing.getMarketingChannelConnectors.mockResolvedValue([]);
		marketing.getEmailTemplates.mockResolvedValue([]);
		marketing.getEmailSuppressions.mockResolvedValue([]);
		marketing.getSubscriberLists.mockResolvedValue([]);
		marketing.getEmailSubscriberPage.mockResolvedValue([]);
		marketing.getSubscriberSegments.mockResolvedValue([]);
		marketing.getEmailCampaigns.mockResolvedValue([]);
	});

	it("opens former Settings links on the merged sending preferences with correct webhook URLs", async () => {
		window.history.replaceState(null, "", "/communication/settings?tab=languages");
		email.getProviderWebhooks.mockResolvedValue([{ id: "hook-email", provider: "ses" }]);
		marketing.getProviderWebhooks.mockResolvedValue([{ id: "hook-marketing", provider: "brevo" }]);
		render(<CommunicationWorkspace initialTab="senders" />);

		expect(await screen.findByRole("tab", { name: "Sending preferences" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		expect(await screen.findByDisplayValue("en, fr")).toBeVisible();
		expect(
			await screen.findByText("https://api.example.test/api/v1/email/provider-webhooks/hook-email"),
		).toBeVisible();
		expect(
			screen.getByText(
				"https://api.example.test/api/v1/marketing/provider-webhooks/hook-marketing",
			),
		).toBeVisible();
	});

	it("shows Email senders as authoritative and legacy Marketing senders read-only", async () => {
		window.history.replaceState(null, "", "/communication/settings");
		email.getSmtpSettings.mockResolvedValue({
			configured: true,
			profiles: [{ id: "email-1", name: "Primary", configured: true }],
		});
		marketing.getSmtpSettings.mockResolvedValue({
			configured: true,
			profiles: [
				{ id: "email-1", name: "Primary", configured: true },
				{ id: "legacy-1", name: "Old SMTP", from_email: "old@example.test", configured: true },
			],
		});
		marketing.migrateMarketingSenders.mockResolvedValue({ complete: true, imported: 1 });
		render(<CommunicationWorkspace initialTab="senders" />);

		expect(await screen.findByText("Legacy campaign senders (read-only)")).toBeVisible();
		expect(screen.getByText("Old SMTP")).toBeVisible();
		expect(screen.queryByText("Retry queue")).not.toBeInTheDocument();
		expect(screen.queryByText("Marketing dead letters")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Move to the Email service" }));
		await waitFor(() =>
			expect(marketing.migrateMarketingSenders).toHaveBeenCalledWith("10-test", ""),
		);
	});

	it("switches sections in place from the workspace navigation", async () => {
		// Plugin diagnostics moved to the Plugins page; old configuration links land on Senders.
		window.history.replaceState(null, "", "/communication/settings?tab=configuration");
		render(<CommunicationWorkspace initialTab="senders" />);
		expect(await screen.findByRole("tab", { name: "Senders & domains" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		expect(screen.queryByRole("tab", { name: "Configuration" })).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Open in Plugins" })).toHaveAttribute(
			"href",
			expect.stringMatching(/^\/_emdash\/admin\/plugins-manager\/[^/]+\/configuration$/),
		);

		fireEvent.click(screen.getByRole("button", { name: "Audience" }));

		expect(await screen.findByRole("heading", { name: "Audience" })).toBeVisible();
		expect(window.location.pathname).toBe("/communication/settings");
		expect(new URLSearchParams(window.location.search).get("tab")).toBe("contacts");
	});

	it("lists every email type behind one filter and guides a missing sender", async () => {
		window.history.replaceState(null, "", "/communication/campaigns");
		studio.getStudioSenders.mockResolvedValue([]);
		marketing.getEmailTemplates.mockResolvedValue([
			{
				id: "1",
				name: "Spring sale",
				template_type: "campaign",
				studio_document: document("campaign"),
			},
			{
				id: "2",
				name: "Welcome series",
				template_type: "campaign",
				studio_document: document("lifecycle"),
			},
			{ id: "3", name: "Receipt", template_type: "transactional" },
		]);
		render(<CommunicationWorkspace initialTab="emails" emailFilter="campaign" />);

		expect(await screen.findByRole("button", { name: "Spring sale" })).toBeVisible();
		expect(screen.queryByRole("button", { name: "Welcome series" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Receipt" })).not.toBeInTheDocument();
		expect(await screen.findByRole("button", { name: "Configure a sender" })).toBeVisible();

		fireEvent.click(screen.getByRole("button", { name: "All (3)" }));

		expect(await screen.findByRole("button", { name: "Welcome series" })).toBeVisible();
		expect(screen.getByRole("button", { name: "Receipt" })).toBeVisible();
	});

	it("lets operators lift manual suppressions only", async () => {
		window.history.replaceState(null, "", "/communication/settings?tab=suppressions");
		marketing.getEmailSuppressions.mockResolvedValue([
			{
				id: "s1",
				email: "blocked@example.test",
				reason: "manual",
				source: "admin",
				created_at: "2026-10-01",
			},
			{
				id: "s2",
				email: "left@example.test",
				reason: "unsubscribe",
				source: "tracking",
				created_at: "2026-10-01",
			},
		]);
		marketing.deleteEmailSuppression.mockResolvedValue({ deleted: true });
		marketing.createEmailSuppression.mockResolvedValue({});
		render(<CommunicationWorkspace initialTab="senders" />);

		const unblock = await screen.findByRole("button", { name: "Unblock blocked@example.test" });
		expect(
			screen.queryByRole("button", { name: "Unblock left@example.test" }),
		).not.toBeInTheDocument();
		fireEvent.click(unblock);
		await waitFor(() =>
			expect(marketing.deleteEmailSuppression).toHaveBeenCalledWith("10-test", "s1"),
		);

		fireEvent.change(screen.getByLabelText("Block an address"), {
			target: { value: "spam@example.test" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Block address" }));
		await waitFor(() =>
			expect(marketing.createEmailSuppression).toHaveBeenCalledWith("10-test", "spam@example.test"),
		);
	});

	it("keeps list visibility and opt-in mode editable", async () => {
		window.history.replaceState(null, "", "/communication/settings?tab=lists");
		marketing.getSubscriberLists.mockResolvedValue([
			{
				id: "list-1",
				name: "News",
				visibility: "public",
				optin_mode: "double",
				subscriber_count: 4,
			},
		]);
		marketing.updateSubscriberList.mockResolvedValue({});
		render(<CommunicationWorkspace initialTab="senders" />);

		expect(await screen.findByText("Double opt-in")).toBeVisible();
		expect(screen.getByText("Public")).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(marketing.updateSubscriberList).toHaveBeenCalledWith("10-test", "list-1", {
				name: "News",
				description: null,
				visibility: "public",
				optin_mode: "double",
			}),
		);
	});

	it("renders settings tabs in French", async () => {
		window.history.replaceState(null, "", "/communication/settings");
		render(
			<FrontContextProvider
				value={{
					instanceId: "1",
					pluginId: "superboard-marketing",
					path: "/communication/settings",
					parameters: {},
					locale: "fr",
					operator: null,
					projectScope: null,
					activePluginIds: ["superboard-marketing"],
				}}
			>
				<CommunicationWorkspace initialTab="senders" />
			</FrontContextProvider>,
		);

		expect(await screen.findByRole("tab", { name: "Expéditeurs et domaines" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Préférences d’envoi" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Automatisations" })).toBeInTheDocument();
	});
});

describe("Campaign sends", () => {
	it("sends a campaign test from the review step", async () => {
		const campaign = {
			id: "campaign-1",
			name: "Spring sale",
			subject: "Spring is here",
			status: "draft",
			template_id: "template-1",
			list_ids: [],
		};
		marketing.getEmailCampaigns.mockResolvedValue([campaign]);
		marketing.getSubscriberLists.mockResolvedValue([]);
		marketing.getSubscriberSegments.mockResolvedValue([]);
		marketing.updateEmailCampaign.mockResolvedValue(campaign);
		marketing.testEmailCampaign.mockResolvedValue({ ok: true });
		studio.getStudioSenders.mockResolvedValue([{ id: "sender-1", name: "Primary" }]);
		studio.getCampaignPreflight.mockResolvedValue({
			eligible: 3,
			excluded: 0,
			languages: [],
			issues: [],
		});
		render(
			<EmailCampaigns
				project="10-test"
				templateId="template-1"
				templates={[
					{
						id: "template-1",
						name: "Spring sale",
						template_type: "campaign",
						subject: "Spring is here",
					},
				]}
			/>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		fireEvent.click(screen.getByRole("button", { name: "Save and review" }));
		fireEvent.change(await screen.findByLabelText("Send a test to"), {
			target: { value: "qa@example.test" },
		});
		// Saving re-enables the review actions only once the campaign list has reloaded.
		const sendTest = screen.getByRole("button", { name: "Send test" });
		await waitFor(() => expect(sendTest).toBeEnabled());
		fireEvent.click(sendTest);

		await waitFor(() =>
			expect(marketing.testEmailCampaign).toHaveBeenCalledWith(
				"10-test",
				"campaign-1",
				"qa@example.test",
			),
		);
		expect(marketing.updateEmailCampaign).toHaveBeenCalledWith(
			"10-test",
			"campaign-1",
			expect.objectContaining({ tracking_enabled: true }),
		);
	});
});
