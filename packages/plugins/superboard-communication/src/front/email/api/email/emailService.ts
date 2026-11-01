import { config } from "@superboard/front-ui/lib/config.js";

import { DELETE, GET, POST, PUT } from "../../transport.js";

const path = (projectRef: string, resource: string) =>
	`${config.apiPath}/email/projects/${projectRef}${resource}`;

const data = <T>(response: { data: T | { data: T } }): T =>
	response.data && typeof response.data === "object" && "data" in response.data
		? (response.data as { data: T }).data
		: (response.data as T);

export type EmailMessageSummary = {
	id: string;
	subject: string;
	kind: string;
	status: string;
	transport: string;
	created_at: string;
	sent_at: string | null;
	last_error: string | null;
	recipients: string;
	recipient_count: number;
};
export type EmailMessageDetail = EmailMessageSummary & {
	html_body: string | null;
	text_body: string | null;
	from_name: string;
	from_address: string;
	deliveries: Array<{
		recipient: string;
		status: string;
		provider_status: string | null;
		attempt_count: number;
		last_error: string | null;
	}>;
	/** "api" for messages sent through POST /v1/email/send. */
	source?: "api" | "admin";
	scheduled_at?: string | null;
	tags?: string[];
	timeline?: Array<{
		type: string;
		recipient: string | null;
		occurred_at: string;
		detail: Record<string, unknown> | null;
	}>;
	attachments?: Array<{
		filename: string;
		content_type: string;
		size_bytes: number;
	}>;
};
export async function getEmailMessages(projectRef: string, filters: Record<string, string> = {}) {
	return data<{ items: EmailMessageSummary[]; nextCursor?: string }>(
		await GET(path(projectRef, "/messages") + "?" + new URLSearchParams(filters)),
	);
}
export async function getEmailMessage(projectRef: string, id: string) {
	return data<EmailMessageDetail>(
		await GET(path(projectRef, "/messages/" + encodeURIComponent(id))),
	);
}

export type SmtpSettings = {
	id?: string;
	name?: string;
	configured: boolean;
	host?: string;
	port?: number;
	security?: string;
	username?: string | null;
	from_email?: string;
	from_name?: string | null;
	reply_to?: string | null;
	priority?: number;
	enabled?: boolean;
	hourly_quota?: number | null;
	daily_quota?: number | null;
	dkim_selector?: string | null;
	authentication_status?: "unverified" | "verified" | "failed";
	spf_status?: DnsRecordStatus | null;
	dkim_status?: DnsRecordStatus | null;
	dmarc_status?: DnsRecordStatus | null;
	authentication_checked_at?: string | null;
	last_tested_at?: string | null;
	last_test_status?: string | null;
	profiles?: SmtpSettings[];
	provider?: "smtp" | "aws-ses";
	aws_region?: string | null;
};

export type ProviderWebhook = {
	id: string;
	provider: string;
	enabled: boolean;
	configured?: boolean;
	created_at?: string;
};

/** Email Worker messages exposed by the delivery outbox endpoint. */
export type DeliveryOutboxItem = {
	id: string;
	subject?: string | null;
	job_type: string;
	status: string;
	last_error?: string | null;
	created_at: string;
};

export type EmailDeadLetter = {
	id: string;
	source_queue: string;
	queue_message_id: string;
	job_type: string | null;
	resource_id: string | null;
	replayable: boolean;
	attempts: number;
	status: "quarantined" | "discarded";
	resolution: "replayed" | "discarded" | null;
	received_at: string;
	resolved_at: string | null;
};

export async function sendTransactionalEmail(projectRef: string, payload: Record<string, unknown>) {
	return data<{ campaign_id: string; delivery_id: string; status: string }>(
		await POST(path(projectRef, "/transactional"), payload),
	);
}

export async function getSmtpSettings(projectRef: string) {
	return data<SmtpSettings>(await GET(path(projectRef, "/settings/smtp")));
}

export async function saveSmtpSettings(projectRef: string, payload: Record<string, unknown>) {
	return data<SmtpSettings>(await PUT(path(projectRef, "/settings/smtp"), payload));
}

export async function deleteSmtpSettings(projectRef: string, id: string) {
	return data(await DELETE(path(projectRef, `/settings/smtp/${id}`)));
}

export async function testSmtpSettings(projectRef: string, profileId?: string, recipient?: string) {
	return data<{ ok: boolean; message?: string }>(
		await POST(path(projectRef, "/settings/smtp/test"), {
			profile_id: profileId,
			recipient,
		}),
	);
}

export async function verifySmtpDomain(projectRef: string, profileId: string) {
	return data<DomainAuthenticationReport>(
		await POST(path(projectRef, `/settings/smtp/${profileId}/verify-domain`), {}),
	);
}

export type DnsRecordStatus = "verified" | "missing" | "mismatch" | "unconfigured";
export type DnsRecord = {
	id: string;
	purpose: "spf" | "dkim" | "dmarc" | "mail_from";
	type: "TXT" | "CNAME" | "MX";
	host: string;
	value: string;
	priority?: number;
	needs?: "spf_include" | "dkim" | "dkim_tokens";
};
export type DnsRecordCheck = DnsRecord & {
	status: DnsRecordStatus;
	found: string[];
	detail: string;
	detail_key?: string;
	detail_params?: Record<string, string>;
	aligned: boolean | null;
};
export type DomainAuthenticationReport = {
	domain: string;
	dkimSelector: string | null;
	records: DnsRecordCheck[];
	spf: DnsRecordStatus;
	dkim: DnsRecordStatus;
	dmarc: DnsRecordStatus;
	alignment: { spf: boolean; dkim: boolean; dmarc_policy: string | null };
	ready: boolean;
	checkedAt: string;
};
export type DomainAuthenticationConfig = {
	spf_include?: string | null;
	dkim_type?: "txt" | "cname" | null;
	dkim_selector?: string | null;
	dkim_value?: string | null;
	dkim_tokens?: string[];
	dmarc_rua?: string | null;
	mail_from_domain?: string | null;
};
export type SenderAuthentication = {
	profile_id: string;
	domain: string;
	provider: "smtp" | "aws-ses";
	aws_region: string | null;
	config: DomainAuthenticationConfig;
	records: DnsRecord[];
	status: string;
	checked_at: string | null;
	report: DomainAuthenticationReport | null;
};

export async function getSenderAuthentication(projectRef: string, profileId: string) {
	return data<SenderAuthentication>(
		await GET(path(projectRef, `/settings/smtp/${encodeURIComponent(profileId)}/authentication`)),
	);
}

export async function saveSenderAuthentication(
	projectRef: string,
	profileId: string,
	config: DomainAuthenticationConfig,
) {
	return data<SenderAuthentication>(
		await PUT(path(projectRef, `/settings/smtp/${encodeURIComponent(profileId)}/authentication`), {
			config,
		}),
	);
}

export type EmailApiKey = {
	id: string;
	name: string;
	prefix: string;
	scopes: string[];
	created_at: string;
	last_used_at: string | null;
	/** Present only in the creation response. */
	secret?: string | null;
};

export async function getEmailApiKeys(projectRef: string) {
	return data<EmailApiKey[]>(await GET(path(projectRef, "/settings/api-keys")));
}

export async function createEmailApiKey(projectRef: string, name: string) {
	return data<EmailApiKey>(await POST(path(projectRef, "/settings/api-keys"), { name }));
}

export async function revokeEmailApiKey(projectRef: string, id: string) {
	return data<unknown>(
		await DELETE(path(projectRef, `/settings/api-keys/${encodeURIComponent(id)}`)),
	);
}

export type EmailEventType =
	| "sent"
	| "delivered"
	| "bounced"
	| "complained"
	| "opened"
	| "clicked"
	| "failed";
export type EmailEventWebhook = {
	id: string;
	url: string;
	description: string | null;
	events: EmailEventType[];
	enabled: boolean;
	secret_prefix: string;
	last_status?: string | null;
	last_delivery_at?: string | null;
	/** Present only in the creation response. */
	secret?: string | null;
};
export type EmailEventWebhookDelivery = {
	id: string;
	event_type: string;
	status: "pending" | "retrying" | "delivered" | "failed";
	attempt_count: number;
	response_status: number | null;
	last_error: string | null;
	created_at: string;
};

export async function getEventWebhooks(projectRef: string) {
	return data<EmailEventWebhook[]>(await GET(path(projectRef, "/settings/event-webhooks")));
}

export async function createEventWebhook(
	projectRef: string,
	payload: { url: string; events: EmailEventType[]; description?: string },
) {
	return data<EmailEventWebhook>(await POST(path(projectRef, "/settings/event-webhooks"), payload));
}

export async function updateEventWebhook(
	projectRef: string,
	id: string,
	payload: Partial<Pick<EmailEventWebhook, "url" | "events" | "enabled" | "description">>,
) {
	return data<EmailEventWebhook>(
		await PUT(path(projectRef, `/settings/event-webhooks/${encodeURIComponent(id)}`), payload),
	);
}

export async function deleteEventWebhook(projectRef: string, id: string) {
	return data<unknown>(
		await DELETE(path(projectRef, `/settings/event-webhooks/${encodeURIComponent(id)}`)),
	);
}

export async function testEventWebhook(projectRef: string, id: string) {
	return data<{
		status: string;
		responseStatus: number | null;
		error: string | null;
	}>(await POST(path(projectRef, `/settings/event-webhooks/${encodeURIComponent(id)}/test`), {}));
}

export async function getEventWebhookDeliveries(projectRef: string, id: string) {
	return data<EmailEventWebhookDelivery[]>(
		await GET(path(projectRef, `/settings/event-webhooks/${encodeURIComponent(id)}/deliveries`)),
	);
}

export async function getProviderWebhooks(projectRef: string) {
	return data<ProviderWebhook[]>(await GET(path(projectRef, "/settings/provider-webhooks")));
}

export async function createProviderWebhook(projectRef: string, payload: Record<string, unknown>) {
	return data<ProviderWebhook>(
		await POST(path(projectRef, "/settings/provider-webhooks"), payload),
	);
}

export async function deleteProviderWebhook(projectRef: string, id: string) {
	return data(await DELETE(path(projectRef, `/settings/provider-webhooks/${id}`)));
}

export async function getDeliveryOutbox(projectRef: string) {
	return data<DeliveryOutboxItem[]>(await GET(path(projectRef, "/settings/delivery-outbox")));
}

export async function retryDeliveryOutbox(projectRef: string, id: string) {
	return data<{ queued: boolean }>(
		await POST(path(projectRef, `/settings/delivery-outbox/${id}/retry`), {}),
	);
}

export async function getEmailDeadLetters(projectRef: string) {
	return data<EmailDeadLetter[]>(await GET(path(projectRef, "/settings/dead-letters")));
}

export async function replayEmailDeadLetter(projectRef: string, id: string) {
	return data<{ id: string; status: "replayed"; job_type: string }>(
		await POST(path(projectRef, `/settings/dead-letters/${id}/replay`), {}),
	);
}

export async function discardEmailDeadLetter(projectRef: string, id: string) {
	return data<{ id: string; status: "discarded" }>(
		await POST(path(projectRef, `/settings/dead-letters/${id}/discard`), {}),
	);
}
export async function getProviderEvents(projectRef: string) {
	return data<Array<{ id: string; event_type: string; occurred_at: string }>>(
		await GET(path(projectRef, "/provider-events")),
	);
}
