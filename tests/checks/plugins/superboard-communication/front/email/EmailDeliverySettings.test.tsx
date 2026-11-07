import { FrontContextProvider } from "@superboard/front-ui/context";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, waitFor } from "../../../../packages/supbrd-front-ui/render.js";

globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
if (!("PointerEvent" in window))
	Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });

const email = vi.hoisted(() => ({
	getEmailApiKeys: vi.fn(),
	createEmailApiKey: vi.fn(),
	revokeEmailApiKey: vi.fn(),
	getEventWebhooks: vi.fn(),
	createEventWebhook: vi.fn(),
	updateEventWebhook: vi.fn(),
	deleteEventWebhook: vi.fn(),
	testEventWebhook: vi.fn(),
	getEventWebhookDeliveries: vi.fn(),
	getSenderAuthentication: vi.fn(),
	saveSenderAuthentication: vi.fn(),
	verifySmtpDomain: vi.fn(),
}));
vi.mock(
	"../../../../../../packages/plugins/superboard-communication/src/front/email/api/email/emailService.js",
	() => email,
);
vi.mock("../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js", () => ({
	showErrorNotification: vi.fn(),
	showSuccessNotification: vi.fn(),
}));

import {
	EmailApiKeys,
	EmailEventWebhooks,
} from "../../../../../../packages/plugins/superboard-communication/src/front/email/components/modules/EmailDeveloperSettings.js";
import { SenderDomainAuthentication } from "../../../../../../packages/plugins/superboard-communication/src/front/email/components/modules/SenderDomainAuthentication.js";

const records = [
	{
		id: "spf",
		purpose: "spf",
		type: "TXT",
		host: "example.com",
		value: "v=spf1 include:amazonses.com ~all",
	},
	{
		id: "dkim",
		purpose: "dkim",
		type: "CNAME",
		host: "<token>._domainkey.example.com",
		value: "<token>.dkim.amazonses.com",
		needs: "dkim_tokens",
	},
	{
		id: "dmarc",
		purpose: "dmarc",
		type: "TXT",
		host: "_dmarc.example.com",
		value: "v=DMARC1; p=none; rua=mailto:dmarc-reports@example.com",
	},
];

describe("Email delivery settings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		email.getEmailApiKeys.mockResolvedValue([]);
		email.getEventWebhooks.mockResolvedValue([]);
		email.getSenderAuthentication.mockResolvedValue({
			profile_id: "p1",
			domain: "example.com",
			provider: "aws-ses",
			aws_region: "eu-west-1",
			config: { dkim_tokens: [] },
			records,
			status: "unverified",
			checked_at: null,
			report: null,
		});
	});

	it("shows a created API key once and lists only its prefix", async () => {
		email.createEmailApiKey.mockResolvedValue({
			id: "k1",
			name: "Backend",
			prefix: "sb_email_12345678",
			scopes: ["email:send"],
			created_at: "2026-10-31T10:00:00Z",
			last_used_at: null,
			secret: `sb_email_${"1".repeat(64)}`,
		});
		render(<EmailApiKeys project="10-test" />);
		fireEvent.change(await screen.findByLabelText("Key name"), { target: { value: "Backend" } });
		email.getEmailApiKeys.mockResolvedValue([
			{
				id: "k1",
				name: "Backend",
				prefix: "sb_email_12345678",
				scopes: ["email:send"],
				created_at: "2026-10-31T10:00:00Z",
				last_used_at: null,
			},
		]);
		fireEvent.click(screen.getByRole("button", { name: "Create key" }));
		expect(await screen.findByText("Copy this key now. It will not be shown again.")).toBeVisible();
		expect(screen.getByText(`sb_email_${"1".repeat(64)}`)).toBeVisible();
		expect(email.createEmailApiKey).toHaveBeenCalledWith("10-test", "Backend");
		expect(await screen.findByText(/sb_email_12345678…/)).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(screen.queryByText(`sb_email_${"1".repeat(64)}`)).not.toBeInTheDocument();
	});

	it("adds an HTTPS endpoint for selected events and sends a test event", async () => {
		email.createEventWebhook.mockResolvedValue({
			id: "w1",
			url: "https://hooks.example.dev/x",
			events: ["bounced"],
			enabled: true,
			secret_prefix: "whsec_123456…",
			description: null,
			secret: `whsec_${"2".repeat(64)}`,
		});
		email.testEventWebhook.mockResolvedValue({
			status: "delivered",
			responseStatus: 200,
			error: null,
		});
		render(<EmailEventWebhooks project="10-test" />);
		expect(screen.queryByLabelText("Endpoint URL (https://…)")).not.toBeInTheDocument();
		fireEvent.click(await screen.findByRole("button", { name: "Add an endpoint" }));
		fireEvent.change(screen.getByLabelText("Endpoint URL (https://…)"), {
			target: { value: "https://hooks.example.dev/x" },
		});
		for (const type of ["Sent", "Delivered", "Complained", "Opened", "Clicked", "Failed"])
			fireEvent.click(screen.getByRole("switch", { name: type }));
		email.getEventWebhooks.mockResolvedValue([
			{
				id: "w1",
				url: "https://hooks.example.dev/x",
				events: ["bounced"],
				enabled: true,
				secret_prefix: "whsec_123456…",
				description: null,
			},
		]);
		fireEvent.click(screen.getByRole("button", { name: "Add endpoint" }));
		await waitFor(() =>
			expect(email.createEventWebhook).toHaveBeenCalledWith("10-test", {
				url: "https://hooks.example.dev/x",
				events: ["bounced"],
			}),
		);
		expect(
			await screen.findByText("Copy this signing secret now. It will not be shown again."),
		).toBeVisible();
		fireEvent.click(await screen.findByRole("button", { name: "Send test event" }));
		await waitFor(() => expect(email.testEventWebhook).toHaveBeenCalledWith("10-test", "w1"));
	});

	it("generates DNS records, keeps placeholders uncopyable and shows verification results", async () => {
		email.verifySmtpDomain.mockResolvedValue({
			domain: "example.com",
			dkimSelector: null,
			records: [
				{
					...records[0],
					status: "mismatch",
					found: ["v=spf1 -all"],
					detail: "x",
					detail_key: "The SPF record does not include {include}. Use the suggested value.",
					detail_params: { include: "amazonses.com" },
					aligned: false,
				},
				{
					...records[2],
					status: "verified",
					found: [records[2].value],
					detail: "x",
					detail_key: "DMARC policy: p={policy}.",
					detail_params: { policy: "none" },
					aligned: true,
				},
			],
			spf: "mismatch",
			dkim: "unconfigured",
			dmarc: "verified",
			alignment: { spf: false, dkim: false, dmarc_policy: "none" },
			ready: false,
			checkedAt: "2026-10-31T10:00:00Z",
		});
		render(<SenderDomainAuthentication project="10-test" profileId="p1" />);
		expect(await screen.findByText("_dmarc.example.com")).toBeVisible();
		expect(screen.getAllByRole("button", { name: "Copy Value" })).toHaveLength(2);
		fireEvent.click(screen.getByRole("button", { name: "Verify records" }));
		expect(
			await screen.findByText(
				"The SPF record does not include amazonses.com. Use the suggested value.",
			),
		).toBeVisible();
		expect(screen.getByText("DMARC policy: p=none.")).toBeVisible();
		expect(screen.getByText("Not ready")).toBeVisible();
		expect(screen.getByText(/Fix the records marked below\./)).toBeVisible();
	});

	it("saves DNS settings as they are typed, without a save button", async () => {
		email.saveSenderAuthentication.mockImplementation(
			async (_project: string, _profile: string, config: object) => ({
				profile_id: "p1",
				domain: "example.com",
				provider: "aws-ses",
				aws_region: "eu-west-1",
				config,
				records,
				status: "unverified",
				checked_at: null,
				report: null,
			}),
		);
		render(<SenderDomainAuthentication project="10-test" profileId="p1" />);
		fireEvent.change(await screen.findByLabelText("DMARC report address (optional)"), {
			target: { value: "dmarc@example.com" },
		});
		expect(screen.queryByRole("button", { name: /Save/u })).not.toBeInTheDocument();
		await waitFor(
			() =>
				expect(email.saveSenderAuthentication).toHaveBeenCalledWith("10-test", "p1", {
					dkim_tokens: [],
					dmarc_rua: "dmarc@example.com",
				}),
			{ timeout: 3000 },
		);
		expect(await screen.findByText("All changes saved.")).toBeInTheDocument();
	});

	it("renders the wizard in French", async () => {
		render(
			<FrontContextProvider
				value={{
					instanceId: "1",
					pluginId: "superboard-email",
					path: "/communication/settings",
					parameters: {},
					locale: "fr",
					operator: null,
					projectScope: null,
					activePluginIds: ["superboard-email"],
				}}
			>
				<SenderDomainAuthentication project="10-test" profileId="p1" />
				<EmailApiKeys project="10-test" />
				<EmailEventWebhooks project="10-test" />
			</FrontContextProvider>,
		);
		expect(await screen.findByText(/Authentification du domaine/)).toBeVisible();
		expect(screen.getByRole("button", { name: "Vérifier les enregistrements" })).toBeVisible();
		expect(await screen.findByText("Clés API")).toBeVisible();
		expect(screen.getByText("Envoyer les événements à vos points de terminaison")).toBeVisible();
	});
});
