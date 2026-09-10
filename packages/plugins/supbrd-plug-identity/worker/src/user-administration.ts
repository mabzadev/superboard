import type { InternalProjectContext } from "@superboard/contracts/project-context";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";

interface Profile {
	id: string;
	email: string | null;
	name: string | null;
}
export async function userAdministration(
	request: Request,
	db: D1Database,
	project: InternalProjectContext,
): Promise<Response> {
	if (!project.operatorId || !["admin", "owner"].includes(project.role))
		return error(403, "application_user_administrator_required");
	const url = new URL(request.url);
	if (url.pathname === "/internal/v1/admin/members" && request.method === "GET") {
		const page = integer(url.searchParams.get("page"), 1, 1, 100000);
		const size = integer(url.searchParams.get("page_size"), 50, 10, 100);
		if (page === null || size === null) return error(422, "application_user_pagination_invalid");
		const result = await db
			.prepare(
				"SELECT id FROM application_users WHERE project_id=? AND deleted_at IS NULL ORDER BY id LIMIT ? OFFSET ?",
			)
			.bind(project.projectId, size + 1, (page - 1) * size)
			.all<{ id: string }>();
		return json({
			items: result.results.slice(0, size).map((row) => row.id),
			next_page: result.results.length > size ? page + 1 : null,
		});
	}
	const match = /^\/internal\/v1\/admin\/profiles\/([^/]+)(\/suspend)?$/u.exec(url.pathname);
	if (!match) return error(404, "application_user_route_not_found");
	const userId = decodeURIComponent(match[1]!);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u.test(userId))
		return error(422, "application_user_id_invalid");
	const profile = await db
		.prepare(
			"SELECT id,email,name FROM application_users WHERE project_id=? AND id=? AND deleted_at IS NULL",
		)
		.bind(project.projectId, userId)
		.first<Profile>();
	if (!profile) return error(404, "application_user_not_found");
	if (request.method === "GET" && !match[2]) return json(expose(profile));
	const suspend = match[2] === "/suspend" && request.method === "POST";
	if (!suspend && (match[2] || request.method !== "PUT")) return error(405, "method_not_allowed");
	const key = request.headers.get("Idempotency-Key") ?? "";
	if (key.length < 8 || key.length > 200) return error(400, "idempotency_key_required");
	const body = await readJsonObjectLimited(request, 16384);
	if (body.user_id !== userId) return error(422, "application_user_subject_mismatch");
	const text = suspend ? body.reason : body.display_name;
	if (typeof text !== "string" || !text.trim() || text.length > (suspend ? 2000 : 120))
		return error(422, "application_user_input_invalid");
	const action = suspend ? "suspend_member" : "update_profile";
	const canonical = JSON.stringify({ action, user_id: userId, value: text.trim() });
	const prior = await operation(db, project.projectId, key);
	if (prior)
		return prior.request_json === canonical
			? json(JSON.parse(prior.result_json))
			: error(409, "idempotency_conflict");
	const now = new Date().toISOString();
	const result = suspend
		? { user_id: userId, status: "suspended" }
		: expose({ ...profile, name: text.trim() });
	const statements = suspend
		? [
				db
					.prepare(
						"INSERT INTO application_user_suspensions(project_id,user_id,reason,operator_id,suspended_at) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM application_user_operations WHERE project_id=? AND operation_id=?) ON CONFLICT(project_id,user_id) DO UPDATE SET reason=excluded.reason,operator_id=excluded.operator_id,suspended_at=excluded.suspended_at",
					)
					.bind(
						project.projectId,
						userId,
						text.trim(),
						project.operatorId,
						now,
						project.projectId,
						key,
					),
				db
					.prepare(
						"UPDATE application_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE project_id=? AND user_id=? AND EXISTS (SELECT 1 FROM application_user_suspensions WHERE project_id=? AND user_id=?)",
					)
					.bind(now, project.projectId, userId, project.projectId, userId),
			]
		: [
				db
					.prepare(
						"UPDATE application_users SET name=?,updated_at=? WHERE project_id=? AND id=? AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM application_user_operations WHERE project_id=? AND operation_id=?)",
					)
					.bind(text.trim(), now, project.projectId, userId, project.projectId, key),
			];
	statements.push(
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
	);
	await db.batch(statements);
	const saved = await operation(db, project.projectId, key);
	return saved?.request_json === canonical
		? json(JSON.parse(saved.result_json))
		: error(409, "idempotency_conflict");
}
function operation(db: D1Database, project: number, key: string) {
	return db
		.prepare(
			"SELECT request_json,result_json FROM application_user_operations WHERE project_id=? AND operation_id=?",
		)
		.bind(project, key)
		.first<{ request_json: string; result_json: string }>();
}
function expose(row: Profile) {
	return { user_id: row.id, email: row.email, display_name: row.name ?? "" };
}
function integer(value: string | null, fallback: number, minimum: number, maximum: number) {
	const parsed = value === null ? fallback : Number(value);
	return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
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
