import type { APIContext } from "astro";
import { env } from "cloudflare:test";
import { vi } from "vitest";

import { RawBindingD1Dialect } from "../../../packages/cloudflare/src/db/d1-dialect.js";
import { POST as createTaxonomy } from "../../../packages/core/src/astro/routes/api/taxonomies/index.js";
import { EmDashRuntime } from "../../../packages/core/src/emdash-runtime.js";
import { createConfiguredSuperBoardPlugin } from "../../../packages/supbrd-runtime-plugins/src/runtime.js";
import { POST as executeCommand } from "../src/pages/_superboard/api/plugins/[pluginId]/commands/[commandId].js";
import { GET as readSource } from "../src/pages/_superboard/api/plugins/[pluginId]/data-sources/[dataSourceId].js";
import { apiHeaders, type ApiOperation } from "./retirement-api-helpers.js";
vi.mock("virtual:emdash/config", () => ({ default: {} }));
vi.mock("virtual:emdash/wait-until", () => ({ waitUntil: undefined }));
vi.mock("virtual:emdash/scheduler", () => ({ createScheduler: null }));
vi.mock("virtual:emdash/env", () => ({ env: undefined }));
vi.mock("virtual:emdash/build", () => ({ buildTime: 0 }));
vi.mock("virtual:emdash/object-cache", () => ({
	createObjectCache: undefined,
	objectCacheConfig: {},
}));

export async function createCmsApi() {
	const runtime = await EmDashRuntime.create({
		config: {
			database: { entrypoint: `retirement-d1-${crypto.randomUUID()}`, config: {}, type: "sqlite" },
		},
		createDialect: () => new RawBindingD1Dialect({ database: env.DB }),
		plugins: [
			createConfiguredSuperBoardPlugin("supbrd-plug-content"),
			createConfiguredSuperBoardPlugin("supbrd-plug-settings"),
		],
		sandboxedPluginEntries: [],
		sandboxEnabled: false,
		createSandboxRunner: null,
		createScheduler: null,
	});
	const user = {
		id: "operator-1",
		email: "operator@example.com",
		name: "Operator",
		role: 50 as const,
		disabled: false,
	};
	const now = new Date().toISOString();
	await runtime.db
		.insertInto("users")
		.values({
			id: user.id,
			email: user.email,
			name: user.name,
			role: user.role,
			email_verified: 1,
			created_at: now,
			updated_at: now,
		})
		.onConflict((conflict) => conflict.column("id").doNothing())
		.execute();
	const context = (request: Request, params: Record<string, string>) => {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- this route fixture supplies the Astro fields consumed by the actual command and data-source handlers
		return {
			request,
			url: new URL(request.url),
			params,
			locals: { emdash: runtime, user },
			session: { get: async () => undefined, set: async () => undefined },
		} as unknown as APIContext;
	};
	return {
		runtime,
		command: (pluginId: string, id: string, operation: ApiOperation) => {
			const request = new Request(
				`https://site.example/_emdash/api/superboard/plugins/${pluginId}/commands/${pluginId}.command.${id}`,
				{
					method: "POST",
					headers: { ...apiHeaders, "Idempotency-Key": crypto.randomUUID() },
					body: JSON.stringify(operation),
				},
			);
			return executeCommand(context(request, { pluginId, commandId: `${pluginId}.command.${id}` }));
		},
		read: (pluginId: string, id: string, operation: ApiOperation) => {
			const url = new URL(
				`https://site.example/_emdash/api/superboard/plugins/${pluginId}/data-sources/${pluginId}.data_source.${id}`,
			);
			url.searchParams.set("request", JSON.stringify(operation));
			const request = new Request(url, { headers: apiHeaders });
			return readSource(
				context(request, { pluginId, dataSourceId: `${pluginId}.data_source.${id}` }),
			);
		},
		taxonomy: (body: unknown) => {
			const request = new Request("https://site.example/_emdash/api/taxonomies", {
				method: "POST",
				headers: apiHeaders,
				body: JSON.stringify(body),
			});
			return createTaxonomy(context(request, {}));
		},
		close: async () => {
			await runtime.stopCron();
			await runtime.db.destroy();
		},
	};
}
