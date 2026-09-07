import { config } from "../../../../../../../../../supbrd-front-ui/src/shared/lib/config.js";
import { DELETE, GET, POST, PUT } from "../../../transport.js";

const path = (projectRef: string, resource: string) =>
	`${config.apiPath}/email/projects/${projectRef}${resource}`;

const data = <T>(response: { data: T | { data: T } }): T =>
	response.data && typeof response.data === "object" && "data" in response.data
		? (response.data as { data: T }).data
		: (response.data as T);

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
	spf_status?: "verified" | "missing" | null;
	dkim_status?: "verified" | "missing" | "unconfigured" | null;
	dmarc_status?: "verified" | "missing" | null;
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

export type DeliveryOutboxItem = {
	id: string;
	job_type: string;
	resource_id: string;
	status: string;
	attempt_count: number;
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
	return data<{
		domain: string;
		dkimSelector: string | null;
		spf: "verified" | "missing";
		dkim: "verified" | "missing" | "unconfigured";
		dmarc: "verified" | "missing";
		ready: boolean;
		checkedAt: string;
	}>(await POST(path(projectRef, `/settings/smtp/${profileId}/verify-domain`), {}));
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
