import type { ProjectContext } from "@superboard/contracts/project-context";
import { Hono } from "hono";

import { failure } from "./auth.js";
import type { Env } from "./types.js";

const recordsSql =
	"WITH ids AS (SELECT project_id,delivery_id FROM email_studio_transports WHERE project_id=? UNION SELECT project_id,delivery_id FROM email_studio_deliveries WHERE project_id=? UNION SELECT project_id,id FROM email_deliveries WHERE project_id=? UNION SELECT project_id,id FROM marketing_journey_deliveries WHERE project_id=?), records AS (SELECT ids.delivery_id,COALESCE(s.resource_id,d.campaign_id,j.enrollment_id,'') AS resource_id,COALESCE(s.purpose,t.purpose,'legacy') AS purpose,COALESCE(s.locale,t.locale) AS locale,s.requested_locale,COALESCE(s.reason,'legacy') AS reason,COALESCE(s.subject,json_extract(t.message_json,'$.subject'),c.subject,'') AS subject,COALESCE(d.recipient_email,j.recipient,json_extract(t.message_json,'$.to'),'') AS recipient_email,COALESCE(d.status,j.status,t.status,'pending') AS status,d.last_error,COALESCE(t.created_at,s.created_at,d.created_at,j.created_at) AS created_at FROM ids LEFT JOIN email_studio_transports t ON t.project_id=ids.project_id AND t.delivery_id=ids.delivery_id LEFT JOIN email_studio_deliveries s ON s.project_id=ids.project_id AND s.delivery_id=ids.delivery_id LEFT JOIN email_deliveries d ON d.project_id=ids.project_id AND d.id=ids.delivery_id LEFT JOIN campaigns c ON c.project_id=d.project_id AND c.id=d.campaign_id LEFT JOIN marketing_journey_deliveries j ON j.project_id=ids.project_id AND j.id=ids.delivery_id)";
export async function studioDeliveryStatistics(
	db: D1Database,
	projectId: number,
	filters: URLSearchParams,
) {
	const where: string[] = [];
	const values: Array<string | number> = [projectId, projectId, projectId, projectId, projectId];
	for (const key of ["locale", "purpose", "resource_id"] as const) {
		const value = filters.get(key);
		if (value) {
			where.push("r." + key + "=?");
			values.push(value);
		}
	}
	for (const [key, operator] of [
		["from", ">="],
		["to", "<="],
	] as const) {
		const value = filters.get(key);
		if (value) {
			if (!Number.isFinite(Date.parse(value)))
				throw failure("EMAIL_DATE_INVALID", "Choose valid dates.");
			where.push("r.created_at" + operator + "?");
			values.push(value);
		}
	}
	const rows = await db
		.prepare(
			recordsSql +
				", events AS (SELECT delivery_id,SUM(event_type='open') AS opens,SUM(event_type='click') AS clicks FROM email_events WHERE project_id=? GROUP BY delivery_id) SELECT COALESCE(r.locale,'unknown') AS locale,r.purpose,COUNT(*) AS messages,SUM(r.status IN ('sent','delivered')) AS sent,SUM(r.status='delivered') AS delivered,SUM(r.status='failed') AS failed,SUM(r.status='suppressed') AS excluded,COALESCE(SUM(e.opens),0) AS opens,COALESCE(SUM(e.clicks),0) AS clicks FROM records r LEFT JOIN events e ON e.delivery_id=r.delivery_id" +
				(where.length ? " WHERE " + where.join(" AND ") : "") +
				" GROUP BY r.locale,r.purpose ORDER BY messages DESC",
		)
		.bind(...values)
		.all<Record<string, unknown>>();
	const totals: Record<string, number> = {
		messages: 0,
		sent: 0,
		delivered: 0,
		failed: 0,
		excluded: 0,
		opens: 0,
		clicks: 0,
	};
	for (const row of rows.results)
		for (const key of Object.keys(totals)) totals[key] = (totals[key] ?? 0) + Number(row[key] ?? 0);
	return { totals, groups: rows.results };
}

export const studioDeliveryRoutes = new Hono<{
	Bindings: Env;
	Variables: { project: ProjectContext };
}>();
studioDeliveryRoutes.get("/", async (c) => {
	const projectId = c.get("project").projectId;
	const limit = Math.min(100, Math.max(1, Math.floor(Number(c.req.query("limit")) || 50)));
	const clauses: string[] = [];
	const bindings: Array<string | number> = [projectId, projectId, projectId, projectId];
	for (const key of ["locale", "purpose", "resource_id", "status"] as const) {
		const value = c.req.query(key);
		if (value) {
			clauses.push(key + "=?");
			bindings.push(value);
		}
	}
	const query = c.req.query("q");
	if (query) {
		clauses.push("(instr(lower(recipient_email),lower(?))>0 OR instr(lower(subject),lower(?))>0)");
		bindings.push(query, query);
	}
	const cursor = c.req.query("cursor");
	if (cursor) {
		let value: unknown;
		try {
			value = JSON.parse(atob(cursor));
		} catch {
			throw failure("EMAIL_CURSOR_INVALID", "The delivery cursor is invalid.");
		}
		if (
			!Array.isArray(value) ||
			value.length !== 2 ||
			value.some((item) => typeof item !== "string" || item.length > 255)
		)
			throw failure("EMAIL_CURSOR_INVALID", "The delivery cursor is invalid.");
		clauses.push("(created_at<? OR (created_at=? AND delivery_id<?))");
		bindings.push(value[0], value[0], value[1]);
	}
	const rows = await c.env.DB.prepare(
		recordsSql +
			" SELECT * FROM records" +
			(clauses.length ? " WHERE " + clauses.join(" AND ") : "") +
			" ORDER BY created_at DESC,delivery_id DESC LIMIT ?",
	)
		.bind(...bindings, limit + 1)
		.all<Record<string, unknown>>();
	const items = rows.results.slice(0, limit);
	return c.json({
		data: {
			items,
			...(rows.results.length > limit
				? {
						nextCursor: btoa(JSON.stringify([items.at(-1)!.created_at, items.at(-1)!.delivery_id])),
					}
				: {}),
		},
	});
});
studioDeliveryRoutes.get("/:id", async (c) => {
	const projectId = c.get("project").projectId;
	const id = c.req.param("id");
	const record = await c.env.DB.prepare(recordsSql + " SELECT * FROM records WHERE delivery_id=?")
		.bind(projectId, projectId, projectId, projectId, id)
		.first<Record<string, unknown>>();
	if (!record) throw failure("EMAIL_DELIVERY_NOT_FOUND", "Email delivery not found.", 404);
	const body = await c.env.DB.prepare(
		"SELECT message_json FROM email_studio_transports WHERE project_id=? AND delivery_id=?",
	)
		.bind(projectId, id)
		.first<{ message_json: string }>();
	const prepared = body
		? null
		: await c.env.DB.prepare(
				"SELECT content_html,content_text FROM email_studio_deliveries WHERE project_id=? AND delivery_id=?",
			)
				.bind(projectId, id)
				.first<{ content_html: string; content_text: string }>();
	const message = body ? (JSON.parse(body.message_json) as { html?: string; text?: string }) : null;
	const attempts = await c.env.DB.prepare(
		"SELECT attempt_number,success,error_message,created_at FROM email_studio_send_attempts WHERE project_id=? AND delivery_id=? UNION ALL SELECT attempt_number,success,error_message,created_at FROM smtp_attempts WHERE project_id=? AND delivery_id=? ORDER BY created_at",
	)
		.bind(projectId, id, projectId, id)
		.all();
	return c.json({
		data: {
			...record,
			content_html: message?.html ?? prepared?.content_html ?? null,
			content_text: message?.text ?? prepared?.content_text ?? null,
			render_available: Boolean(body || prepared),
			attempts: attempts.results,
		},
	});
});
