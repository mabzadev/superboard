import { hasPermission } from "@emdash-cms/auth";
import {
	createOperatorReauthenticationReceipt,
	type OperatorReauthenticationReceipt,
} from "@superboard/supbrd-core";
import type { APIContext } from "astro";

import type { SuperBoardSiteEnv } from "./site-env.js";

const LOCAL_OPERATOR_REAUTHENTICATION = Symbol("superboard.localOperatorReauthentication");

interface LocalOperatorReauthentication {
	userId: string;
	verifiedAt: string;
}

export function requireReleaseOperator(
	context: Pick<APIContext, "locals" | "request" | "url">,
	env: SuperBoardSiteEnv,
): Response | null {
	if (!context.locals.user) return errorResponse("AUTHENTICATION_REQUIRED", 401);
	if (!hasPermission(context.locals.user, "settings:manage")) {
		return errorResponse("OPERATOR_REQUIRED", 403);
	}
	if (String(env.SUPERBOARD_RELEASE_OPERATIONS) !== "enabled") {
		return errorResponse("RELEASE_OPERATIONS_DISABLED", 503);
	}
	if (context.request.headers.get("X-EmDash-Request") !== "1") {
		return errorResponse("CSRF_HEADER_REQUIRED", 403);
	}
	const origin = context.request.headers.get("Origin");
	if (origin !== context.url.origin) return errorResponse("CSRF_ORIGIN_REJECTED", 403);
	return null;
}

export function requirePluginOperator(
	context: Pick<APIContext, "locals" | "request" | "url">,
	options: { mutation?: boolean } = {},
): Response | null {
	if (!context.locals.user) return errorResponse("AUTHENTICATION_REQUIRED", 401);
	if (!hasPermission(context.locals.user, "settings:manage")) {
		return errorResponse("OPERATOR_REQUIRED", 403);
	}
	if (options.mutation) {
		if (context.request.headers.get("X-EmDash-Request") !== "1") {
			return errorResponse("CSRF_HEADER_REQUIRED", 403);
		}
		const origin = context.request.headers.get("Origin");
		if (origin !== context.url.origin) return errorResponse("CSRF_ORIGIN_REJECTED", 403);
	}
	return null;
}

export function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Cache-Control": "private, no-store",
			"Content-Type": "application/json; charset=utf-8",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

export async function recentOperatorReauthentication(
	context: Pick<APIContext, "locals" | "session">,
	input: {
		instance_id: string;
		candidate_id: string;
		action: OperatorReauthenticationReceipt["action"];
		now: string;
	},
): Promise<OperatorReauthenticationReceipt | null> {
	if (!context.locals.user || !context.session) return null;
	const localMarker = (
		context.locals as typeof context.locals & {
			[LOCAL_OPERATOR_REAUTHENTICATION]?: LocalOperatorReauthentication;
		}
	)[LOCAL_OPERATOR_REAUTHENTICATION];
	const marker = localMarker ?? (await context.session.get("strongReauthentication"));
	if (!marker || marker.userId !== context.locals.user.id) return null;
	const verified = Date.parse(marker.verifiedAt);
	const now = Date.parse(input.now);
	if (!Number.isFinite(verified) || !Number.isFinite(now) || now - verified > 5 * 60 * 1_000) {
		return null;
	}
	return createOperatorReauthenticationReceipt({
		receipt_id: crypto.randomUUID(),
		operator_id: context.locals.user.id,
		instance_id: input.instance_id,
		action: input.action,
		candidate_id: input.candidate_id,
		reauthenticated_at: new Date(verified).toISOString(),
		expires_at: new Date(verified + 5 * 60 * 1_000).toISOString(),
	});
}

export function withLocalOperatorReauthentication<T extends APIContext>(
	context: T,
	env: SuperBoardSiteEnv,
	verifiedAt: string,
): T {
	if (env.SUPERBOARD_ENVIRONMENT !== "local" || !context.locals.user) return context;
	return {
		...context,
		locals: {
			...context.locals,
			[LOCAL_OPERATOR_REAUTHENTICATION]: {
				userId: context.locals.user.id,
				verifiedAt,
			},
		},
	};
}

function errorResponse(code: string, status: number): Response {
	return jsonResponse({ error: { code } }, status);
}
