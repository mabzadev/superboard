import type { EmailSmtpPublicConfig } from "@superboard/contracts/email";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";

import { failure } from "./auth.js";
import type { Env } from "./types.js";

export type DeliverySender = {
	id: string;
	public_config_json: string;
	encrypted_config: string;
	managed?: boolean;
};

type SenderAuthoritySnapshot = {
	authority: { status: string } | null;
	service: { ok: true; body: Record<string, unknown> } | { ok: false; status: number } | null;
};

/**
 * Per-queue-batch memo of the sender authority row and the Email Worker sender
 * listing, keyed by project. Only these quota-free inputs are cached: the D1
 * SMTP profile fallback query (which enforces hourly/daily quotas) always runs
 * fresh. Failed lookups are evicted so later messages retry independently.
 */
export type DeliverySendersCache = Map<number, Promise<SenderAuthoritySnapshot>>;

export function createDeliverySendersCache(): DeliverySendersCache {
	return new Map();
}

async function loadSenderAuthority(env: Env, projectId: number): Promise<SenderAuthoritySnapshot> {
	const authority = await env.DB.prepare(
		"SELECT status FROM marketing_email_profile_authority WHERE project_id=?",
	)
		.bind(projectId)
		.first<{ status: string }>();
	if (!env.EMAIL_SERVICE || !env.EMAIL_INTERNAL_TOKEN) return { authority, service: null };
	const url = new URL("https://email.internal/internal/v1/senders");
	url.searchParams.set("project_id", String(projectId));
	const response = await env.EMAIL_SERVICE.fetch(url.toString(), {
		headers: { "x-internal-token": env.EMAIL_INTERNAL_TOKEN },
	});
	if (!response.ok) return { authority, service: { ok: false, status: response.status } };
	return { authority, service: { ok: true, body: await readJsonObjectLimited(response, 128_000) } };
}

function senderAuthority(
	env: Env,
	projectId: number,
	cache?: DeliverySendersCache,
): Promise<SenderAuthoritySnapshot> {
	if (!cache) return loadSenderAuthority(env, projectId);
	const cached = cache.get(projectId);
	if (cached) return cached;
	const pending = loadSenderAuthority(env, projectId);
	cache.set(projectId, pending);
	void pending.catch(() => {
		if (cache.get(projectId) === pending) cache.delete(projectId);
	});
	return pending;
}

export async function deliverySenders(
	env: Env,
	projectId: number,
	preferred?: string | null,
	cache?: DeliverySendersCache,
): Promise<DeliverySender[]> {
	const { authority, service } = await senderAuthority(env, projectId, cache);
	if (service) {
		if (service.ok) {
			const body = service.body;
			const items = Array.isArray(body.items) ? body.items : [];
			const managed = items.flatMap((item) => {
				if (
					!item ||
					typeof item !== "object" ||
					typeof item.id !== "string" ||
					!item.publicConfig ||
					typeof item.publicConfig !== "object"
				)
					return [];
				return [
					{
						id: item.id,
						public_config_json: JSON.stringify(item.publicConfig as EmailSmtpPublicConfig),
						encrypted_config: "",
						managed: true,
					},
				];
			});
			if (
				authority?.status === "active" ||
				(!preferred && body.configured) ||
				managed.some((item) => item.id === preferred) ||
				(Array.isArray(body.known_ids) && body.known_ids.includes(preferred))
			) {
				return preferred ? managed.filter((item) => item.id === preferred) : managed;
			}
		} else if (service.status !== 404 || authority?.status === "active")
			throw failure("EMAIL_SENDERS_UNAVAILABLE", "Email senders are unavailable.", 503);
	}
	if (authority?.status === "active")
		throw failure("EMAIL_SENDERS_UNAVAILABLE", "Email senders are unavailable.", 503);
	const rows = await env.DB.prepare(
		"SELECT id,public_config_json,encrypted_config FROM smtp_profiles WHERE project_id=? AND enabled=1 AND (?=0 OR authentication_status='verified') AND (hourly_quota IS NULL OR hourly_quota > (SELECT COUNT(*) FROM email_deliveries d WHERE d.project_id=smtp_profiles.project_id AND d.smtp_profile_id=smtp_profiles.id AND julianday(d.sent_at)>=julianday('now','-1 hour') AND d.status IN ('sent','delivered'))) AND (daily_quota IS NULL OR daily_quota > (SELECT COUNT(*) FROM email_deliveries d WHERE d.project_id=smtp_profiles.project_id AND d.smtp_profile_id=smtp_profiles.id AND julianday(d.sent_at)>=julianday('now','-1 day') AND d.status IN ('sent','delivered'))) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,priority,created_at LIMIT 100",
	)
		.bind(projectId, env.ENVIRONMENT === "production" ? 1 : 0, preferred ?? "")
		.all<DeliverySender>();
	return rows.results;
}
