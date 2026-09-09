import type { APIRoute } from "astro";
import { WorkerEntrypoint } from "cloudflare:workers";

import { createConfiguredSuperBoardPlugin } from "../../../packages/supbrd-runtime-plugins/src/runtime.js";
import { onRequest as applicationPluginMiddleware } from "../src/application-plugin-middleware.js";
import { POST as initializeOperatorContext } from "../src/pages/_superboard/api/operator-context.js";
import { POST as executePluginCommand } from "../src/pages/_superboard/api/plugins/[pluginId]/commands/[commandId].js";
import { POST as postDataSource } from "../src/pages/_superboard/api/plugins/[pluginId]/data-sources/[dataSourceId].js";
import { GET as queryDataSource } from "../src/pages/_superboard/api/plugins/[pluginId]/data-sources/[dataSourceId].js";
import { POST as disableManagedPlugin } from "../src/pages/_superboard/api/plugins/[pluginId]/disable.js";
import { POST as enableManagedPlugin } from "../src/pages/_superboard/api/plugins/[pluginId]/enable.js";
import { POST as synchronizePlugins } from "../src/pages/_superboard/api/plugins/sync.js";
import { POST as activateRelease } from "../src/pages/_superboard/api/releases/activate.js";
import { POST as approveRelease } from "../src/pages/_superboard/api/releases/approve.js";
import { POST as compileRelease } from "../src/pages/_superboard/api/releases/compile.js";
import { POST as previewRelease } from "../src/pages/_superboard/api/releases/preview.js";
import { POST as createUserSlice } from "../src/pages/_superboard/api/releases/user-slice.js";
import { GET as siteHealth } from "../src/pages/_superboard/health.js";
import { ALL as operatorApiV1 } from "../src/pages/api/v1/[...path].js";
import { POST as taskAuthority } from "../src/pages/superboard-system/plugin-task-authority.js";
import { onRequest as packageMiddleware } from "../src/plugin-packages-middleware.js";
import { dispatchLifecycleApi, pluginTaskContext } from "./lifecycle-health-services.js";

const routes = new Map<string, APIRoute>([
	["POST /_emdash/api/superboard/operator-context", initializeOperatorContext],
	["GET /superboard-system/health", siteHealth],
	["POST /superboard-system/plugin-task-authority", taskAuthority],
	["POST /_emdash/api/superboard/plugins/sync", synchronizePlugins],
	["POST /_emdash/api/superboard/releases/user-slice", createUserSlice],
	["POST /_emdash/api/superboard/releases/compile", compileRelease],
	["POST /_emdash/api/superboard/releases/preview", previewRelease],
	["POST /_emdash/api/superboard/releases/approve", approveRelease],
	["POST /_emdash/api/superboard/releases/activate", activateRelease],
]);
const commandPath = /^\/_emdash\/api\/superboard\/plugins\/([^/]+)\/commands\/([^/]+)$/u;
const dataSourcePath = /^\/_emdash\/api\/superboard\/plugins\/([^/]+)\/data-sources\/([^/]+)$/u;
const managedPluginActionPath = /^\/_emdash\/api\/superboard\/plugins\/([^/]+)\/(enable|disable)$/u;
const pluginHealthPath = /^\/_emdash\/api\/plugins\/([^/]+)\/health$/u;
const packageAdminPath = /^\/_emdash\/api\/plugins\/([^/]+)\/admin$/u;

export default {
	async fetch(request, workerEnv) {
		const url = new URL(request.url);
		const dataSource = url.pathname.match(dataSourcePath);
		const command = url.pathname.match(commandPath);
		const managedPluginAction = url.pathname.match(managedPluginActionPath);
		const pluginHealth = url.pathname.match(pluginHealthPath);
		const packageAdmin = url.pathname.match(packageAdminPath);
		if (pluginHealth && request.method === "GET") {
			const plugin = createConfiguredSuperBoardPlugin(decodeURIComponent(pluginHealth[1]!));
			return Response.json(
				await plugin.routes.health.handler({
					kv: {
						get: (key: string) => workerEnv.RELEASE_CACHE.get(key, "json"),
					},
				}),
			);
		}
		const handler: APIRoute | undefined =
			(packageAdmin && request.method === "POST"
				? (context) =>
						packageMiddleware(context, async () =>
							Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 }),
						)
				: null) ??
			(url.pathname.startsWith("/api/v1/") ? operatorApiV1 : null) ??
			(managedPluginAction?.[2] === "enable" && request.method === "POST"
				? enableManagedPlugin
				: null) ??
			(managedPluginAction?.[2] === "disable" && request.method === "POST"
				? disableManagedPlugin
				: null) ??
			(command && request.method === "POST" ? executePluginCommand : null) ??
			(dataSource && request.method === "POST" ? postDataSource : null) ??
			(dataSource && request.method === "GET" ? queryDataSource : null) ??
			routes.get(`${request.method} ${url.pathname}`);
		if (!handler) return Response.json({ error: { code: "ROUTE_NOT_FOUND" } }, { status: 404 });
		const operator = request.headers.get("X-Parity-Operator") === "1";
		const reauthenticated = request.headers.get("X-Parity-Reauthenticated") === "1";
		let strongReauthentication = reauthenticated
			? { userId: "operator-1", verifiedAt: new Date(Date.now() - 1_000).toISOString() }
			: undefined;
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test Worker supplies the Astro fields consumed by real route handlers
		const context = {
			request,
			url,
			params: command
				? { pluginId: decodeURIComponent(command[1]!), commandId: decodeURIComponent(command[2]!) }
				: managedPluginAction
					? { pluginId: decodeURIComponent(managedPluginAction[1]!) }
					: dataSource
						? {
								pluginId: decodeURIComponent(dataSource[1]!),
								dataSourceId: decodeURIComponent(dataSource[2]!),
							}
						: {},
			locals: {
				user: operator
					? {
							id: "operator-1",
							email: "operator@example.com",
							name: "Operator",
							role: 50,
							disabled: false,
						}
					: undefined,
				emdash: {
					setPluginStatus: async () => undefined,
					inspectPluginHealth: async (pluginId: string) => ({
						success: true,
						data: await createConfiguredSuperBoardPlugin(pluginId).routes.health.handler({
							kv: { get: (key: string) => workerEnv.RELEASE_CACHE.get(key, "json") },
						}),
					}),
				},
			},
			session: {
				get: async () => strongReauthentication,
				set: (_key: string, value: typeof strongReauthentication) => {
					strongReauthentication = value;
				},
			},
		} as never;
		return applicationPluginMiddleware(context, async () => await handler(context));
	},
} satisfies ExportedHandler<Cloudflare.Env>;

export class LifecycleApi extends WorkerEntrypoint {
	async fetch(request: Request) {
		return dispatchLifecycleApi(request, { ...this.env }, this.ctx);
	}
}

export { PluginAutonomyWorkflow } from "./plugin-autonomy-workflow.js";
export class WorkflowLifecycleApi extends WorkerEntrypoint {
	async fetch(request: Request) {
		return dispatchLifecycleApi(
			request,
			{ ...this.env },
			pluginTaskContext(this.ctx, "supbrd-plugmod-flows"),
		);
	}
}

export {
	RetirementFlowUserRuntime,
	RetirementFlowRealtimeHub,
	RetirementFlowMaintenanceExecution,
} from "./retirement-flow-runtime.js";

export { RetirementSupportConversationRoom } from "./retirement-support-runtime.js";
