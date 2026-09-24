export async function readEmailAdminMessages(
	request: Request,
	env: Env,
	projectId: number,
): Promise<Response | null> {
	if (request.method !== "GET") return null;
	const url = new URL(request.url);
	const path = url.pathname.slice("/internal/v1/admin".length);
	const headers = { "Cache-Control": "no-store" };
	if (path === "/messages") {
		const limit = Math.min(
			100,
			Math.max(1, Math.floor(Number(url.searchParams.get("limit")) || 50)),
		);
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
			"SELECT m.id,m.subject,m.kind,m.status,m.transport,m.created_at,m.sent_at,m.last_error,group_concat(d.recipient,', ') AS recipients,COUNT(d.id) AS recipient_count FROM email_messages m LEFT JOIN email_deliveries d ON d.message_id=m.id WHERE m.project_id=? AND (?='' OR m.status=?) AND (?='' OR instr(lower(m.subject),lower(?))>0 OR EXISTS(SELECT 1 FROM email_deliveries r WHERE r.message_id=m.id AND instr(lower(r.recipient),lower(?))>0)) AND (m.created_at<? OR (m.created_at=? AND m.id<?)) GROUP BY m.id ORDER BY m.created_at DESC,m.id DESC LIMIT ?",
		)
			.bind(projectId, status, status, query, query, query, after[0], after[0], after[1], limit + 1)
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
	}
	const id = /^\/messages\/([^/]+)$/.exec(path)?.[1];
	if (!id) return null;
	const message = await env.DB.prepare(
		"SELECT id,subject,kind,status,transport,from_name,from_address,reply_to,text_body,html_body,created_at,sent_at,last_error FROM email_messages WHERE project_id=? AND id=?",
	)
		.bind(projectId, id)
		.first();
	if (!message)
		return Response.json({ error: { code: "EMAIL_MESSAGE_NOT_FOUND" } }, { status: 404, headers });
	const deliveries = await env.DB.prepare(
		"SELECT recipient,status,provider_status,provider_event_at,attempt_count,last_error,sent_at FROM email_deliveries WHERE message_id=? ORDER BY recipient",
	)
		.bind(id)
		.all();
	return Response.json({ data: { ...message, deliveries: deliveries.results } }, { headers });
}
