import type { User } from "@emdash-cms/auth";
import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, apiSuccess, handleError } from "#api/error.js";
import {
	generateSnapshot,
	parsePreviewSignatureHeader,
	verifyPreviewSignature,
} from "#api/handlers/snapshot.js";
import { getPublicOrigin } from "#api/public-url.js";
import { resolveSecretsCached } from "#config/secrets.js";

import { resolveSessionUser } from "../../session-user.js";

export const prerender = false;

export const GET: APIRoute = async ({ request, locals, url, session }) => {
	const { emdash } = locals;
	let user: User | undefined = (locals as { user?: User }).user;
	if (!user && session && emdash?.db) {
		try {
			const { createKyselyAdapter } = await import("@emdash-cms/auth/adapters/kysely");
			const sessionUser = await resolveSessionUser(session);
			if (sessionUser?.id) {
				const adapter = createKyselyAdapter(emdash.db);
				const resolved = await adapter.getUserById(sessionUser.id);
				if (resolved && !resolved.disabled) {
					user = resolved;
				}
			}
		} catch {}
	}

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const previewSig = request.headers.get("X-Preview-Signature");
	let authorized = false;

	if (previewSig) {
		const { previewSecret: secret, previewSecretSource } = await resolveSecretsCached(emdash.db);
		const parsed = parsePreviewSignatureHeader(previewSig);
		if (!parsed) {
			console.warn("[snapshot] Failed to parse X-Preview-Signature header");
		} else {
			authorized = await verifyPreviewSignature(parsed.source, parsed.exp, parsed.sig, secret);
			if (!authorized) {
				const fields: Record<string, unknown> = {
					source: parsed.source,
					exp: parsed.exp,
					expired: parsed.exp < Date.now() / 1000,
					secretSource: previewSecretSource,
				};
				if (previewSecretSource === "db") {
					fields.hint =
						"Set EMDASH_PREVIEW_SECRET in both this process and the signing process to share secrets across deployments";
				}
				console.warn("[snapshot] Preview signature verification failed", fields);
			}
		}
	}

	if (!authorized) {
		const contentDenied = requirePerm(user, "content:read");
		if (contentDenied) return contentDenied;
		const schemaDenied = requirePerm(user, "schema:read");
		if (schemaDenied) return schemaDenied;
	}

	try {
		const includeDrafts = url.searchParams.get("drafts") === "true";
		const snapshot = await generateSnapshot(emdash.db, {
			includeDrafts,
			origin: getPublicOrigin(url, emdash.config),
		});

		return apiSuccess(snapshot);
	} catch (error) {
		return handleError(error, "Failed to generate snapshot", "SNAPSHOT_ERROR");
	}
};
