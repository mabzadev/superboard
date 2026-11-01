import { describe, expect, it } from "vitest";

import { pickWinner } from "../../../../../../packages/plugins/superboard-communication/marketing/src/ab-tests";
import { validateBrandKit } from "../../../../../../packages/plugins/superboard-communication/marketing/src/brand-kit";
import { deliverabilityRates } from "../../../../../../packages/plugins/superboard-communication/marketing/src/link-analytics";
import {
	eventKeyMatches,
	nativeTriggerKeys,
	validateEventKey,
	validateNativeTriggerSettings,
} from "../../../../../../packages/plugins/superboard-communication/marketing/src/native-triggers";
import { signalRevenue } from "../../../../../../packages/plugins/superboard-communication/marketing/src/revenue-attribution";

describe("native automation triggers", () => {
	it("maps billing, acquisition and audience events onto native triggers", () => {
		expect(
			nativeTriggerKeys({
				event_name: "superboard.analytics.purchase.verified.v1",
				properties: { event_type: "renewal" },
			}),
		).toEqual(["native:subscription_renewed"]);
		expect(nativeTriggerKeys({ event_name: "customer.purchase", properties: {} })).toEqual([
			"native:purchase_completed",
		]);
		expect(
			nativeTriggerKeys({
				event_name: "superboard.analytics.installation.created.v1",
				properties: { install_type: "attributed" },
			}),
		).toEqual(["native:app_installed_from_link", "native:app_installed"]);
		expect(nativeTriggerKeys({ event_name: "marketing.tag.added", properties: {} })).toEqual([
			"native:tag_added",
		]);
		expect(eventKeyMatches("open", { event_name: "open", properties: {} })).toBe(true);
		expect(
			eventKeyMatches("native:dynamic_link_opened", {
				event_name: "customer.open",
				properties: {},
			}),
		).toBe(true);
	});

	it("rejects unknown native triggers and validates date settings", () => {
		expect(() => validateEventKey("native:paywall_viewed", "event_name")).toThrow();
		expect(() => validateEventKey("native:date_attribute", "event_name")).toThrow();
		expect(validateEventKey("account.created", "event_name")).toBe("account.created");
		expect(
			validateNativeTriggerSettings("native:date_attribute", { date: { attribute: "birthday" } }),
		).toEqual({ date: { attribute: "birthday", anniversary: true, offset_days: 0, hour: 9 } });
		expect(() =>
			validateNativeTriggerSettings("native:date_attribute", { date: { attribute: "bad field" } }),
		).toThrow();
	});
});

describe("revenue attribution", () => {
	it("reads revenue from customer and verified purchase events, never from refunds", () => {
		expect(
			signalRevenue({
				event_name: "customer.purchase",
				properties: { reported_revenue_cents: 1299, metadata: { currency: "usd" } },
			}),
		).toEqual({ cents: 1299, currency: "USD" });
		expect(
			signalRevenue({
				event_name: "superboard.analytics.purchase.verified.v1",
				properties: { event_type: "initial_purchase", amount_micros: 9_990_000, currency: "EUR" },
			}),
		).toEqual({ cents: 999, currency: "EUR" });
		expect(
			signalRevenue({
				event_name: "superboard.analytics.purchase.verified.v1",
				properties: { event_type: "refund", amount_micros: 9_990_000 },
			}),
		).toBeNull();
		expect(
			signalRevenue({ event_name: "customer.refund", properties: { reported_revenue_cents: 5 } }),
		).toBeNull();
		expect(signalRevenue({ event_name: "app_open", properties: {} })).toBeNull();
	});
});

describe("A/B winner and deliverability rates", () => {
	it("keeps the first variant on ties and picks the best metric otherwise", () => {
		const variants = [
			{ id: "a", subject: "A", template_id: null },
			{ id: "b", subject: "B", template_id: null },
		];
		const result = (id: string, open_rate: number, click_rate: number) => ({
			variant_id: id,
			recipients: 10,
			sent: 10,
			opens: 0,
			clicks: 0,
			open_rate,
			click_rate,
		});
		expect(pickWinner(variants, [result("a", 20, 5), result("b", 20, 1)], "open_rate")).toBe("a");
		expect(pickWinner(variants, [result("a", 20, 5), result("b", 10, 9)], "click_rate")).toBe("b");
	});

	it("computes bounce, unsubscribe and complaint rates", () => {
		expect(
			deliverabilityRates({
				sent: 200,
				delivered: 190,
				hard_bounce: 6,
				soft_bounce: 4,
				unsubscribe: 19,
				complaint: 1,
			}),
		).toEqual({ bounces: 10, bounce_rate: 5, unsubscribe_rate: 10, complaint_rate: 0.53 });
	});
});

describe("brand kit validation", () => {
	it("fills defaults and rejects unsafe values", () => {
		expect(validateBrandKit({})).toMatchObject({ font: "Arial, sans-serif", social_links: [] });
		expect(() =>
			validateBrandKit({ social_links: [{ network: "myspace", url: "https://x.example" }] }),
		).toThrow();
		expect(() => validateBrandKit({ font: "<script>" })).toThrow();
	});
});
