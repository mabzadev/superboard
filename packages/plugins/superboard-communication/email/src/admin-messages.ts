import { createFetchRouter, resolveRegisteredRoute } from "@superboard/contracts/route-registry";

export const emailMessageRoutes = createFetchRouter<{ env: Env; projectId: number }>({
	service: "email",
	module: "admin-messages",
	pluginId: "superboard-email",
	surface: "internal",
	access: "internal",
});
const headers = { "Cache-Control": "no-store" };
emailMessageRoutes.get("/internal/v1/admin/messages", async ({ url, env: { env, projectId } }) => {
	const limit = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get("limit")) || 50)));
	const query = (url.searchParams.get("q") ?? "").slice(0, 255);
	const status = url.searchParams.get("status") ?? "";
	const cursor = url.searchParams.get("cursor");
	let after = ["9999-12-31", "~"];
	if (cursor) {
		try {
			const value: unknown = JSON.parse(atob(cursor));
			if (
				!Array.isArray(value) ||
				value.length !== 2 ||
				value.some((item) => typeof item !== "string" || item.length > 255)
			)
				throw new Error();
			after = value;
		} catch {
			return Response.json({ error: { code: "EMAIL_CURSOR_INVALID" } }, { status: 422, headers });
		}
	}
	const rows = await env.DB.prepare(
		"SELECT m.id,m.subject,m.kind,CASE WHEN x.state='scheduled' AND m.status='queued' THEN 'scheduled' WHEN x.state='canceled' THEN 'canceled' ELSE m.status END AS status,m.transport,m.created_at,m.sent_at,m.last_error,COALESCE(x.source,'admin') AS source,x.scheduled_at,group_concat(d.recipient,', ') AS recipients,COUNT(d.id) AS recipient_count FROM email_messages m LEFT JOIN email_message_dispatch x ON x.message_id=m.id LEFT JOIN email_deliveries d ON d.message_id=m.id WHERE m.project_id=? AND (?='' OR m.status=? OR (?='scheduled' AND x.state='scheduled') OR (?='canceled' AND x.state='canceled')) AND (?='' OR instr(lower(m.subject),lower(?))>0 OR EXISTS(SELECT 1 FROM email_deliveries r WHERE r.message_id=m.id AND instr(lower(r.recipient),lower(?))>0)) AND (m.created_at<? OR (m.created_at=? AND m.id<?)) GROUP BY m.id ORDER BY m.created_at DESC,m.id DESC LIMIT ?",
	)
		.bind(
			projectId,
			status,
			status,
			status,
			status,
			query,
			query,
			query,
			after[0],
			after[0],
			after[1],
			limit + 1,
		)
		.all<Record<string, unknown>>();
	const items = rows.results.slice(0, limit);
	return Response.json(
		{
			data: {
				items,
				...(rows.results.length > limit
					? { nextCursor: btoa(JSON.stringify([items.at(-1)!.created_at, items.at(-1)!.id])) }
					: {}),
			},
		},
		{ headers },
	);
});
emailMessageRoutes.get(
	"/internal/v1/admin/messages/:id",
	async ({ params: { id }, env: { env, projectId } }) => {
		const message = await env.DB.prepare(
			"SELECT m.id,m.subject,m.kind,CASE WHEN x.state='scheduled' AND m.status='queued' THEN 'scheduled' WHEN x.state='canceled' THEN 'canceled' ELSE m.status END AS status,m.transport,m.from_name,m.from_address,m.reply_to,m.text_body,m.html_body,m.created_at,m.sent_at,m.last_error,m.template_key,COALESCE(x.source,'admin') AS source,x.scheduled_at,x.canceled_at,x.tags_json FROM email_messages m LEFT JOIN email_message_dispatch x ON x.message_id=m.id WHERE m.project_id=? AND m.id=?",
		)
			.bind(projectId, id)
			.first<Record<string, unknown>>();
		if (!message)
			return Response.json(
				{ error: { code: "EMAIL_MESSAGE_NOT_FOUND" } },
				{ status: 404, headers },
			);
		const deliveries = await env.DB.prepare(
			"SELECT recipient,status,provider_status,provider_event_at,attempt_count,last_error,sent_at FROM email_deliveries WHERE message_id=? ORDER BY recipient",
		)
			.bind(id)
			.all();
		// Status timeline (accepted/scheduled → sent → delivered/bounced/…) and attachment metadata.
		const [timeline, attachments] = await Promise.all([
			env.DB.prepare(
				"SELECT event_type AS type,recipient,occurred_at,detail FROM email_message_events WHERE message_id=? ORDER BY occurred_at,id LIMIT 200",
			)
				.bind(id)
				.all<{
					type: string;
					recipient: string | null;
					occurred_at: string;
					detail: string | null;
				}>(),
			env.DB.prepare(
				"SELECT filename,content_type,disposition,size_bytes FROM email_message_attachments WHERE message_id=? ORDER BY position",
			)
				.bind(id)
				.all(),
		]);
		const { tags_json: tags, ...summary } = message;
		return Response.json(
			{
				data: {
					...summary,
					tags: parseList(typeof tags === "string" ? tags : "[]"),
					deliveries: deliveries.results,
					timeline: timeline.results.map((event) => ({
						...event,
						detail: parseDetail(event.detail),
					})),
					attachments: attachments.results,
				},
			},
			{ headers },
		);
	},
);
function parseList(value: string): unknown[] {
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
function parseDetail(value: string | null): Record<string, unknown> | null {
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? { ...parsed }
			: null;
	} catch {
		return null;
	}
}
export async function readEmailAdminMessages(
	request: Request,
	env: Env,
	projectId: number,
): Promise<Response | null> {
	if (
		!resolveRegisteredRoute(
			emailMessageRoutes,
			request.method,
			"internal",
			new URL(request.url).pathname,
		)
	)
		return null;
	return emailMessageRoutes.fetch(request, { env, projectId });
}
