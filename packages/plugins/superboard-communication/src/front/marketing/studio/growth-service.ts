import { config } from "@superboard/front-ui/lib/config.js";

import { DELETE, GET, POST, PUT } from "../transport.js";

const path = (project: string, resource: string) =>
	`${config.apiPath}/marketing/projects/${encodeURIComponent(project)}${resource}`;
const unwrap = <T>(response: { data: { data: T } }) => response.data.data;

export type BrandSocialLink = { network: string; url: string };
export type BrandKit = {
	company_name: string | null;
	logo_url: string | null;
	colors: { background: string; surface: string; text: string; accent: string };
	font: string;
	footer_text: string | null;
	company_address: string | null;
	social_links: BrandSocialLink[];
};
export type GrowthSettings = { attribution_window_days: number; default_time_zone: string };
export type EmailEngagement = {
	sent: number;
	delivered: number;
	unique_opens: number;
	unique_clicks: number;
	unsubscribes: number;
	bounces: number;
	complaints: number;
	open_rate: number;
	click_rate: number;
	click_to_open_rate: number;
	unsubscribe_rate: number;
	bounce_rate: number;
	complaint_rate: number;
};
export type LinkReportRow = {
	url: string;
	unique_clicks: number;
	total_clicks: number;
	click_rate: number;
};
export type RevenueRow = {
	source_type: "campaign" | "journey";
	source_id: string;
	name: string | null;
	currency: string | null;
	conversions: number;
	revenue_cents: number;
};
export type EmailInsightsData = {
	engagement: EmailEngagement;
	links: LinkReportRow[];
	revenue: RevenueRow[];
};
export type InsightFilters = {
	campaign_id?: string;
	template_id?: string;
	from?: string;
	to?: string;
};
export type AbVariant = { id: string; subject: string; template_id: string | null };
export type AbTestInput = {
	variants: Array<{ subject: string; template_id?: string | null }>;
	test_percent: number;
	winner_metric: "open_rate" | "click_rate";
	test_duration_minutes: number;
};
export type AbVariantResult = {
	variant_id: string;
	recipients: number;
	sent: number;
	opens: number;
	clicks: number;
	open_rate: number;
	click_rate: number;
};
export type AbTest = Omit<AbTestInput, "variants"> & {
	campaign_id: string;
	variants: AbVariant[];
	status: "pending" | "testing" | "winner_selected" | "completed";
	winner_variant_id: string | null;
	test_ends_at: string | null;
	results: AbVariantResult[];
};
export type NativeTrigger = {
	key: string;
	event_name: string;
	group: "purchases" | "subscriptions" | "acquisition" | "audience" | "dates";
	label: string;
};

const query = (filters: Record<string, string | undefined>) =>
	new URLSearchParams(
		Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
	).toString();

export async function getBrandKit(project: string) {
	return unwrap<BrandKit>(await GET(path(project, "/brand-kit")));
}
export async function saveBrandKit(project: string, brand: BrandKit) {
	return unwrap<BrandKit>(await PUT(path(project, "/brand-kit"), brand));
}
export async function getGrowthSettings(project: string) {
	return unwrap<GrowthSettings>(await GET(path(project, "/growth-settings")));
}
export async function saveGrowthSettings(project: string, settings: GrowthSettings) {
	return unwrap<GrowthSettings>(await PUT(path(project, "/growth-settings"), settings));
}
export async function getEmailInsights(project: string, filters: InsightFilters) {
	return unwrap<EmailInsightsData>(
		await GET(`${path(project, "/insights/email")}?${query(filters)}`),
	);
}
export async function getAbTests(project: string) {
	return unwrap<Array<Omit<AbTest, "results">>>(await GET(path(project, "/ab-tests")));
}
export async function getAbTest(project: string, campaignId: string) {
	return unwrap<AbTest | null>(
		await GET(path(project, `/campaigns/${encodeURIComponent(campaignId)}/ab-test`)),
	);
}
export async function saveAbTest(project: string, campaignId: string, input: AbTestInput) {
	return unwrap<AbTest>(
		await PUT(path(project, `/campaigns/${encodeURIComponent(campaignId)}/ab-test`), input),
	);
}
export async function deleteAbTest(project: string, campaignId: string) {
	return unwrap<{ deleted: boolean }>(
		await DELETE(path(project, `/campaigns/${encodeURIComponent(campaignId)}/ab-test`)),
	);
}
export async function scheduleInRecipientTimeZones(
	project: string,
	campaignId: string,
	localSendAt: string,
) {
	return unwrap<{ first_send_at: string; fallback_time_zone: string }>(
		await POST(path(project, `/campaigns/${encodeURIComponent(campaignId)}/local-schedule`), {
			local_send_at: localSendAt,
		}),
	);
}

let triggerCatalog: { project: string; request: Promise<NativeTrigger[]> } | null = null;
/** Native automation triggers; read once per project and shared by every picker. */
export function getNativeTriggers(project: string) {
	if (triggerCatalog?.project !== project) {
		const request = GET(path(project, "/journey-triggers")).then(
			(response) => unwrap<{ triggers: NativeTrigger[] }>(response).triggers,
		);
		request.catch(() => {
			if (triggerCatalog?.request === request) triggerCatalog = null;
		});
		triggerCatalog = { project, request };
	}
	return triggerCatalog.request;
}
