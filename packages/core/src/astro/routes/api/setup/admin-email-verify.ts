import type { APIRoute } from "astro";

export const prerender = false;

import { completeAdminEmailSetup } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";

import { finalizeSetup } from "#api/setup-complete.js";
import { OptionsRepository } from "#db/repositories/options.js";
import { withTransaction } from "#db/transaction.js";

export const GET: APIRoute = async ({ url, locals, session, redirect }) => {
	const { emdash } = locals;
	if (!emdash?.db) return redirect("/_emdash/admin/login?error=not_configured");
	const token = url.searchParams.get("token");
	if (!token) return redirect("/_emdash/admin/setup?error=missing_token");

	try {
		const user = await withTransaction(emdash.db, async (transaction) => {
			const adapter = createKyselyAdapter(transaction);
			if ((await adapter.countUsers()) > 0) throw new Error("SETUP_COMPLETE");
			const options = new OptionsRepository(transaction);
			const state = await options.get<{
				step?: string;
				email?: string;
				name?: string | null;
			}>("emdash:setup_state");
			if (state?.step !== "admin_email" || !state.email) {
				throw new Error("INVALID_STATE");
			}
			const created = await completeAdminEmailSetup(adapter, token, {
				name: state.name ?? undefined,
				expectedEmail: state.email,
			});
			await finalizeSetup(transaction);
			return created;
		});
		if (session) {
			const verifiedAt = new Date().toISOString();
			session.set("user", { id: user.id });
			session.set("strongReauthentication", { userId: user.id, verifiedAt });
		}
		return redirect("/_emdash/admin");
	} catch (error) {
		console.error("Email setup verification failed", error);
		return redirect("/_emdash/admin/setup?error=invalid_or_expired_link");
	}
};
