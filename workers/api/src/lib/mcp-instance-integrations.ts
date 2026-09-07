import { runPluginTask, PluginTaskUnavailable } from "@superboard/contracts/plugin-task";
import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import type { SiteOperatorIdentity } from "@superboard/contracts/site-operator";

import type { Env } from "../types.js";

interface Project {
	id: number;
	instance_id: number;
	is_test: number;
}
type ObjectValue = Record<string, unknown>;

export async function dispatchMcpInstanceIntegration(
	env: Env,
	operator: SiteOperatorIdentity,
	instanceId: number,
	operation: "usage" | "sdk",
	input: ObjectValue = {},
): Promise<Response> {
	const pluginId = operation === "usage" ? "supbrd-plugmod-analytics" : "supbrd-plug-settings";
	try {
		const execution = await runPluginTask(
			env,
			pluginId,
			{ kind: "runtime", task_id: `mcp-${operation}:${crypto.randomUUID()}`, duration_ms: 30000 },
			async () => {
				const projects = (
					await env.DB.prepare(
						"SELECT id,instance_id,is_test FROM projects WHERE instance_id=? ORDER BY is_test,id",
					)
						.bind(instanceId)
						.all<Project>()
				).results;
				if (!projects.length) return json({ error: "Instance projects are unavailable" }, 404);
				const module = operation === "usage" ? "analytics" : "app";
				const binding = operation === "usage" ? env.ANALYTICS_MODULE : env.APP_MODULE;
				if (!binding || !env.MODULE_INTERNAL_TOKEN)
					return json({ error: "Required integration is unavailable" }, 503);
				async function call(project: Project, path: string, method = "GET", body?: unknown) {
					const url = new URL(`/internal/v1${path}`, "https://module.internal");
					const headers = await createProjectContextHeaders(
						{
							module,
							method,
							pathname: url.pathname,
							projectId: project.id,
							instanceId,
							projectRef: `${instanceId}-${project.is_test ? "test" : "prod"}`,
							environment: project.is_test ? "test" : "production",
							actorId: 0,
							operatorId: operator.operator_id,
							role: operator.role === 50 ? "owner" : "admin",
							requestId: crypto.randomUUID(),
							issuedAt: Math.floor(Date.now() / 1000),
						},
						env.MODULE_INTERNAL_TOKEN!,
					);
					headers.set("Content-Type", "application/json");
					headers.set("Idempotency-Key", crypto.randomUUID());
					const response = await binding!.fetch(
						new Request(url, {
							method,
							headers,
							...(body === undefined ? {} : { body: JSON.stringify(body) }),
							signal: AbortSignal.timeout(10000),
						}),
					);
					const payload = await readJsonObjectLimited(response, 1048576);
					if (!response.ok) throw new Error(`Plugin integration returned ${response.status}`);
					return object(payload.data);
				}
				if (operation === "usage") {
					const to = new Date().toISOString();
					const from = new Date(Date.now() - 30 * 86400000).toISOString();
					const environments = await Promise.all(
						projects.map(async (project) => ({
							project_id: `${instanceId}-${project.is_test ? "test" : "prod"}`,
							mau: Number(
								(await call(project, `/overview?${new URLSearchParams({ from, to })}`))
									?.unique_subjects ?? 0,
							),
						})),
					);
					return json({
						usage: {
							instance_id: String(instanceId),
							mau: environments.reduce((sum, item) => sum + item.mau, 0),
							unit: "project-scoped active identities",
							environments,
						},
					});
				}
				const changes: Record<string, ObjectValue> = {};
				if (
					input.ios_bundle_id !== undefined ||
					input.ios_team_id !== undefined ||
					input.ios_app_store_id !== undefined
				)
					changes.ios = {
						bundle_id: input.ios_bundle_id,
						team_id: input.ios_team_id,
						app_store_id: input.ios_app_store_id,
					};
				if (
					input.android_package_name !== undefined ||
					input.android_sha256_fingerprints !== undefined
				)
					changes.android = {
						package_name: input.android_package_name,
						sha256: Array.isArray(input.android_sha256_fingerprints)
							? input.android_sha256_fingerprints.join(",")
							: undefined,
					};
				if (typeof input.desktop_url === "string")
					changes.desktop = {
						domain: new URL(input.desktop_url).hostname,
						store_url: input.desktop_url,
					};
				if (!Object.keys(changes).length)
					return json({ error: "No SDK configuration changes were supplied" }, 422);
				const configurations: Record<string, unknown> = {};
				const environments: Array<{
					project_id: string;
					platform: string;
					status: "configured" | "unavailable";
				}> = [];
				for (const project of projects) {
					for (const [platform, changed] of Object.entries(changes)) {
						try {
							const current = await call(project, `/setup/${platform}`);
							const previous = object(current?.configuration) ?? {};
							const update = {
								...previous,
								...Object.fromEntries(
									Object.entries(changed).filter(([, value]) => value !== undefined),
								),
							};
							const saved = await call(project, `/setup/${platform}`, "PUT", update);
							if (!project.is_test)
								configurations[platform] = {
									enabled: true,
									configuration: saved?.configuration ?? update,
								};
							environments.push({
								project_id: `${instanceId}-${project.is_test ? "test" : "prod"}`,
								platform,
								status: "configured",
							});
						} catch {
							environments.push({
								project_id: `${instanceId}-${project.is_test ? "test" : "prod"}`,
								platform,
								status: "unavailable",
							});
						}
					}
				}
				if (environments.some((item) => item.status === "unavailable")) {
					const partial = environments.some((item) => item.status === "configured");
					return json(
						{
							error: `SDK configuration ${partial ? "was partially applied" : "is unavailable"}: ${environments.map((item) => `${item.project_id}/${item.platform} ${item.status}`).join("; ")}. Retry to resume.`,
							configurations,
							environments,
						},
						503,
					);
				}
				return json({ configurations, environments });
			},
		);
		return execution.ran ? execution.value : json({ error: "Required plugin is disabled" }, 404);
	} catch (error) {
		if (error instanceof PluginTaskUnavailable) return json({ error: error.code }, error.status);
		console.error("[mcp-instance-integration] request failed", error);
		return json({ error: "Plugin integration is unavailable" }, 503);
	}
}
function object(value: unknown): ObjectValue | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as ObjectValue)
		: null;
}
function json(value: unknown, status = 200) {
	return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
