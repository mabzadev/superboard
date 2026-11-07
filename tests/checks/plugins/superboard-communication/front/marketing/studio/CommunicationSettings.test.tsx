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
if (!("PointerEvent" in window))
	Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });

const autosaved = { timeout: 3000 };
const projectSelection = vi.hoisted(() => ({ project: { id: "10-test", name: "Test" } }));

const email = vi.hoisted(() => ({
	getSmtpSettings: vi.fn(),
	saveSmtpSettings: vi.fn(),
	deleteSmtpSettings: vi.fn(),
	getSenderAuthentication: vi.fn(),
	saveSenderAuthentication: vi.fn(),
	verifySmtpDomain: vi.fn(),
}));
vi.mock(
	"../../../../../../../packages/plugins/superboard-communication/src/front/email/api/email/emailService.js",
	() => email,
);
const studio = vi.hoisted(() => ({
	getStudioSettings: vi.fn(),
	saveStudioSettings: vi.fn(),
}));
vi.mock(
	"../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/service.js",
	() => studio,
);
const growth = vi.hoisted(() => ({
	getBrandKit: vi.fn(),
	saveBrandKit: vi.fn(),
	getGrowthSettings: vi.fn(),
	saveGrowthSettings: vi.fn(),
}));
vi.mock(
	"../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/growth-service.js",
	() => growth,
);
vi.mock(
	"../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({ useProjectSelection: () => ({ selectedProject: projectSelection.project }) }),
);
vi.mock("../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js", () => ({
	showErrorNotification: vi.fn(),
	showSuccessNotification: vi.fn(),
}));

import { EmailAdministration } from "../../../../../../../packages/plugins/superboard-communication/src/front/email/components/modules/EmailAdministration.js";
import { BrandKitSettings } from "../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/BrandKitSettings.js";
import {
	LanguageSettings,
	TranslationProviderSettings,
} from "../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/LanguageSettings.js";

const studioSettings = {
	locales: ["en", "fr"],
	fallback_locale: "en",
	marketing_frequency_hours: 0,
	glossary: [],
	ai_provider: null,
};

const senders = [
	{
		id: "verified",
		name: "Primary",
		dkim_selector: "legacy",
		from_email: "hello@example.com",
		host: "smtp.example.com",
		port: 587,
		configured: true,
		enabled: true,
		authentication_status: "verified",
	},
	{
		id: "unverified",
		name: "Newsletter",
		from_email: "news@example.com",
		host: "smtp.example.com",
		port: 587,
		configured: true,
		enabled: true,
		authentication_status: "unverified",
	},
	{
		id: "disabled",
		name: "Backup",
		from_email: "backup@example.com",
		host: "smtp.example.com",
		port: 587,
		configured: true,
		enabled: false,
		authentication_status: "verified",
	},
];

function wait(milliseconds: number) {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

describe("Communication sender settings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		email.getSmtpSettings.mockResolvedValue({
			configured: true,
			provider: "smtp",
			profiles: senders,
		});
		email.saveSmtpSettings.mockResolvedValue({});
		email.deleteSmtpSettings.mockResolvedValue({ deleted: true });
		email.getSenderAuthentication.mockResolvedValue({
			profile_id: "verified",
			domain: "example.com",
			provider: "smtp",
			aws_region: null,
			config: {},
			records: [],
			status: "verified",
			checked_at: null,
			report: null,
		});
	});

	it("shows whether each sender is enabled, off or still to complete", async () => {
		render(<EmailAdministration section="delivery" />);

		expect(await screen.findByRole("button", { name: /Primary/u })).toHaveTextContent("Enabled");
		expect(screen.getByRole("button", { name: /Newsletter/u })).toHaveTextContent("To complete");
		expect(screen.getByRole("button", { name: /Backup/u })).toHaveTextContent("Off");
	});

	it("saves an edited sender automatically, keeping its encrypted password", async () => {
		render(<EmailAdministration section="delivery" />);
		fireEvent.click(await screen.findByRole("button", { name: /Primary/u }));
		fireEvent.change(await screen.findByLabelText("From name"), { target: { value: "Acme" } });
		expect(await screen.findAllByLabelText(/DKIM selector/u)).toHaveLength(1);
		expect(screen.getByLabelText("DKIM selector")).toBeInTheDocument();

		expect(screen.queryByRole("button", { name: /Save/u })).not.toBeInTheDocument();
		await waitFor(
			() =>
				expect(email.saveSmtpSettings).toHaveBeenCalledWith(
					"10-test",
					expect.objectContaining({ id: "verified", from_name: "Acme", password: undefined }),
				),
			autosaved,
		);
		expect(email.saveSmtpSettings).toHaveBeenCalledTimes(1);
		expect(email.saveSmtpSettings.mock.calls[0]?.[1]).not.toHaveProperty("dkim_selector");
	});

	it("creates a sender only when its explicit button is pressed", async () => {
		email.getSmtpSettings.mockResolvedValue({ configured: false, provider: "smtp", profiles: [] });
		render(<EmailAdministration section="delivery" />);
		expect(screen.queryByLabelText("SMTP host")).not.toBeInTheDocument();
		fireEvent.click(await screen.findByRole("button", { name: "Add a sender" }));
		fireEvent.change(screen.getByLabelText("From email"), {
			target: { value: "hello@example.com" },
		});
		fireEvent.change(screen.getByLabelText("SMTP host"), {
			target: { value: "smtp.example.com" },
		});
		fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
		await wait(800);
		expect(email.saveSmtpSettings).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Add sender" }));
		await waitFor(() =>
			expect(email.saveSmtpSettings).toHaveBeenCalledWith(
				"10-test",
				expect.objectContaining({
					from_email: "hello@example.com",
					host: "smtp.example.com",
					password: "secret",
					enabled: true,
				}),
			),
		);
	});

	it("deletes a sender only after confirmation", async () => {
		render(<EmailAdministration section="delivery" />);
		fireEvent.click(await screen.findByRole("button", { name: /Primary/u }));
		fireEvent.click(await screen.findByRole("button", { name: "Delete Primary" }));
		expect(email.deleteSmtpSettings).not.toHaveBeenCalled();

		fireEvent.click(
			within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }),
		);
		await waitFor(() =>
			expect(email.deleteSmtpSettings).toHaveBeenCalledWith("10-test", "verified"),
		);
	});
});

describe("Communication sending preferences", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		studio.getStudioSettings.mockResolvedValue(studioSettings);
		studio.saveStudioSettings.mockImplementation(async (_project: string, value: object) => value);
	});

	it("keeps the marketing frequency hidden until the limit is on, then saves it", async () => {
		render(<LanguageSettings project="10-test" />);
		const limit = await screen.findByRole("switch", { name: "Limit marketing emails per contact" });
		expect(
			screen.queryByLabelText("Minimum time between two marketing emails"),
		).not.toBeInTheDocument();

		fireEvent.click(limit);

		expect(screen.getByLabelText("Minimum time between two marketing emails")).toHaveValue("1");
		expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
		await waitFor(
			() =>
				expect(studio.saveStudioSettings).toHaveBeenCalledWith(
					"10-test",
					expect.objectContaining({ marketing_frequency_hours: 24 }),
				),
			autosaved,
		);
		expect(studio.saveStudioSettings.mock.calls[0]?.[1]).not.toHaveProperty("ai_provider");
	});

	it("keeps the translation provider hidden until AI translation is on", async () => {
		render(<TranslationProviderSettings project="10-test" />);
		const toggle = await screen.findByRole("switch", { name: "Translate with AI" });
		expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();
		expect(screen.getByText("Off")).toBeInTheDocument();

		fireEvent.click(toggle);
		expect(screen.getByText("To complete")).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("Responses API endpoint"), {
			target: { value: "https://api.example.com/v1/responses" },
		});
		fireEvent.change(screen.getByLabelText("Model"), { target: { value: "translator" } });
		await wait(800);
		expect(studio.saveStudioSettings).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText("API key"), { target: { value: "key-123" } });
		await waitFor(
			() =>
				expect(studio.saveStudioSettings).toHaveBeenCalledWith(
					"10-test",
					expect.objectContaining({
						ai_provider: {
							url: "https://api.example.com/v1/responses",
							model: "translator",
							api_key: "key-123",
						},
					}),
				),
			autosaved,
		);
	});

	it("saves the brand kit as it is edited", async () => {
		growth.getBrandKit.mockResolvedValue({
			company_name: null,
			logo_url: null,
			colors: { background: "#ffffff", surface: "#ffffff", text: "#111111", accent: "#2255ff" },
			font: "Arial, sans-serif",
			footer_text: null,
			company_address: null,
			social_links: [],
		});
		growth.saveBrandKit.mockResolvedValue({});
		render(<BrandKitSettings project="10-test" />);
		fireEvent.change(await screen.findByLabelText("Company name"), { target: { value: "Acme" } });

		expect(screen.queryByRole("button", { name: "Save brand kit" })).not.toBeInTheDocument();
		await waitFor(
			() =>
				expect(growth.saveBrandKit).toHaveBeenCalledWith(
					"10-test",
					expect.objectContaining({ company_name: "Acme" }),
				),
			autosaved,
		);
	});

	it("names the sending preferences in French", async () => {
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
				<LanguageSettings project="10-test" />
			</FrontContextProvider>,
		);
		expect(
			await screen.findByRole("switch", { name: "Limiter les e-mails marketing par contact" }),
		).toBeInTheDocument();
		expect(screen.getByText("Fréquence des e-mails marketing")).toBeInTheDocument();
	});
});
