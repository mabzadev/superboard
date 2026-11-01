import { FrontContextProvider } from "@superboard/front-ui/context";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../../../../packages/supbrd-front-ui/render.js";

globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

// Base UI checkboxes dispatch pointer events, which jsdom does not implement.
globalThis.PointerEvent ??= class extends MouseEvent {} as typeof PointerEvent;

const projectSelection = vi.hoisted(() => ({ project: { id: "10-test", name: "Test" } }));

const studio = vi.hoisted(() => ({
	getStudioSettings: vi.fn(async () => ({ locales: ["en", "fr"] })),
	saveStudioSettings: vi.fn(),
	getStudioSenders: vi.fn(async () => []),
	getCampaignPreflight: vi.fn(),
	getStudioDeliveries: vi.fn(),
}));
vi.mock(
	"../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/service.js",
	() => studio,
);

const marketing = vi.hoisted(() => ({
	getSubscriberLists: vi.fn(),
	getEmailCampaigns: vi.fn(async () => []),
	getSubscriberSegments: vi.fn(async () => []),
	getEmailSuppressions: vi.fn(async () => []),
	createEmailSubscriber: vi.fn(),
	updateEmailSubscriber: vi.fn(),
	deleteEmailSubscriber: vi.fn(),
	exportEmailSubscribers: vi.fn(),
	getEmailSubscriberExport: vi.fn(async () => ({ events: [] })),
	suppressEmailSubscriber: vi.fn(),
	getEmailTemplates: vi.fn(async () => []),
	getSmtpSettings: vi.fn(async () => ({ configured: false, profiles: [] })),
	migrateMarketingSenders: vi.fn(),
	getProviderWebhooks: vi.fn(async () => []),
	createProviderWebhook: vi.fn(),
	deleteProviderWebhook: vi.fn(),
	getMarketingChannelConnectors: vi.fn(async () => []),
	createEmailSuppression: vi.fn(),
	deleteEmailSuppression: vi.fn(),
	updateSubscriberList: vi.fn(),
	createSubscriberList: vi.fn(),
	deleteSubscriberList: vi.fn(),
	createSubscriberSegment: vi.fn(),
	updateSubscriberSegment: vi.fn(),
	deleteSubscriberSegment: vi.fn(),
	refreshSubscriberSegment: vi.fn(),
	getEmailSubscriberPage: vi.fn(async () => []),
	updateEmailCampaign: vi.fn(),
	testEmailCampaign: vi.fn(),
}));
vi.mock(
	"../../../../../../../packages/plugins/superboard-communication/src/front/marketing/api/marketing/marketingService.js",
	() => marketing,
);

const email = vi.hoisted(() => ({
	getSmtpSettings: vi.fn(async () => ({ configured: false, profiles: [] })),
	getProviderWebhooks: vi.fn(async () => []),
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
vi.mock("../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js", () => ({
	showErrorNotification: vi.fn(),
	showSuccessNotification: vi.fn(),
}));

const audience = vi.hoisted(() => ({
	getContactPage: vi.fn(),
	getAudienceTags: vi.fn(),
	getAudienceFields: vi.fn(),
	assignAudienceTags: vi.fn(),
	importAudience: vi.fn(),
	previewAudienceSegment: vi.fn(async () => ({ subscriber_count: 3 })),
	getDoubleOptInSettings: vi.fn(async () => null),
	getSignupForms: vi.fn(async () => []),
	createSignupForm: vi.fn(),
	getSignupFormEmbed: vi.fn(),
	createAudienceField: vi.fn(),
	createAudienceTag: vi.fn(),
}));
vi.mock(
	"../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/audience-service.js",
	() => audience,
);
vi.mock(
	"../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({ useProjectSelection: () => ({ selectedProject: projectSelection.project }) }),
);

import CommunicationWorkspace from "../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/CommunicationWorkspace.js";
import {
	guessColumnMapping,
	mapCsvRows,
	parseCsvTable,
} from "../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/contact-csv.js";

const contact = {
	id: "contact-1",
	email: "ada@example.test",
	name: "Ada",
	status: "enabled",
	consent_status: "confirmed",
	attributes: { plan: "Pro" },
	list_ids: [],
	tag_ids: ["tag-1"],
};

function french(children: React.ReactNode) {
	return (
		<FrontContextProvider
			value={{
				instanceId: "1",
				pluginId: "superboard-marketing",
				path: "/communication/audience",
				parameters: {},
				locale: "fr",
				operator: null,
				projectScope: null,
				activePluginIds: ["superboard-marketing"],
			}}
		>
			{children}
		</FrontContextProvider>
	);
}

describe("Audience", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		marketing.getSubscriberLists.mockResolvedValue([
			{ id: "list-1", name: "News", visibility: "public", optin_mode: "double" },
		]);
		audience.getContactPage.mockResolvedValue([contact]);
		audience.getAudienceTags.mockResolvedValue([{ id: "tag-1", name: "VIP", subscriber_count: 1 }]);
		audience.getAudienceFields.mockResolvedValue([
			{
				id: "field-1",
				key: "plan",
				label: "Plan",
				field_type: "select",
				options: ["Free", "Pro"],
				position: 0,
			},
		]);
		audience.assignAudienceTags.mockResolvedValue({ tag_ids: ["tag-2"], subscribers: 1 });
	});

	it("tags a selection of contacts and filters by tag", async () => {
		window.history.replaceState(null, "", "/communication/audience?tab=contacts");
		render(<CommunicationWorkspace initialTab="contacts" />);
		const row = (await screen.findByText("ada@example.test")).closest("tr")!;
		expect(within(row).getByText("VIP")).toBeVisible();
		fireEvent.click(screen.getByRole("checkbox", { name: "Select ada@example.test" }));
		expect(screen.getByText("1 selected")).toBeVisible();
		fireEvent.change(screen.getByRole("combobox", { name: "Tag name" }), {
			target: { value: "Newsletter 2026" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
		await waitFor(() =>
			expect(audience.assignAudienceTags).toHaveBeenCalledWith("10-test", {
				subscriber_ids: ["contact-1"],
				action: "add",
				tag_names: ["Newsletter 2026"],
			}),
		);
	});

	it.each([
		["/communication/audience?q=ada%40example.test", "contacts"],
		["/communication/marketing-email?tab=contacts&q=ada%40example.test", "emails"],
	])("opens %s with the linked contact search", async (url, initialTab) => {
		window.history.replaceState(null, "", url);
		render(<CommunicationWorkspace initialTab={initialTab} />);
		expect(await screen.findByText("ada@example.test")).toBeVisible();
		expect(screen.getByDisplayValue("ada@example.test")).toBeVisible();
		await waitFor(() =>
			expect(audience.getContactPage).toHaveBeenCalledWith(
				"10-test",
				expect.objectContaining({ q: "ada@example.test" }),
			),
		);
		expect(audience.getContactPage).not.toHaveBeenCalledWith(
			"10-test",
			expect.objectContaining({ q: "" }),
		);
	});

	it("shows project fields in the contact panel", async () => {
		window.history.replaceState(null, "", "/communication/audience?tab=contacts");
		render(<CommunicationWorkspace initialTab="contacts" />);
		fireEvent.click(await screen.findByRole("button", { name: /Ada/ }));
		expect(await screen.findByText("Plan")).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "Remove tag VIP" }));
		await waitFor(() =>
			expect(audience.assignAudienceTags).toHaveBeenCalledWith("10-test", {
				subscriber_ids: ["contact-1"],
				action: "remove",
				tag_ids: ["tag-1"],
			}),
		);
	});

	it("maps CSV columns and requires an explicit consent before importing", async () => {
		audience.importAudience.mockResolvedValue({
			received: 2,
			processed: 1,
			created: 1,
			updated: 0,
			unchanged: 0,
			skipped: 1,
			skipped_by_reason: { invalid_email: 1 },
			skipped_rows: [{ line: 3, email: "nope", reason: "invalid_email" }],
			confirmation_sent: 1,
		});
		window.history.replaceState(null, "", "/communication/audience?tab=contacts");
		render(<CommunicationWorkspace initialTab="contacts" />);
		await screen.findByText("ada@example.test");
		await waitFor(() => expect(audience.getAudienceFields).toHaveBeenCalled());
		fireEvent.click(screen.getByRole("button", { name: "Import CSV" }));
		const csv = "E-mail;Nom;Plan\nlin@example.test;Lin;Free\nnope;Bad;Pro";
		const file = new File([csv], "contacts.csv", { type: "text/csv" });
		// jsdom's File has no text() reader.
		Object.defineProperty(file, "text", { value: async () => csv });
		fireEvent.change(await screen.findByLabelText("CSV file"), { target: { files: [file] } });
		const importButton = await screen.findByRole("button", { name: "Import 2 contacts" });
		expect(importButton).toBeDisabled();
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: "I confirm that I have consent to email every contact I import",
			}),
		);
		expect(importButton).toBeEnabled();
		fireEvent.click(importButton);
		await waitFor(() =>
			expect(audience.importAudience).toHaveBeenCalledWith("10-test", {
				rows: [
					{ line: 2, email: "lin@example.test", name: "Lin", attributes: { plan: "Free" } },
					{ line: 3, email: "nope", name: "Bad", attributes: { plan: "Pro" } },
				],
				consent: "confirmed",
				consent_confirmed: true,
				list_ids: [],
				update_existing: true,
			}),
		);
		expect(await screen.findByText("1 confirmation emails are on their way.")).toBeVisible();
		expect(screen.getByText("Invalid email: 1")).toBeVisible();
	});

	it("creates a signup form with defaults and shows its embed code", async () => {
		audience.createSignupForm.mockResolvedValue({
			id: "form-1",
			name: "Footer",
			status: "active",
			submission_count: 0,
			settings: { popup: { enabled: false, delay_seconds: 5 } },
		});
		audience.getSignupFormEmbed.mockResolvedValue({
			hosted_url: "https://api.example.test/v1/communication/marketing/forms/form-1",
			script_snippet:
				'<script src="https://api.example.test/v1/communication/marketing/forms/form-1/embed.js" async></script>',
			html_snippet: "<form></form>",
		});
		window.history.replaceState(null, "", "/communication/audience?tab=forms");
		render(<CommunicationWorkspace initialTab="contacts" />);
		fireEvent.click(await screen.findByRole("button", { name: "Create form" }));
		fireEvent.change(screen.getByLabelText("Form name"), { target: { value: "Footer" } });
		fireEvent.click(screen.getByRole("checkbox", { name: "News" }));
		fireEvent.click(screen.getAllByRole("button", { name: "Create form" }).at(-1)!);
		await waitFor(() =>
			expect(audience.createSignupForm).toHaveBeenCalledWith(
				"10-test",
				expect.objectContaining({
					name: "Footer",
					double_opt_in: true,
					list_ids: ["list-1"],
					fields: [{ key: "name", required: false }],
				}),
			),
		);
		expect(await screen.findByDisplayValue(/embed\.js/)).toBeVisible();
	});

	it("renders the new Audience sections in French", async () => {
		window.history.replaceState(null, "", "/communication/audience?tab=fields");
		render(french(<CommunicationWorkspace initialTab="contacts" />));
		expect(await screen.findByRole("tab", { name: "Champs et étiquettes" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		expect(screen.getByRole("tab", { name: "Formulaires" })).toBeInTheDocument();
		expect(await screen.findByText("Champs des contacts")).toBeVisible();
	});
});

describe("CSV mapping helpers", () => {
	it("detects separators, guesses columns and builds import rows", () => {
		const table = parseCsvTable(
			"Email;Full name;Langue;Tags;Consent;Company\nA@x.test;A;fr;vip|beta;yes;Acme",
		);
		expect(table.headers).toEqual(["Email", "Full name", "Langue", "Tags", "Consent", "Company"]);
		const mapping = guessColumnMapping(table.headers, ["company"]);
		expect(mapping).toEqual(["email", "name", "locale", "tags", "consent", "field:company"]);
		expect(mapCsvRows(table.rows, mapping)).toEqual([
			{
				line: 2,
				email: "A@x.test",
				name: "A",
				locale: "fr",
				tags: "vip|beta",
				consent: "yes",
				attributes: { company: "Acme" },
			},
		]);
		expect(() => parseCsvTable(`email\n${"a@x.test\n".repeat(3)}`, 2)).toThrow("CSV_TOO_MANY_ROWS");
	});
});
