import { jsonResponse } from "./operator-guard.js";
import type { SuperBoardPluginTarget } from "./superboard-plugin-catalog.js";

export async function requireActiveSuperBoardPlugin(
	db: D1Database,
	input: { instance_id: string; target: SuperBoardPluginTarget; plugin_id: string },
): Promise<Response | null> {
	if (input.plugin_id === "supbrd-core") return null;
	const row = await db
		.prepare(`SELECT 1 AS active FROM superboard_plugin_lifecycle
 WHERE instance_id = ? AND target = ? AND plugin_id = ? AND state = 'active'`)
		.bind(input.instance_id, input.target, input.plugin_id)
		.first<{ active: number }>();
	return row ? null : jsonResponse({ error: { code: "PLUGIN_NOT_ACTIVE" } }, 404);
}
