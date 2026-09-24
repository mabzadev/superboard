import type { InternalProjectContext } from "@superboard/contracts/project-context";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";

export async function applicationUserSecurity(
	request: Request,
	db: D1Database,
	project: InternalProjectContext,
	realm: string,
	userId: string,
	path: string,
): Promise<Response> {
	if (path === "/security" && request.method === "GET") {
		const cursor = new URL(request.url).searchParams.get("cursor") ?? "";
		if (cursor.length > 255) return error(422, "session_cursor_invalid");
		const [sessions, suspension, bridge] = await Promise.all([
			db
				.prepare(
					"SELECT id,created_at,expires_at,revoked_at,CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN datetime(expires_at)<=datetime('now') THEN 'expired' ELSE 'active' END status FROM application_sessions WHERE project_id=? AND user_id=? AND id>? ORDER BY id LIMIT 51",
				)
				.bind(project.projectId, userId, cursor)
				.all<{
					id: string;
					created_at: string;
					expires_at: string;
					revoked_at: string | null;
					status: string;
				}>(),
			db
				.prepare(
					"SELECT reason,suspended_at FROM application_user_suspensions WHERE project_id=? AND user_id=?",
				)
				.bind(project.projectId, userId)
				.first<{ reason: string; suspended_at: string }>(),
			db
				.prepare(
					'SELECT bridge.application_user_id FROM identity_subject_bridge bridge JOIN "user" source ON source.id=bridge.melody_user_id WHERE bridge.realm=? AND bridge.project_id=? AND bridge.application_user_id=? AND source."deletedAt" IS NULL LIMIT 1',
				)
				.bind(realm, project.projectId, userId)
				.first<{ application_user_id: string }>(),
		]);
		return json({
			suspended: Boolean(suspension),
			suspension,
			directory_subject: bridge?.application_user_id ?? null,
			items: sessions.results.slice(0, 50),
			nextCursor: sessions.results.length > 50 ? sessions.results[49]?.id : null,
		});
	}
	const session = /^\/sessions\/([A-Za-z0-9._:-]{1,255})\/revoke$/u.exec(path)?.[1];
	if (request.method !== "POST" || (path !== "/resume" && !session))
		return error(404, "application_user_route_not_found");
	const key = request.headers.get("Idempotency-Key") ?? "";
	if (key.length < 8 || key.length > 200) return error(400, "idempotency_key_required");
	const body = await readJsonObjectLimited(request, 16384);
	if (body.user_id !== userId) return error(422, "application_user_subject_mismatch");
	const action = session ? "revoke_session" : "resume_member";
	const canonical = JSON.stringify({ action, user_id: userId, session_id: session ?? null });
	const previous = await operation(db, project.projectId, key);
	if (previous)
		return previous.request_json === canonical
			? json(JSON.parse(previous.result_json))
			: error(409, "idempotency_conflict");
	if (
		session &&
		!(await db
			.prepare("SELECT id FROM application_sessions WHERE project_id=? AND user_id=? AND id=?")
			.bind(project.projectId, userId, session)
			.first())
	)
		return error(404, "application_session_not_found");
	const now = new Date().toISOString();
	const result = {
		user_id: userId,
		...(session ? { session_id: session, status: "revoked" } : { status: "active" }),
	};
	const mutation = session
		? db
				.prepare(
					"UPDATE application_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE project_id=? AND user_id=? AND id=? AND NOT EXISTS (SELECT 1 FROM application_user_operations WHERE project_id=? AND operation_id=?)",
				)
				.bind(now, project.projectId, userId, session, project.projectId, key)
		: db
				.prepare(
					"DELETE FROM application_user_suspensions WHERE project_id=? AND user_id=? AND NOT EXISTS (SELECT 1 FROM application_user_operations WHERE project_id=? AND operation_id=?)",
				)
				.bind(project.projectId, userId, project.projectId, key);
	await db.batch([
		mutation,
		db
			.prepare(
				"INSERT OR IGNORE INTO application_user_operations(project_id,operation_id,user_id,action,operator_id,request_json,result_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
			)
			.bind(
				project.projectId,
				key,
				userId,
				action,
				project.operatorId,
				canonical,
				JSON.stringify(result),
				now,
			),
	]);
	const saved = await operation(db, project.projectId, key);
	return saved?.request_json === canonical
		? json(JSON.parse(saved.result_json))
		: error(409, "idempotency_conflict");
}

function operation(db: D1Database, projectId: number, key: string) {
	return db
		.prepare(
			"SELECT request_json,result_json FROM application_user_operations WHERE project_id=? AND operation_id=?",
		)
		.bind(projectId, key)
		.first<{ request_json: string; result_json: string }>();
}
function json(data: unknown) {
	return Response.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
}
function error(status: number, code: string) {
	return Response.json(
		{ error: { code, message: code } },
		{ status, headers: { "Cache-Control": "no-store" } },
	);
}
