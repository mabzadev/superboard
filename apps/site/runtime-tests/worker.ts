import type { APIRoute } from "astro";

import { createConfiguredSuperBoardPlugin } from "../../../packages/supbrd-runtime-plugins/src/runtime.js";
import { POST as executeCommand } from "../src/pages/_superboard/api/plugins/[pluginId]/commands/[commandId].js";
import { GET as queryDataSource } from "../src/pages/_superboard/api/plugins/[pluginId]/data-sources/[dataSourceId].js";
import { POST as synchronizePlugins } from "../src/pages/_superboard/api/plugins/sync.js";
import { POST as activateRelease } from "../src/pages/_superboard/api/releases/activate.js";
import { POST as approveRelease } from "../src/pages/_superboard/api/releases/approve.js";
import { POST as compileRelease } from "../src/pages/_superboard/api/releases/compile.js";
import { POST as previewRelease } from "../src/pages/_superboard/api/releases/preview.js";
import { POST as createUserSlice } from "../src/pages/_superboard/api/releases/user-slice.js";
import { GET as siteHealth } from "../src/pages/_superboard/health.js";

const routes = new Map<string, APIRoute>([
	["GET /superboard-system/health", siteHealth],
	["POST /_emdash/api/superboard/plugins/sync", synchronizePlugins],
	["POST /_emdash/api/superboard/releases/user-slice", createUserSlice],
	["POST /_emdash/api/superboard/releases/compile", compileRelease],
	["POST /_emdash/api/superboard/releases/preview", previewRelease],
	["POST /_emdash/api/superboard/releases/approve", approveRelease],
	["POST /_emdash/api/superboard/releases/activate", activateRelease],
]);
const dataSourcePath = /^\/_emdash\/api\/superboard\/plugins\/([^/]+)\/data-sources\/([^/]+)$/u;
const commandPath = /^\/_emdash\/api\/superboard\/plugins\/([^/]+)\/commands\/([^/]+)$/u;
const pluginHealthPath = /^\/_emdash\/api\/plugins\/([^/]+)\/health$/u;

export default {
	async fetch(request, workerEnv) {
		const url = new URL(request.url);
		const dataSource = url.pathname.match(dataSourcePath);
		const command = url.pathname.match(commandPath);
		const pluginHealth = url.pathname.match(pluginHealthPath);
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
		const handler =
			(dataSource && request.method === "GET" ? queryDataSource : null) ??
			(command && request.method === "POST" ? executeCommand : null) ??
			routes.get(`${request.method} ${url.pathname}`);
		if (!handler) return Response.json({ error: { code: "ROUTE_NOT_FOUND" } }, { status: 404 });
		const operator = request.headers.get("X-Parity-Operator") === "1";
		const reauthenticated = request.headers.get("X-Parity-Reauthenticated") === "1";
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test Worker supplies the Astro fields consumed by real route handlers
		return handler({
			request,
			url,
			params: dataSource
				? {
						pluginId: decodeURIComponent(dataSource[1]!),
						dataSourceId: decodeURIComponent(dataSource[2]!),
					}
				: command
					? {
							pluginId: decodeURIComponent(command[1]!),
							commandId: decodeURIComponent(command[2]!),
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
				emdash: { setPluginStatus: async () => undefined },
			},
			session: {
				get: async () =>
					reauthenticated
						? { userId: "operator-1", verifiedAt: new Date(Date.now() - 1_000).toISOString() }
						: undefined,
			},
		} as never);
	},
} satisfies ExportedHandler<Cloudflare.Env>;
