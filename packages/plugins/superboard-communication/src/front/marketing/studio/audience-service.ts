import { config } from "@superboard/front-ui/lib/config.js";

import type { EmailSubscriber } from "../api/marketing/marketingService.js";
import { DELETE, GET, PATCH, POST, PUT } from "../transport.js";

const path = (project: string, resource: string) =>
	`${config.apiPath}/marketing/projects/${encodeURIComponent(project)}${resource}`;
const unwrap = <T>(response: { data: T | { data: T } }): T =>
	response.data && typeof response.data === "object" && "data" in response.data
		? response.data.data
		: response.data;

export type AudienceContact = EmailSubscriber & { tag_ids?: string[] };
export type AudienceTag = {
	id: string;
	name: string;
	color?: string | null;
	subscriber_count?: number;
};
export type FieldType = "text" | "number" | "date" | "boolean" | "select";
export type AudienceField = {
	id: string;
	key: string;
	label: string;
	field_type: FieldType;
	options: string[];
	position: number;
};
export type ImportRow = {
	line: number;
	email: string;
	name?: string;
	locale?: string;
	tags?: string;
	consent?: string;
	attributes?: Record<string, string>;
};
export type ImportConsent = "confirmed" | "column" | "double_opt_in";
export type ImportResult = {
	received: number;
	processed: number;
	created: number;
	updated: number;
	unchanged: number;
	skipped: number;
	skipped_by_reason: Record<string, number>;
	skipped_rows: Array<{ line: number; email: string; reason: string; detail?: string }>;
	confirmation_sent: number;
};
export type DoubleOptInCopy = {
	subject: string;
	heading: string;
	body: string;
	button_label: string;
};
export type DoubleOptInSettings = {
	en: DoubleOptInCopy;
	fr: DoubleOptInCopy;
	customized: boolean;
	defaults: { en: DoubleOptInCopy; fr: DoubleOptInCopy };
};
export type SignupFormSettings = {
	locale: "en" | "fr";
	title: string;
	description: string | null;
	submit_label: string;
	fields: Array<{ key: string; required: boolean }>;
	list_ids: string[];
	double_opt_in: boolean;
	success_message: string | null;
	redirect_url: string | null;
	popup: { enabled: boolean; delay_seconds: number };
};
export type SignupForm = {
	id: string;
	name: string;
	status: "active" | "disabled";
	submission_count: number;
	settings: SignupFormSettings;
};
export type SignupFormEmbed = {
	hosted_url: string;
	script_snippet: string;
	html_snippet: string;
};

export async function getContactPage(
	project: string,
	filters: { q: string; offset: number; listId?: string; tagId?: string },
) {
	const parameters = new URLSearchParams({
		q: filters.q,
		offset: String(filters.offset),
		limit: "50",
		list_id: filters.listId ?? "",
		tag_id: filters.tagId ?? "",
	});
	return unwrap<AudienceContact[]>(
		await GET(`${path(project, "/email/subscribers")}?${parameters}`),
	);
}

export async function getAudienceTags(project: string) {
	return unwrap<AudienceTag[]>(await GET(path(project, "/audience/tags")));
}
export async function createAudienceTag(project: string, name: string) {
	return unwrap<AudienceTag>(await POST(path(project, "/audience/tags"), { name }));
}
export async function updateAudienceTag(project: string, id: string, name: string) {
	return unwrap<AudienceTag>(
		await PATCH(path(project, `/audience/tags/${encodeURIComponent(id)}`), { name }),
	);
}
export async function deleteAudienceTag(project: string, id: string) {
	return unwrap<unknown>(await DELETE(path(project, `/audience/tags/${encodeURIComponent(id)}`)));
}
export async function assignAudienceTags(
	project: string,
	payload: {
		subscriber_ids: string[];
		tag_ids?: string[];
		tag_names?: string[];
		action: "add" | "remove";
	},
) {
	return unwrap<{ tag_ids: string[]; subscribers: number }>(
		await POST(path(project, "/audience/tags/assign"), payload),
	);
}

export async function getAudienceFields(project: string) {
	return unwrap<AudienceField[]>(await GET(path(project, "/audience/fields")));
}
export async function createAudienceField(
	project: string,
	payload: Pick<AudienceField, "key" | "label" | "field_type" | "options">,
) {
	return unwrap<AudienceField>(await POST(path(project, "/audience/fields"), payload));
}
export async function updateAudienceField(
	project: string,
	id: string,
	payload: Partial<Pick<AudienceField, "label" | "options" | "position">>,
) {
	return unwrap<AudienceField>(
		await PATCH(path(project, `/audience/fields/${encodeURIComponent(id)}`), payload),
	);
}
export async function deleteAudienceField(project: string, id: string) {
	return unwrap<unknown>(await DELETE(path(project, `/audience/fields/${encodeURIComponent(id)}`)));
}

export async function importAudience(
	project: string,
	payload: {
		rows: ImportRow[];
		consent: ImportConsent;
		consent_confirmed: boolean;
		list_ids: string[];
		update_existing: boolean;
	},
) {
	return unwrap<ImportResult>(await POST(path(project, "/audience/imports"), payload));
}

export async function previewAudienceSegment(project: string, rules: Record<string, unknown>) {
	return unwrap<{ subscriber_count: number }>(
		await POST(path(project, "/audience/segments/preview"), { rules }),
	);
}

export async function getDoubleOptInSettings(project: string) {
	return unwrap<DoubleOptInSettings>(await GET(path(project, "/audience/double-opt-in")));
}
export async function saveDoubleOptInSettings(
	project: string,
	settings: { en: Partial<DoubleOptInCopy>; fr: Partial<DoubleOptInCopy> },
) {
	return unwrap<DoubleOptInSettings>(await PUT(path(project, "/audience/double-opt-in"), settings));
}

export async function getSignupForms(project: string) {
	return unwrap<SignupForm[]>(await GET(path(project, "/audience/forms")));
}
export async function createSignupForm(
	project: string,
	payload: Partial<SignupFormSettings> & { name: string; status?: string },
) {
	return unwrap<SignupForm>(await POST(path(project, "/audience/forms"), payload));
}
export async function updateSignupForm(
	project: string,
	id: string,
	payload: Partial<SignupFormSettings> & { name?: string; status?: string },
) {
	return unwrap<SignupForm>(
		await PATCH(path(project, `/audience/forms/${encodeURIComponent(id)}`), payload),
	);
}
export async function deleteSignupForm(project: string, id: string) {
	return unwrap<unknown>(await DELETE(path(project, `/audience/forms/${encodeURIComponent(id)}`)));
}
export async function getSignupFormEmbed(project: string, id: string) {
	return unwrap<SignupFormEmbed>(
		await GET(path(project, `/audience/forms/${encodeURIComponent(id)}/embed`)),
	);
}
