import { applicationUserOperation } from "@superboard/contracts/application-plugin-api";
import { runPluginTask, PluginTaskUnavailable } from "@superboard/contracts/plugin-task";
import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import type { Context } from "hono";

import { resolveSdkProjectContext } from "../lib/domain-modules.js";
import { resolveSiteOperatorInstance } from "../lib/site-operator-scope.js";
import type { Env } from "../types.js";

export async function applicationPluginApi(c: Context<{ Bindings: Env }>): Promise<Response> {
	const kind = c.req.param("kind");
	const id = c.req.param("id");
	const operation = applicationUserOperation(kind ?? "", id ?? "");
	if (!operation || operation.method !== c.req.method)
		return failure(404, "APPLICATION_OPERATION_NOT_FOUND");
	if (!c.env.IDENTITY_SERVICE || !c.env.MODULE_INTERNAL_TOKEN)
		return failure(503, "IDENTITY_WORKER_UNAVAILABLE");
	const resolved = await resolveSdkProjectContext(c.env.DB, c.req.raw, c.env);
	if (!resolved.ok) return failure(resolved.status, resolved.code);
	const instance = await resolveSiteOperatorInstance(c.env.DB, c.env.SUPERBOARD_TARGET ?? "");
	if (!instance || instance !== resolved.context.instanceId)
		return failure(403, "APPLICATION_INSTANCE_FORBIDDEN");
	try {
		const result = await runPluginTask(
			c.env,
			"supbrd-plug-user",
			{ kind: "runtime", task_id: `application:${crypto.randomUUID()}`, duration_ms: 30000 },
			async (_checkpoint, signal) => {
				const path = `/internal/v1/application-plugin/${operation.kind}/${operation.id}`;
				const headers = await createProjectContextHeaders(
					{
						...resolved.context,
						actorId: 0,
						role: "sdk",
						requestId: crypto.randomUUID(),
						issuedAt: Math.floor(Date.now() / 1000),
						module: "identity",
						method: operation.method,
						pathname: path,
					},
					c.env.MODULE_INTERNAL_TOKEN!,
				);
				headers.set("Content-Type", "application/json");
				const bearer = c.req.header("Authorization");
				if (bearer) headers.set("Authorization", bearer);
				const key = c.req.header("Idempotency-Key");
				if (key) headers.set("Idempotency-Key", key);
				return c.env.IDENTITY_SERVICE!.fetch(
					new Request(`https://identity.internal${path}`, {
						method: operation.method,
						headers,
						...(operation.method === "POST" ? { body: c.req.raw.body } : {}),
						signal,
					}),
				);
			},
		);
		return result.ran ? result.value : failure(404, "PLUGIN_NOT_ACTIVE");
	} catch (error) {
		if (error instanceof PluginTaskUnavailable) return failure(error.status, error.code);
		console.error("[application-plugin] identity request failed", error);
		return failure(503, "APPLICATION_IDENTITY_UNAVAILABLE");
	}
}
function failure(status: number, code: string) {
	return Response.json(
		{ error: { code, message: code } },
		{ status, headers: { "Cache-Control": "no-store" } },
	);
}
