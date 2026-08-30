import type { APIRoute } from "astro";

import { jsonResponse } from "../../lib/operator-guard.js";
import { getSiteEnv } from "../../lib/site-env.js";

export const prerender = false;

export const GET: APIRoute = async () => {
	const env = getSiteEnv();
	try {
		const active = await env.DB.prepare(
			`SELECT active_release_id, pointer_revision
			 FROM superboard_front_active_releases
			 WHERE instance_id = ?`,
		)
			.bind(env.SUPERBOARD_INSTANCE_ID)
			.first<{ active_release_id: string; pointer_revision: number }>();
		if (!active) {
			return jsonResponse(
				{ status: "not_ready", reason: "NO_ACTIVE_VERIFIED_RELEASE", front_status: "maintenance" },
				503,
			);
		}
		return jsonResponse({
			status: "ready",
			active_release_id: active.active_release_id,
			pointer_revision: active.pointer_revision,
		});
	} catch {
		return jsonResponse({ status: "not_ready", reason: "RELEASE_STORE_UNAVAILABLE" }, 503);
	}
};
