import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { claimScheduledSupportJobs } from "../../../../../../packages/plugins/superboard-support/worker/src/index";

const minute = 60_000;

async function saveSettings(
	projectId: number,
	settings: {
		autoResolveMinutes?: number | null;
		businessName?: string;
		dateFormat?: string;
		timezone?: string;
	},
) {
	await env.DB.prepare(
		`INSERT INTO support_project_settings
      (project_id, business_name, timezone, date_format, auto_resolve_minutes)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET business_name = excluded.business_name,
       timezone = excluded.timezone, date_format = excluded.date_format,
       auto_resolve_minutes = excluded.auto_resolve_minutes`,
	)
		.bind(
			projectId,
			settings.businessName ?? "",
			settings.timezone ?? "UTC",
			settings.dateFormat ?? "YYYY-MM-DD",
			settings.autoResolveMinutes ?? null,
		)
		.run();
}

async function insertConversation(
	projectId: number,
	id: string,
	options: {
		status?: string;
		lastMessageAt?: string | null;
		createdAt?: string;
		snoozedUntil?: string | null;
		externalUserId?: string;
	} = {},
) {
	const createdAt = options.createdAt ?? new Date(Date.now() - 24 * 60 * minute).toISOString();
	await env.DB.prepare(
		`INSERT INTO conversations
      (id, project_id, external_user_id, client_conversation_id, subject, status,
       last_message_at, snoozed_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			projectId,
			options.externalUserId ?? `customer-${id}`,
			`client-${id}`,
			`Conversation ${id}`,
			options.status ?? "open",
			options.lastMessageAt === undefined ? createdAt : options.lastMessageAt,
			options.snoozedUntil ?? null,
			createdAt,
			createdAt,
		)
		.run();
}

async function statusOf(id: string) {
	return env.DB.prepare("SELECT status, resolved_at FROM conversations WHERE id = ?")
		.bind(id)
		.first<{ status: string; resolved_at: string | null }>();
}

function ago(minutes: number) {
	return new Date(Date.now() - minutes * minute).toISOString();
}

describe("project settings take effect", () => {
	it("resolves conversations inactive for longer than the project delay, once", async () => {
		await saveSettings(401, { autoResolveMinutes: 60 });
		await saveSettings(402, { autoResolveMinutes: null });
		await saveSettings(403, { autoResolveMinutes: 0 });
		await insertConversation(401, "stale-open", { lastMessageAt: ago(120) });
		await insertConversation(401, "stale-pending", { status: "pending", lastMessageAt: ago(90) });
		await insertConversation(401, "recent", { lastMessageAt: ago(10) });
		await insertConversation(401, "snoozed", {
			lastMessageAt: ago(120),
			snoozedUntil: new Date(Date.now() + 60 * minute).toISOString(),
		});
		await insertConversation(401, "already-closed", { status: "closed", lastMessageAt: ago(500) });
		await insertConversation(402, "no-delay", { lastMessageAt: ago(5_000) });
		await insertConversation(403, "zero-delay", { lastMessageAt: ago(5_000) });

		const first = await claimScheduledSupportJobs(env);
		const second = await claimScheduledSupportJobs(env);

		expect(first.auto_resolved).toBe(2);
		expect(second.auto_resolved).toBe(0);
		for (const id of ["stale-open", "stale-pending"]) {
			const conversation = await statusOf(id);
			expect(conversation?.status).toBe("closed");
			expect(conversation?.resolved_at).toBeTruthy();
		}
		for (const id of ["recent", "snoozed", "no-delay", "zero-delay"])
			expect((await statusOf(id))?.status).not.toBe("closed");
		const audit = await env.DB.prepare(
			`SELECT conversation_id, actor_kind FROM support_audit_events
       WHERE event_type = 'conversation.auto_resolved' ORDER BY conversation_id`,
		).all<{ conversation_id: string; actor_kind: string }>();
		expect(audit.results).toEqual([
			{ conversation_id: "stale-open", actor_kind: "system" },
			{ conversation_id: "stale-pending", actor_kind: "system" },
		]);
	});

	it("publishes the company name and date format in the widget configuration", async () => {
		await saveSettings(12, { businessName: "Acme Care", dateFormat: "DD/MM/YYYY" });
		const response = await SELF.fetch("https://support.internal/v1/configuration", {
			headers: widgetHeaders("visitor-configuration"),
		});
		expect(response.status).toBe(200);
		const body = await response.json<{ data: Record<string, unknown> }>();
		expect(body.data).toMatchObject({ business_name: "Acme Care", date_format: "DD/MM/YYYY" });
	});

	it("writes transcripts with the company name and the project date format", async () => {
		await saveSettings(12, {
			businessName: "Acme Care",
			dateFormat: "DD/MM/YYYY",
			timezone: "Europe/Paris",
		});
		await insertConversation(12, "transcript-conversation", {
			externalUserId: "visitor-transcript",
		});
		for (const [id, sequence, kind, createdAt, body] of [
			["transcript-1", 1, "user", "2026-08-13T12:00:00.000Z", "Hello"],
			["transcript-2", 2, "agent", "2026-08-13T12:05:00.000Z", "How can we help?"],
		] as const) {
			await env.DB.prepare(
				`INSERT INTO messages
          (id, conversation_id, sender_kind, sender_id, body, client_message_id,
           sequence, visibility, content_type, created_at)
         VALUES (?, 'transcript-conversation', ?, ?, ?, ?, ?, 'public', 'text', ?)`,
			)
				.bind(id, kind, `${kind}-sender`, body, `client-${id}`, sequence, createdAt)
				.run();
		}
		const response = await SELF.fetch(
			"https://support.internal/v1/conversations/transcript-conversation/transcript",
			{
				method: "POST",
				headers: {
					...widgetHeaders("visitor-transcript"),
					"content-type": "application/json",
					"idempotency-key": crypto.randomUUID(),
				},
				body: "{}",
			},
		);
		expect(response.status).toBe(200);
		const body = await response.json<{ data: { transcript: string } }>();
		expect(body.data.transcript).toBe(
			"[13/08/2026 14:00] user: Hello\n[13/08/2026 14:05] Acme Care: How can we help?",
		);
	});
});

function widgetHeaders(subject: string) {
	return {
		"x-widget-capability": "support-runtime-secret",
		"x-widget-subject": subject,
		"x-widget-identity-expires-at": String(Date.now() + 10 * minute),
		"x-widget-project-id": "12",
		"x-superboard-project-id": "12",
	};
}
