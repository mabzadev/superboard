import type { APIRoute } from "astro";

export const prerender = false;

import { verifyMagicLink, MagicLinkError } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";

import { apiError } from "#api/error.js";
import { isSafeRedirect } from "#api/redirect.js";

export const GET: APIRoute = async ({ url, locals, session, redirect }) => {
	const { emdash } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const token = url.searchParams.get("token");

	if (!token) {
		return redirect("/_emdash/admin/login?error=missing_token");
	}

	try {
		const adapter = createKyselyAdapter(emdash.db);
		const user = await verifyMagicLink(adapter, token);

		void adapter.deleteExpiredTokens().catch(() => {});

		if (session) {
			session.set("user", { id: user.id });
			session.set("strongReauthentication", {
				userId: user.id,
				verifiedAt: new Date().toISOString(),
			});
		}

		const rawRedirect = url.searchParams.get("redirect");
		const redirectUrl = isSafeRedirect(rawRedirect) ? rawRedirect : "/_emdash/admin";

		return redirect(redirectUrl);
	} catch (error) {
		console.error("Magic link verify error:", error);

		if (error instanceof MagicLinkError) {
			switch (error.code) {
				case "invalid_token":
					return redirect("/_emdash/admin/login?error=invalid_link");
				case "token_expired":
					return redirect("/_emdash/admin/login?error=link_expired");
				case "user_not_found":
					return redirect("/_emdash/admin/login?error=user_not_found");
			}
		}

		return redirect("/_emdash/admin/login?error=verification_failed");
	}
};
