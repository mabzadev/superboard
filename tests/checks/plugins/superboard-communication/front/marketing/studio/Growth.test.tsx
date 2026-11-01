import { createEmailDesign } from "@superboard/contracts/email-studio";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	fireEvent,
	render,
	screen,
	waitFor,
} from "../../../../../packages/supbrd-front-ui/render.js";

globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
// Base UI checkboxes dispatch pointer events; jsdom has no PointerEvent.
globalThis.PointerEvent ??= class extends MouseEvent {} as typeof PointerEvent;

const growth = vi.hoisted(() => ({
	getAbTests: vi.fn(),
	getAbTest: vi.fn(),
	saveAbTest: vi.fn(),
	deleteAbTest: vi.fn(),
	scheduleInRecipientTimeZones: vi.fn(),
	getNativeTriggers: vi.fn(),
	getEmailInsights: vi.fn(),
	getBrandKit: vi.fn(),
}));
vi.mock(
	"../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/growth-service.js",
	() => growth,
);
const studio = vi.hoisted(() => ({
	getStudioSenders: vi.fn(),
	getCampaignPreflight: vi.fn(),
}));
vi.mock(
	"../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/service.js",
	() => studio,
);
const marketing = vi.hoisted(() => ({
	getEmailCampaigns: vi.fn(),
	getSubscriberLists: vi.fn(),
	getSubscriberSegments: vi.fn(),
	updateEmailCampaign: vi.fn(),
	createEmailCampaign: vi.fn(),
	scheduleEmailCampaign: vi.fn(),
	testEmailCampaign: vi.fn(),
	transitionEmailCampaign: vi.fn(),
}));
vi.mock(
	"../../../../../../../packages/plugins/superboard-communication/src/front/marketing/api/marketing/marketingService.js",
	() => marketing,
);

import { applyBrandKit } from "../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/brand.js";
import { EmailCampaigns } from "../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/EmailCampaigns.js";
import { EmailInsights } from "../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/EmailInsights.js";
import { growthTranslator } from "../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/growth-i18n.js";
import { TriggerPicker } from "../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/TriggerPicker.js";

const brand = {
	company_name: "Acme",
	logo_url: "https://cdn.example.com/logo.png",
	colors: { background: "#000000", surface: "#111111", text: "#eeeeee", accent: "#ff5500" },
	font: "Georgia, serif",
	footer_text: null,
	company_address: "1 Main Street",
	social_links: [{ network: "instagram", url: "https://instagram.com/acme" }],
};

const campaign = {
	id: "campaign-1",
	name: "Spring sale",
	subject: "Spring is here",
	status: "draft",
	template_id: "template-1",
	list_ids: [],
};
const templates = [
	{ id: "template-1", name: "Spring sale", template_type: "campaign", subject: "Spring is here" },
];

describe("brand kit defaults", () => {
	it("applies theme, logo header and footer before the unsubscribe divider once", () => {
		const design = applyBrandKit(createEmailDesign("en", "campaign"), brand);
		expect(design.theme).toMatchObject({ accent: "#ff5500", font: "Georgia, serif", width: 600 });
		const ids = design.locales.en!.blocks.map((block) => block.id);
		expect(ids[0]).toBe("brand-logo");
		expect(ids.indexOf("brand-footer")).toBeLessThan(ids.indexOf("footer-divider"));
		expect(ids).toContain("brand-social-instagram");
		const again = applyBrandKit(design, brand);
		expect(again.locales.en!.blocks).toHaveLength(design.locales.en!.blocks.length);
	});

	it("translates growth copy with values and falls back to the Studio catalog", () => {
		const fallback = (key: string) => `studio:${key}`;
		expect(growthTranslator("fr", fallback)("Subject {variant}", { variant: "B" })).toBe("Sujet B");
		expect(growthTranslator("en", fallback)("Subject {variant}", { variant: "B" })).toBe(
			"Subject B",
		);
		expect(growthTranslator("fr", fallback)("Unknown copy")).toBe("studio:Unknown copy");
	});
});

describe("campaign A/B tests and local-time sending", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		marketing.getEmailCampaigns.mockResolvedValue([campaign]);
		marketing.getSubscriberLists.mockResolvedValue([]);
		marketing.getSubscriberSegments.mockResolvedValue([]);
		marketing.updateEmailCampaign.mockResolvedValue(campaign);
		studio.getStudioSenders.mockResolvedValue([{ id: "sender-1", name: "Primary" }]);
		studio.getCampaignPreflight.mockResolvedValue({
			eligible: 3,
			excluded: 0,
			languages: [],
			issues: [],
		});
		growth.getAbTests.mockResolvedValue([]);
		growth.saveAbTest.mockResolvedValue({});
		growth.scheduleInRecipientTimeZones.mockResolvedValue({});
	});

	it("saves an optional A/B test with the campaign subject as variant A", async () => {
		render(<EmailCampaigns project="10-test" templateId="template-1" templates={templates} />);
		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		expect(screen.queryByLabelText("Subject B")).toBeNull();
		fireEvent.click(screen.getByRole("checkbox", { name: "A/B test" }));
		fireEvent.change(await screen.findByLabelText("Subject B"), {
			target: { value: "Last days of spring" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save and review" }));
		await waitFor(() =>
			expect(growth.saveAbTest).toHaveBeenCalledWith("10-test", "campaign-1", {
				variants: [
					{ subject: "Spring is here", template_id: null },
					{ subject: "Last days of spring", template_id: null },
				],
				test_percent: 20,
				winner_metric: "open_rate",
				test_duration_minutes: 240,
			}),
		);
		await screen.findByText("Review delivery");
		expect(
			screen.queryByRole("checkbox", {
				name: "Send at this local time in each contact's time zone",
			}),
		).toBeNull();
	});

	it("schedules at one local time in each contact's time zone", async () => {
		render(<EmailCampaigns project="10-test" templateId="template-1" templates={templates} />);
		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		fireEvent.click(screen.getByRole("button", { name: "Save and review" }));
		fireEvent.click(
			await screen.findByRole("checkbox", {
				name: "Send at this local time in each contact's time zone",
			}),
		);
		fireEvent.change(screen.getByLabelText("Local send time"), {
			target: { value: "2026-12-01T09:00" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Schedule campaign" }));
		await waitFor(() =>
			expect(growth.scheduleInRecipientTimeZones).toHaveBeenCalledWith(
				"10-test",
				"campaign-1",
				"2026-12-01T09:00",
			),
		);
		expect(marketing.scheduleEmailCampaign).not.toHaveBeenCalled();
		expect(growth.saveAbTest).not.toHaveBeenCalled();
	});

	it("shows the A/B status of a campaign in the list", async () => {
		growth.getAbTests.mockResolvedValue([
			{
				campaign_id: "campaign-1",
				variants: [],
				status: "completed",
				winner_variant_id: "b",
				winner_metric: "open_rate",
				test_percent: 20,
				test_duration_minutes: 240,
				test_ends_at: null,
			},
		]);
		render(<EmailCampaigns project="10-test" templateId="template-1" templates={templates} />);
		expect(await screen.findByText(/Winner: B/u)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "A/B results" })).toBeInTheDocument();
	});
});

describe("analytics and triggers", () => {
	it("shows deliverability rates, attributed revenue and per-link clicks", async () => {
		growth.getEmailInsights.mockResolvedValue({
			engagement: {
				open_rate: 42.5,
				click_rate: 10,
				unsubscribe_rate: 0.5,
				bounce_rate: 1.25,
				complaint_rate: 0,
			},
			links: [
				{ url: "https://example.com/pricing", unique_clicks: 4, total_clicks: 7, click_rate: 10 },
			],
			revenue: [
				{
					source_type: "campaign",
					source_id: "c",
					name: "Spring",
					currency: "EUR",
					conversions: 2,
					revenue_cents: 4999,
				},
			],
		});
		render(<EmailInsights project="10-test" filters={{ template_id: "template-1" }} />);
		expect(await screen.findByText("https://example.com/pricing")).toBeInTheDocument();
		expect(screen.getByText("Unsubscribe rate")).toBeInTheDocument();
		expect(screen.getByText("1.25%")).toBeInTheDocument();
		expect(screen.getByText("€49.99")).toBeInTheDocument();
		expect(growth.getEmailInsights).toHaveBeenCalledWith("10-test", { template_id: "template-1" });
	});

	it("shows date settings for date-based automation triggers", async () => {
		growth.getNativeTriggers.mockResolvedValue([
			{
				key: "purchase_completed",
				event_name: "native:purchase_completed",
				group: "purchases",
				label: "Purchase completed",
			},
			{
				key: "date_attribute",
				event_name: "native:date_attribute",
				group: "dates",
				label: "Date or anniversary",
			},
		]);
		const onChange = vi.fn();
		render(
			<TriggerPicker
				project="10-test"
				value={{
					event_name: "native:date_attribute",
					conditions: [],
					date: { attribute: "birthday", anniversary: true, offset_days: 0, hour: 9 },
				}}
				onChange={onChange}
			/>,
		);
		await waitFor(() => expect(growth.getNativeTriggers).toHaveBeenCalledWith("10-test"));
		fireEvent.change(screen.getByLabelText("Days before the date"), { target: { value: "3" } });
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				date: expect.objectContaining({ offset_days: 3, attribute: "birthday" }),
			}),
		);
		expect(screen.getByRole("checkbox", { name: "Every year (anniversary)" })).toBeInTheDocument();
	});
});
