import { canonicalPluginId } from "@superboard/contracts/plugin-packages";
import { readJsonObjectLimited, RequestBodyError } from "@superboard/contracts/request-body";
import type { FrontReleasePayload } from "@superboard/supbrd-core";
import type { APIContext, MiddlewareNext } from "astro";
import { requirePerm } from "emdash/api/plugin-settings";

import { resolveViewConnections } from "./view-connections.js";

export async function saveViewPluginSelection(
	context: APIContext,
	next: MiddlewareNext,
	release: FrontReleasePayload | null,
): Promise<Response | null> {
	let body: Record<string, unknown>;
	try {
		body = await readJsonObjectLimited(context.request.clone(), 2_000_000);
	} catch (error) {
		if (error instanceof RequestBodyError)
			return Response.json(
				{ error: { code: error.code, message: "Invalid View request" } },
				{ status: error.status },
			);
		throw error;
	}
	if (!isRecord(body.data) || !("plugin_id" in body.data)) return null;
	const denied = requirePerm(context.locals.user, "content:read");
	if (denied) return denied;
	const { collection, id } = context.params;
	if (!collection || !id) return null;
	const existing = await context.locals.emdash.handleContentGet(
		collection,
		id,
		context.url.searchParams.get("locale") || undefined,
		{ includeDrafts: true },
	);
	const item = existing.success && isRecord(existing.data) ? existing.data.item : null;
	if (!isRecord(item) || !isRecord(item.data))
		return Response.json(
			{ error: { code: "NOT_FOUND", message: "View not found" } },
			{ status: 404 },
		);
	const connections = resolveViewConnections({ ...item.data, ...body.data }, release);
	if (
		typeof body.data.plugin_id !== "string" ||
		typeof connections.plugin_id !== "string" ||
		!connections.renderer_id ||
		canonicalPluginId(body.data.plugin_id) !== canonicalPluginId(connections.plugin_id)
	) {
		return Response.json(
			{
				error: {
					code: "VIEW_PLUGIN_ROUTE_MISMATCH",
					message: "The selected plugin does not provide this View's route.",
				},
			},
			{ status: 422 },
		);
	}
	body.data.plugin_id = connections.plugin_id;
	const headers = new Headers(context.request.headers);
	headers.delete("Content-Length");
	return next(new Request(context.request, { method: "PUT", headers, body: JSON.stringify(body) }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
