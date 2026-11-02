import type { APIRoute } from "astro";

export const prerender = false;

import { createInvite, InviteError, Role } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";

import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { inviteCreateBody } from "#api/schemas.js";
import { getSiteBaseUrl } from "#api/site-url.js";
import { OptionsRepository } from "#db/repositories/options.js";

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	if (!user || user.role < Role.ADMIN) {
		return apiError("FORBIDDEN", "Admin privileges required", 403);
	}

	const adapter = createKyselyAdapter(emdash.db);

	try {
		const body = await parseBody(request, inviteCreateBody);
		if (isParseError(body)) return body;

		const role = body.role ?? Role.AUTHOR;

		const options = new OptionsRepository(emdash.db);
		const siteName = (await options.get<string>("emdash:site_title")) || "EmDash";

		const baseUrl = await getSiteBaseUrl(emdash.db, request, emdash.config);

		const emailSend = emdash.email?.isAvailable()
			? (message: { to: string; subject: string; text: string; html?: string }) =>
					emdash.email!.send(message, "system")
			: undefined;

		const result = await createInvite(
			{
				baseUrl,
				siteName,
				email: emailSend,
			},
			adapter,
			body.email,
			role,
			user.id,
		);

		if (emailSend) {
			return apiSuccess({
				success: true,
				message: `Invite sent to ${body.email}`,
			});
		}

		return apiSuccess(
			{
				success: true,
				message: "Invite created. No email provider configured — share the link manually.",
				inviteUrl: result.url,
			},
			200,
		);
	} catch (error) {
		if (error instanceof InviteError) {
			const statusMap: Record<string, number> = {
				user_exists: 409,
				invalid_token: 400,
				token_expired: 400,
			};
			return apiError(error.code.toUpperCase(), error.message, statusMap[error.code] ?? 400);
		}

		return handleError(error, "Failed to create invite", "INVITE_CREATE_ERROR");
	}
};
