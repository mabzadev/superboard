import type { DataEnv } from "./platform/env.js";
import { DataError, isRecord, nowIso } from "./platform/http.js";

export interface ProjectSettings {
	realtime_anonymous: boolean;
}

export async function getProjectSettings(
	env: DataEnv,
	projectId: number,
): Promise<ProjectSettings> {
	const row = await env.DB.prepare(
		"SELECT realtime_anonymous FROM data_project_settings WHERE project_id = ?",
	)
		.bind(projectId)
		.first<{ realtime_anonymous: number }>();
	return { realtime_anonymous: Number(row?.realtime_anonymous ?? 0) === 1 };
}

export async function updateProjectSettings(
	env: DataEnv,
	projectId: number,
	body: unknown,
): Promise<ProjectSettings> {
	if (!isRecord(body)) throw new DataError(422, "settings_invalid", "Body must be an object");
	const current = await getProjectSettings(env, projectId);
	const next = { ...current };
	if (body.realtime_anonymous !== undefined) {
		if (typeof body.realtime_anonymous !== "boolean")
			throw new DataError(422, "settings_invalid", "realtime_anonymous must be a boolean");
		next.realtime_anonymous = body.realtime_anonymous;
	}
	await env.DB.prepare(
		`INSERT INTO data_project_settings (project_id, realtime_anonymous, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(project_id) DO UPDATE SET realtime_anonymous = excluded.realtime_anonymous, updated_at = excluded.updated_at`,
	)
		.bind(projectId, next.realtime_anonymous ? 1 : 0, nowIso())
		.run();
	return next;
}
