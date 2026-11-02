import type { APIRoute } from "astro";

import { apiSuccess, handleError } from "#api/error.js";
import { getAuthMode } from "#auth/mode.js";
import { OptionsRepository } from "#db/repositories/options.js";

import { COMMIT, VERSION } from "../../../version.js";
import type { EmDashManifest } from "../../types.js";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	const { emdash } = locals;

	try {
		const emdashManifest = emdash ? await emdash.getManifest() : null;

		const authMode = getAuthMode(emdash?.config);

		let adminBranding = emdash?.config?.admin;

		if (!adminBranding?.siteName && emdash?.db) {
			try {
				const options = new OptionsRepository(emdash.db);
				const titles = await options.getMany<string>(["site:title", "emdash:site_title"]);
				const siteTitle = titles.get("site:title") || titles.get("emdash:site_title");
				if (siteTitle) {
					adminBranding = { ...adminBranding, siteName: siteTitle };
				}
			} catch {}
		}

		let signupEnabled = false;
		if (emdash?.db && authMode.type === "passkey") {
			try {
				const { sql } = await import("kysely");
				const result = await sql<{ cnt: unknown }>`
					SELECT COUNT(*) as cnt FROM allowed_domains WHERE enabled = 1
				`.execute(emdash.db);
				signupEnabled = Number(result.rows[0]?.cnt ?? 0) > 0;
			} catch {}
		}

		const manifest: EmDashManifest = emdashManifest
			? {
					...emdashManifest,
					authMode: authMode.type === "external" ? authMode.providerType : "passkey",
					signupEnabled,
					admin: adminBranding,
				}
			: {
					version: VERSION,
					commit: COMMIT,
					hash: "default",
					collections: {},
					plugins: {},
					taxonomies: [],
					authMode: "passkey",
					signupEnabled,
					admin: adminBranding,
				};

		return apiSuccess(manifest);
	} catch (error) {
		return handleError(error, "Failed to build manifest", "MANIFEST_BUILD_ERROR");
	}
};
