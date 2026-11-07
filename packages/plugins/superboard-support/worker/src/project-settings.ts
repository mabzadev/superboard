import { recordSlaResolution } from "./service-levels";
import type { Env } from "./types";
import { publishSupportEvent } from "./webhooks";
import { runConversationAutomations } from "./workflows";

const AUTO_RESOLVE_BATCH = 100;

export async function resolveInactiveConversations(env: Pick<Env, "DB" | "SUPPORT_QUEUE">) {
	const due = await env.DB.prepare(
		`SELECT conversation.id, conversation.project_id FROM conversations conversation
     INNER JOIN support_project_settings settings ON settings.project_id = conversation.project_id
     WHERE settings.auto_resolve_minutes > 0
       AND conversation.status IN ('open', 'pending')
       AND (conversation.snoozed_until IS NULL
         OR julianday(conversation.snoozed_until) <= julianday('now'))
       AND julianday(COALESCE(conversation.last_message_at, conversation.created_at))
         <= julianday('now') - settings.auto_resolve_minutes / 1440.0
     ORDER BY COALESCE(conversation.last_message_at, conversation.created_at), conversation.id
     LIMIT ?`,
	)
		.bind(AUTO_RESOLVE_BATCH)
		.all<{ id: string; project_id: number }>();
	let resolved = 0;
	for (const conversation of due.results) {
		const [update] = await env.DB.batch([
			env.DB.prepare(
				`UPDATE conversations SET status = 'closed',
           resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND project_id = ? AND status IN ('open', 'pending')
         RETURNING id`,
			).bind(conversation.id, conversation.project_id),
			env.DB.prepare(
				`INSERT INTO support_audit_events
          (id, conversation_id, project_id, event_type, actor_kind, actor_id, payload_json)
         SELECT ?, ?, ?, 'conversation.auto_resolved', 'system', 'support',
           json_object('auto_resolve_minutes', settings.auto_resolve_minutes)
         FROM support_project_settings settings
         WHERE settings.project_id = ? AND changes() > 0`,
			).bind(
				crypto.randomUUID(),
				conversation.id,
				conversation.project_id,
				conversation.project_id,
			),
		]);
		if (!update?.results.length) continue;
		resolved++;
		try {
			await conversationResolved(env, conversation.project_id, conversation.id);
		} catch (error) {
			console.error(
				JSON.stringify({
					event: "support_auto_resolve_follow_up_failed",
					conversation_id: conversation.id,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		}
	}
	return resolved;
}

async function conversationResolved(
	env: Pick<Env, "DB" | "SUPPORT_QUEUE">,
	projectId: number,
	conversationId: string,
) {
	await recordSlaResolution(env.DB, projectId, conversationId);
	const eventId = `conversation_auto_resolved:${conversationId}`;
	await runConversationAutomations(
		env,
		projectId,
		conversationId,
		"conversation_resolved",
		eventId,
	);
	await publishSupportEvent(env, projectId, eventId, "conversation.updated", {
		conversation_id: conversationId,
		status: "closed",
	});
}

type CustomerFormat = {
	businessName: string;
	dateFormat: string;
	timezone: string;
};

export async function customerFormat(db: D1Database, projectId: number): Promise<CustomerFormat> {
	const row = await db
		.prepare(
			"SELECT business_name, date_format, timezone FROM support_project_settings WHERE project_id = ?",
		)
		.bind(projectId)
		.first<{ business_name: string | null; date_format: string | null; timezone: string | null }>();
	return {
		businessName: row?.business_name?.trim() ?? "",
		dateFormat: row?.date_format?.trim() || "YYYY-MM-DD",
		timezone: row?.timezone?.trim() || "UTC",
	};
}

const dateTokens = /YYYY|YY|MM|M|DD|D|HH|H|mm|ss/gu;

export function formatCustomerDateTime(value: unknown, format: CustomerFormat) {
	const date = new Date(String(value));
	if (Number.isNaN(date.valueOf())) return String(value);
	const parts = zonedParts(date, format.timezone);
	const pattern = /H/u.test(format.dateFormat) ? format.dateFormat : `${format.dateFormat} HH:mm`;
	return pattern.replace(dateTokens, (token) => {
		switch (token) {
			case "YYYY":
				return parts.year;
			case "YY":
				return parts.year.slice(-2);
			case "MM":
				return parts.month;
			case "M":
				return String(Number(parts.month));
			case "DD":
				return parts.day;
			case "D":
				return String(Number(parts.day));
			case "HH":
				return parts.hour;
			case "H":
				return String(Number(parts.hour));
			case "mm":
				return parts.minute;
			default:
				return parts.second;
		}
	});
}

function zonedParts(date: Date, timezone: string) {
	let formatter: Intl.DateTimeFormat;
	try {
		formatter = dateTimeFormatter(timezone);
	} catch {
		formatter = dateTimeFormatter("UTC");
	}
	const parts = Object.fromEntries(
		formatter.formatToParts(date).map((part) => [part.type, part.value]),
	);
	return {
		year: parts.year ?? "",
		month: parts.month ?? "",
		day: parts.day ?? "",
		hour: parts.hour === "24" ? "00" : (parts.hour ?? ""),
		minute: parts.minute ?? "",
		second: parts.second ?? "",
	};
}

function dateTimeFormatter(timeZone: string) {
	return new Intl.DateTimeFormat("en-GB", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
}
