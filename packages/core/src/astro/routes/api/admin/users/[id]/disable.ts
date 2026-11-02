import { Role } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { APIRoute } from "astro";

import { apiError, apiSuccess, handleError } from "#api/error.js";
import { withTransaction } from "#db/transaction.js";

export const prerender = false;

export const POST: APIRoute = async ({ params, locals }) => {
	const { emdash, user: currentUser } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "Database not configured", 500);
	}

	if (!currentUser || currentUser.role < Role.ADMIN) {
		return apiError("FORBIDDEN", "Admin privileges required", 403);
	}

	const adapter = createKyselyAdapter(emdash.db);

	const { id } = params;

	if (!id) {
		return apiError("VALIDATION_ERROR", "User ID required", 400);
	}

	if (id === currentUser.id) {
		return apiError("VALIDATION_ERROR", "Cannot disable your own account", 400);
	}

	try {
		const targetUser = await adapter.getUserById(id);
		if (!targetUser) {
			return apiError("NOT_FOUND", "User not found", 404);
		}

		const lastAdminBlocked = await withTransaction(emdash.db, async (trx) => {
			const trxAdapter = createKyselyAdapter(trx);
			if (targetUser.role === Role.ADMIN) {
				const adminCount = await trxAdapter.countAdmins();
				if (adminCount <= 1) return true;
			}
			await trxAdapter.updateUser(id, { disabled: true });
			return false;
		});

		if (lastAdminBlocked) {
			return apiError(
				"VALIDATION_ERROR",
				"Cannot disable the last admin. Promote another user first.",
				400,
			);
		}

		await emdash.db.deleteFrom("_emdash_oauth_tokens").where("user_id", "=", id).execute();

		return apiSuccess({ success: true });
	} catch (error) {
		return handleError(error, "Failed to disable user", "USER_DISABLE_ERROR");
	}
};
