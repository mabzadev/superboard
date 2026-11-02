import type { APIRoute } from "astro";
import { z } from "zod";

import { apiError, handleError } from "#api/error.js";
import { handleDeviceTokenExchange, handleTokenRefresh } from "#api/handlers/device-flow.js";
import { handleAuthorizationCodeExchange } from "#api/handlers/oauth-authorization.js";

export const prerender = false;

async function parseTokenBody(request: Request): Promise<Record<string, string>> {
	const contentType = request.headers.get("content-type") ?? "";

	if (contentType.includes("application/x-www-form-urlencoded")) {
		const text = await request.text();
		const params = new URLSearchParams(text);
		const result: Record<string, string> = {};
		for (const [key, value] of params) {
			result[key] = value;
		}
		return result;
	}

	try {
		const json = Object(await request.json()) as Record<string, unknown>;
		const result: Record<string, string> = {};
		for (const [key, value] of Object.entries(json)) {
			if (typeof value === "string") {
				result[key] = value;
			} else if (typeof value === "number") {
				result[key] = String(value);
			}
		}
		return result;
	} catch {
		return {};
	}
}

const authCodeSchema = z.object({
	grant_type: z.literal("authorization_code"),
	code: z.string().min(1),
	redirect_uri: z.string().min(1),
	client_id: z.string().min(1),
	code_verifier: z.string().min(43).max(128),
	resource: z.string().optional(),
});

const deviceCodeSchema = z.object({
	grant_type: z.literal("urn:ietf:params:oauth:grant-type:device_code"),
	device_code: z.string().min(1),
});

const refreshSchema = z.object({
	grant_type: z.literal("refresh_token"),
	refresh_token: z.string().min(1),
});

export const OPTIONS: APIRoute = () => {
	return new Response(null, { status: 204, headers: OAUTH_PREFLIGHT_HEADERS });
};

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	try {
		const body = await parseTokenBody(request);
		const grantType = body.grant_type;

		if (!grantType) {
			return oauthError("invalid_request", "grant_type is required", 400);
		}

		switch (grantType) {
			case "authorization_code": {
				const parsed = authCodeSchema.safeParse(body);
				if (!parsed.success) {
					return oauthError("invalid_request", formatZodError(parsed.error), 400);
				}

				const result = await handleAuthorizationCodeExchange(emdash.db, parsed.data);
				if (!result.success) {
					const err = result.error ?? { code: "unknown", message: "Unknown error" };
					return oauthError(err.code, err.message, 400);
				}
				return oauthSuccess(result.data);
			}

			case "urn:ietf:params:oauth:grant-type:device_code": {
				const parsed = deviceCodeSchema.safeParse(body);
				if (!parsed.success) {
					return oauthError("invalid_request", formatZodError(parsed.error), 400);
				}

				const result = await handleDeviceTokenExchange(emdash.db, parsed.data);
				if (!result.success) {
					const err = result.error ?? { code: "unknown", message: "Unknown error" };
					if (result.deviceFlowError) {
						return oauthError(result.deviceFlowError, err.message, 400);
					}
					return oauthError(err.code, err.message, 400);
				}
				return oauthSuccess(result.data);
			}

			case "refresh_token": {
				const parsed = refreshSchema.safeParse(body);
				if (!parsed.success) {
					return oauthError("invalid_request", formatZodError(parsed.error), 400);
				}

				const result = await handleTokenRefresh(emdash.db, parsed.data);
				if (!result.success) {
					const err = result.error ?? { code: "unknown", message: "Unknown error" };
					return oauthError(err.code, err.message, 400);
				}
				return oauthSuccess(result.data);
			}

			default:
				return oauthError("unsupported_grant_type", `Unsupported grant_type: ${grantType}`, 400);
		}
	} catch (error) {
		return handleError(error, "Failed to process token request", "TOKEN_ERROR");
	}
};

const OAUTH_TOKEN_HEADERS: HeadersInit = {
	"Content-Type": "application/json",
	"Cache-Control": "no-store",
	Pragma: "no-cache",
	"Access-Control-Allow-Origin": "*",
};

const OAUTH_PREFLIGHT_HEADERS: HeadersInit = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Max-Age": "86400",
};

function oauthSuccess(data: unknown): Response {
	return Response.json(data, { headers: OAUTH_TOKEN_HEADERS });
}

function oauthError(error: string, description: string, status: number): Response {
	return Response.json(
		{ error, error_description: description },
		{ status, headers: OAUTH_TOKEN_HEADERS },
	);
}

function formatZodError(error: z.ZodError): string {
	return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}
