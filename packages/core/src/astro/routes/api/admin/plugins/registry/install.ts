import { hostEnvFromVersions } from "@emdash-cms/registry-client/env";
import type { APIRoute } from "astro";
import { z } from "zod";

import { requirePerm } from "#api/authorize.js";
import { apiError, handleError, unwrapResult } from "#api/error.js";
import { handleRegistryInstall } from "#api/index.js";
import { checkMediaUsageActivationWriteFence } from "#api/media-usage-write-fence.js";
import { isParseError, parseBody } from "#api/parse.js";

import { VERSION } from "../../../../../../version.js";

export const prerender = false;

const installBodySchema = z.object({
	did: z
		.string()
		.min(1)
		.max(2048)
		.regex(/^did:[a-z]+:/, "Invalid DID"),
	slug: z
		.string()
		.min(1)
		.max(64)
		.regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, "Invalid slug"),
	version: z.string().min(1).max(64).optional(),
	acknowledgedDeclaredAccess: z.unknown().optional(),
	acknowledgedMcpTools: z.unknown().optional(),
});

export const POST: APIRoute = async ({ request, locals }) => {
	try {
		const { emdash, user } = locals;

		if (!emdash?.db) {
			return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
		}

		const denied = requirePerm(user, "plugins:manage");
		if (denied) return denied;

		const activationFence = await checkMediaUsageActivationWriteFence(emdash.db);
		if (activationFence) return activationFence;

		const body = await parseBody(request, installBodySchema);
		if (isParseError(body)) return body;

		const reservedPluginIds = new Set<string>([
			...emdash.configuredPlugins.map((p: { id: string }) => p.id),
			...(emdash.config.sandboxed ?? []).map((p: { id: string }) => p.id),
		]);

		const result = await handleRegistryInstall(
			emdash.db,
			emdash.storage,
			emdash.getSandboxRunner(),
			emdash.config.experimental?.registry,
			{
				did: body.did,
				slug: body.slug,
				version: body.version,
				acknowledgedDeclaredAccess: body.acknowledgedDeclaredAccess,
				acknowledgedMcpTools: body.acknowledgedMcpTools,
			},
			{
				configuredPluginIds: reservedPluginIds,
				hostEnv: hostEnvFromVersions(VERSION, emdash.config.astroVersion),
			},
		);

		if (!result.success) return unwrapResult(result);

		await emdash.syncRegistryPlugins();

		return unwrapResult(result, 201);
	} catch (error) {
		console.error("[registry-install] Unhandled error:", error);
		return handleError(error, "Failed to install plugin from registry", "INSTALL_FAILED");
	}
};
