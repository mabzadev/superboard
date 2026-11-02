import type { APIRoute } from "astro";

export const prerender = false;

import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";

import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { passkeyRenameBody } from "#api/schemas.js";

interface PasskeyResponse {
	id: string;
	name: string | null;
	deviceType: "singleDevice" | "multiDevice";
	backedUp: boolean;
	createdAt: string;
	lastUsedAt: string;
}

export const PATCH: APIRoute = async ({ params, request, locals }) => {
	const { emdash, user } = locals;
	const { id } = params;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	if (!user) {
		return apiError("NOT_AUTHENTICATED", "Not authenticated", 401);
	}

	if (!id) {
		return apiError("MISSING_PARAM", "Passkey ID is required", 400);
	}

	try {
		const adapter = createKyselyAdapter(emdash.db);

		const credential = await adapter.getCredentialById(id);

		if (!credential || credential.userId !== user.id) {
			return apiError("NOT_FOUND", "Passkey not found", 404);
		}

		const body = await parseBody(request, passkeyRenameBody);
		if (isParseError(body)) return body;

		const trimmedName = body.name.trim() || null;
		await adapter.updateCredentialName(id, trimmedName);

		const passkey: PasskeyResponse = {
			id: credential.id,
			name: trimmedName,
			deviceType: credential.deviceType,
			backedUp: credential.backedUp,
			createdAt: credential.createdAt.toISOString(),
			lastUsedAt: credential.lastUsedAt.toISOString(),
		};

		return apiSuccess({ passkey });
	} catch (error) {
		return handleError(error, "Failed to rename passkey", "PASSKEY_RENAME_ERROR");
	}
};

export const DELETE: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	const { id } = params;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	if (!user) {
		return apiError("NOT_AUTHENTICATED", "Not authenticated", 401);
	}

	if (!id) {
		return apiError("MISSING_PARAM", "Passkey ID is required", 400);
	}

	try {
		const adapter = createKyselyAdapter(emdash.db);

		const credential = await adapter.getCredentialById(id);

		if (!credential || credential.userId !== user.id) {
			return apiError("NOT_FOUND", "Passkey not found", 404);
		}

		const count = await adapter.countCredentialsByUserId(user.id);

		if (count <= 1) {
			return apiError("LAST_PASSKEY", "Cannot remove your last passkey", 400);
		}

		await adapter.deleteCredential(id);

		return apiSuccess({ success: true });
	} catch (error) {
		return handleError(error, "Failed to delete passkey", "PASSKEY_DELETE_ERROR");
	}
};
