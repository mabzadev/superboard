import type { APIRoute } from "astro";

export const prerender = false;

import { Role, roleFromLevel } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";

import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { allowedDomainUpdateBody } from "#api/schemas.js";

export const PATCH: APIRoute = async ({ params, request, locals }) => {
	const { emdash, user } = locals;
	const { domain } = params;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "Database not configured", 500);
	}

	if (!domain) {
		return apiError("VALIDATION_ERROR", "Domain is required", 400);
	}

	if (!user || user.role < Role.ADMIN) {
		return apiError("FORBIDDEN", "Admin privileges required", 403);
	}

	const adapter = createKyselyAdapter(emdash.db);

	try {
		const body = await parseBody(request, allowedDomainUpdateBody);
		if (isParseError(body)) return body;

		const existing = await adapter.getAllowedDomain(domain);
		if (!existing) {
			return apiError("NOT_FOUND", "Domain not found", 404);
		}

		const defaultRole = body.defaultRole;

		const enabled = body.enabled ?? existing.enabled;
		await adapter.updateAllowedDomain(domain, enabled, defaultRole);

		const updated = await adapter.getAllowedDomain(domain);

		return apiSuccess({
			success: true,
			domain: updated
				? {
						domain: updated.domain,
						defaultRole: updated.defaultRole,
						roleName: roleFromLevel(updated.defaultRole),
						enabled: updated.enabled,
						createdAt: updated.createdAt.toISOString(),
					}
				: null,
		});
	} catch (error) {
		return handleError(error, "Failed to update allowed domain", "DOMAIN_UPDATE_ERROR");
	}
};

export const DELETE: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	const { domain } = params;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "Database not configured", 500);
	}

	if (!domain) {
		return apiError("VALIDATION_ERROR", "Domain is required", 400);
	}

	if (!user || user.role < Role.ADMIN) {
		return apiError("FORBIDDEN", "Admin privileges required", 403);
	}

	const adapter = createKyselyAdapter(emdash.db);

	try {
		const existing = await adapter.getAllowedDomain(domain);
		if (!existing) {
			return apiError("NOT_FOUND", "Domain not found", 404);
		}

		await adapter.deleteAllowedDomain(domain);

		return apiSuccess({ success: true });
	} catch (error) {
		return handleError(error, "Failed to delete allowed domain", "DOMAIN_DELETE_ERROR");
	}
};
