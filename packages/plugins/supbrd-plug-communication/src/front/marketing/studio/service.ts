import type {
	EmailBlock,
	EmailDesign,
	EmailRenderContext,
	EmailTranslation,
} from "@superboard/contracts/email-studio";

import { config } from "../../../../../../supbrd-front-ui/src/shared/lib/config.js";
import { getSmtpSettings as getOwnedSmtpSettings } from "../../email/api/email/emailService.js";
export async function getStudioSenders(project: string) {
	const value = await getOwnedSmtpSettings(project);
	return value.profiles ?? (value.id ? [value] : []);
}
import { GET, POST, PUT } from "../transport.js";

const path = (project: string, resource: string) =>
	`${config.apiPath}/marketing/projects/${encodeURIComponent(project)}/studio${resource}`;
const unwrap = <T>(response: { data: { data: T } }) => response.data.data;
export type EmailVersion = { revision: number; document: EmailDesign; created_at: string };
export type SharedEmailBlock = { id: string; revision: number; document: EmailDesign };
export async function getSharedEmailBlocks(project: string) {
	return unwrap<SharedEmailBlock[]>(await GET(path(project, "/blocks")));
}
export async function createSharedEmailBlock(
	project: string,
	name: string,
	locale: string,
	block: EmailBlock,
) {
	return unwrap<SharedEmailBlock>(await POST(path(project, "/blocks"), { name, locale, block }));
}
export async function updateSharedEmailBlock(project: string, block: SharedEmailBlock) {
	return unwrap<SharedEmailBlock>(
		await PUT(path(project, "/blocks/" + encodeURIComponent(block.id)), {
			document: block.document,
			expected_revision: block.revision,
		}),
	);
}
export async function getSharedEmailBlockUsage(project: string, id: string) {
	return unwrap<Array<{ id: string; name: string }>>(
		await GET(path(project, "/blocks/" + encodeURIComponent(id) + "/usage")),
	);
}
export async function applySharedEmailBlock(project: string, id: string, templateIds: string[]) {
	return unwrap<{ updated: string[]; conflicts: string[] }>(
		await POST(path(project, "/blocks/" + encodeURIComponent(id) + "/apply"), {
			template_ids: templateIds,
		}),
	);
}
export type StudioSettings = {
	locales: string[];
	fallback_locale: string;
	marketing_frequency_hours: number;
	glossary: string[];
	ai_provider?: { url: string; model: string; configured?: boolean; api_key?: string } | null;
};
export async function translateStudioEmail(
	project: string,
	id: string,
	locale: string,
	revision: number,
) {
	return unwrap<{ locale: string; translation: EmailTranslation; source_revision: number }>(
		await POST(path(project, "/templates/" + encodeURIComponent(id) + "/translate"), {
			locale,
			expected_revision: revision,
		}),
	);
}
export type StudioDelivery = {
	delivery_id: string;
	recipient_email: string;
	purpose: string;
	locale: string;
	requested_locale: string;
	reason: string;
	subject: string;
	content_html: string;
	status: string;
	last_error: string | null;
	created_at: string;
};
export type CampaignPreflight = {
	eligible: number;
	excluded: number;
	languages: Array<{ locale: string; count: number; fallback: number }>;
	issues: string[];
};
export async function getCampaignPreflight(project: string, id: string) {
	return unwrap<CampaignPreflight>(
		await GET(path(project, `/campaigns/${encodeURIComponent(id)}/preflight`)),
	);
}
export async function getEmailVersions(project: string, id: string) {
	return unwrap<EmailVersion[]>(
		await GET(path(project, `/templates/${encodeURIComponent(id)}/history`)),
	);
}
export async function getStudioSettings(project: string) {
	return unwrap<StudioSettings>(await GET(path(project, "/settings")));
}
export async function saveStudioSettings(project: string, settings: StudioSettings) {
	return unwrap<StudioSettings>(await PUT(path(project, "/settings"), settings));
}
export async function getStudioDeliveries(project: string, filters: Record<string, string>) {
	return unwrap<{ items: StudioDelivery[]; nextCursor?: string }>(
		await GET(`${path(project, "/deliveries")}?${new URLSearchParams(filters)}`),
	);
}
export async function testStudioEmail(
	project: string,
	id: string,
	recipient: string,
	locale: string,
	context: EmailRenderContext,
) {
	return unwrap<{ status: string }>(
		await POST(path(project, `/templates/${encodeURIComponent(id)}/test`), {
			recipient,
			locale,
			context,
		}),
	);
}

export async function getStudioDelivery(project: string, id: string) {
	return unwrap<
		StudioDelivery & {
			render_available: boolean;
			content_text?: string;
			attempts: Array<{
				attempt_number: number;
				success: number;
				error_message: string | null;
				created_at: string;
			}>;
		}
	>(await GET(path(project, "/deliveries/" + encodeURIComponent(id))));
}

export type StudioStatistics = {
	totals: Record<string, number>;
	groups: Array<Record<string, string | number>>;
};
export async function getStudioStatistics(project: string, filters: Record<string, string>) {
	return unwrap<StudioStatistics>(
		await GET(path(project, "/statistics") + "?" + new URLSearchParams(filters)),
	);
}

export async function publishStudioTemplate(project: string, id: string, revision: number) {
	return unwrap<{ published_revision: number }>(
		await POST(path(project, "/templates/" + encodeURIComponent(id) + "/publish"), {
			expected_revision: revision,
		}),
	);
}

export async function getPublishedStudioTemplate(project: string, id: string) {
	return unwrap<{ revision: number; document: EmailDesign } | null>(
		await GET(path(project, "/templates/" + encodeURIComponent(id) + "/published")),
	);
}
