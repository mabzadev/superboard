import type { APIRoute } from "astro";

export const prerender = false;

import { ulid } from "ulidx";

import { apiError, apiSuccess, handleError } from "#api/error.js";
import { escapeHtml } from "#api/escape.js";
import { deleteApiTokensByName, handleApiTokenCreate } from "#api/handlers/api-tokens.js";
import { getPublicOrigin } from "#api/public-url.js";
import { isSafeRedirect } from "#api/redirect.js";
import { OptionsRepository } from "#db/repositories/options.js";
import { repairContentMediaUsageCollection } from "#media/usage/content-repair.js";
import { applySeed } from "#seed/apply.js";
import { loadSeed } from "#seed/load.js";
import { validateSeed } from "#seed/validate.js";

const ROLE_ADMIN = 50;

const DEV_USER_EMAIL = "dev@emdash.local";
const DEV_USER_NAME = "Dev Admin";
const DEV_SITE_TITLE = "EmDash Dev Site";

async function handleDevBypass(context: Parameters<APIRoute>[0]): Promise<Response> {
	if (!import.meta.env.DEV) {
		return apiError("FORBIDDEN", "Dev bypass is only available in development mode", 403);
	}

	const { locals, url, session } = context;
	const { emdash } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	try {
		const contentParam = url.searchParams.get("content");
		const includeContent = contentParam !== "0" && contentParam !== "false";
		const seed = await loadSeed();
		const validation = validateSeed(seed);
		if (validation.valid) {
			const seedResult = await applySeed(emdash.db, seed, {
				includeContent,
				onConflict: "skip",
				storage: emdash.storage ?? undefined,
			});
			console.log(
				`[setup-dev-bypass] Seed applied: ${seedResult.collections.created} collections, ${seedResult.fields.created} fields`,
			);
			if (includeContent && seedResult.content.created + seedResult.content.updated > 0) {
				for (const collectionSlug of Object.keys(seed.content ?? {})) {
					const repair = await repairContentMediaUsageCollection(emdash.db, {
						collectionSlug,
					});
					if (repair.status !== "complete") {
						throw new Error(`Seeded Media Usage indexing failed for ${collectionSlug}`);
					}
				}
			}
		}

		const options = new OptionsRepository(emdash.db);

		const existingUser = await emdash.db
			.selectFrom("users")
			.selectAll()
			.where("email", "=", DEV_USER_EMAIL)
			.executeTakeFirst();

		let user: { id: string; email: string; name: string; role: number };
		let userCreated = false;

		if (!existingUser) {
			const now = new Date().toISOString();
			const newUser = {
				id: ulid(),
				email: DEV_USER_EMAIL,
				name: DEV_USER_NAME,
				role: ROLE_ADMIN,
				email_verified: 1,
				created_at: now,
				updated_at: now,
			};

			await emdash.db.insertInto("users").values(newUser).execute();

			user = {
				id: newUser.id,
				email: newUser.email,
				name: newUser.name,
				role: newUser.role,
			};
			userCreated = true;
			console.log("[setup-dev-bypass] Created dev admin user:", user.email);
		} else {
			user = {
				id: existingUser.id,
				email: existingUser.email,
				name: existingUser.name || DEV_USER_NAME,
				role: existingUser.role,
			};
		}

		const existingTitle = await options.get("emdash:site_title");
		if (!existingTitle) {
			await options.set("emdash:site_title", DEV_SITE_TITLE);
		}

		await options.set("emdash:site_url", getPublicOrigin(url, emdash?.config));

		await options.set("emdash:setup_complete", true);

		if (session) {
			session.set("user", { id: user.id });
		}

		let token: string | undefined;
		if (url.searchParams.has("token")) {
			await deleteApiTokensByName(emdash.db, user.id, "dev-bypass-token");
			const result = await handleApiTokenCreate(emdash.db, user.id, {
				name: "dev-bypass-token",
				scopes: [
					"content:read",
					"content:write",
					"media:read",
					"media:write",
					"schema:read",
					"schema:write",
					"admin",
				],
			});
			if (result.success) {
				token = result.data.token;
			}
		}

		const redirect = url.searchParams.get("redirect");

		if (redirect) {
			if (!isSafeRedirect(redirect)) {
				return apiError("INVALID_REDIRECT", "Redirect must be a local path", 400);
			}

			const safeRedirect = escapeHtml(redirect);
			const html = `<!DOCTYPE html>
<html>
<head>
	<meta http-equiv="refresh" content="0;url=${safeRedirect}">
</head>
<body>Redirecting...</body>
</html>`;
			return new Response(html, {
				status: 200,
				headers: { "Content-Type": "text/html" },
			});
		}

		return apiSuccess({
			success: true,
			message: "Dev setup complete",
			migrations: [],
			userCreated,
			user: {
				id: user.id,
				email: user.email,
				name: user.name,
				role: user.role,
			},
			...(token ? { token } : {}),
		});
	} catch (error) {
		return handleError(error, "Dev bypass failed", "DEV_BYPASS_ERROR");
	}
}

export const GET: APIRoute = handleDevBypass;
export const POST: APIRoute = handleDevBypass;
