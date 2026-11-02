import type { ResolvedPlugin, PluginDescriptor } from "emdash";
import { definePlugin } from "emdash";

import { version } from "../package.json";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) return undefined;
	const v = value[key];
	return typeof v === "string" ? v : undefined;
}

function getNumber(value: unknown, key: string): number | undefined {
	if (!isRecord(value)) return undefined;
	const v = value[key];
	return typeof v === "number" ? v : undefined;
}

export interface ApiTestPluginOptions {
	testUrl?: string;
}

export function apiTestPlugin(
	options: ApiTestPluginOptions = {},
): PluginDescriptor<ApiTestPluginOptions> {
	return {
		id: "api-test",
		version,
		entrypoint: "@emdash-cms/plugin-api-test",
		options,
		adminEntry: "@emdash-cms/plugin-api-test/admin",
		adminPages: [{ path: "/test", label: "API Tests", icon: "code" }],
		adminWidgets: [{ id: "api-status", title: "API Status", size: "half" }],
	};
}

export function createPlugin(_options: ApiTestPluginOptions = {}): ResolvedPlugin {
	return definePlugin({
		id: "api-test",
		version,

		capabilities: ["content:read", "content:write", "media:read", "media:write", "network:request"],

		allowedHosts: ["httpbin.org", "*.httpbin.org", "jsonplaceholder.typicode.com"],

		storage: {
			logs: {
				indexes: ["timestamp", "level", ["level", "timestamp"]],
			},
			counters: {
				indexes: ["name"],
			},
		},

		admin: {
			entry: "@emdash-cms/plugin-api-test/admin",
			pages: [{ path: "/test", label: "API Tests", icon: "code" }],
			widgets: [{ id: "api-status", title: "API Status", size: "half" }],
		},

		routes: {
			"plugin/info": {
				handler: async (ctx) => {
					return {
						id: ctx.plugin.id,
						version: ctx.plugin.version,
					};
				},
			},

			"log/test": {
				handler: async (ctx) => {
					ctx.log.debug("Debug message from api-test", { route: "log/test" });
					ctx.log.info("Info message from api-test", { route: "log/test" });
					ctx.log.warn("Warning message from api-test", { route: "log/test" });
					ctx.log.error("Error message from api-test", { route: "log/test" });
					return { success: true, message: "Logged at all levels" };
				},
			},

			"kv/get": {
				handler: async (ctx) => {
					const key = getString(ctx.input, "key") ?? "test-key";
					const value = await ctx.kv.get(key);
					return { key, value };
				},
			},

			"kv/set": {
				handler: async (ctx) => {
					const key = getString(ctx.input, "key") ?? "";
					const value = isRecord(ctx.input) ? ctx.input.value : undefined;
					await ctx.kv.set(key, value);
					return { success: true, key, value };
				},
			},

			"kv/delete": {
				handler: async (ctx) => {
					const key = getString(ctx.input, "key") ?? "test-key";
					const deleted = await ctx.kv.delete(key);
					return { key, deleted };
				},
			},

			"kv/list": {
				handler: async (ctx) => {
					const prefix = getString(ctx.input, "prefix");
					const entries = await ctx.kv.list(prefix);
					return { prefix, entries, count: entries.length };
				},
			},

			"storage/logs/put": {
				handler: async (ctx) => {
					const id = `log-${Date.now()}`;
					const data = {
						timestamp: new Date().toISOString(),
						level: getString(ctx.input, "level") ?? "info",
						message: getString(ctx.input, "message") ?? "Test log entry",
					};
					await ctx.storage.logs.put(id, data);
					return { id, data };
				},
			},

			"storage/logs/get": {
				handler: async (ctx) => {
					const id = getString(ctx.input, "id");
					if (!id) return { error: "id required" };
					const data = await ctx.storage.logs.get(id);
					return { id, data, exists: data !== null };
				},
			},

			"storage/logs/query": {
				handler: async (ctx) => {
					const level = getString(ctx.input, "level");
					const limit = getNumber(ctx.input, "limit");
					const cursor = getString(ctx.input, "cursor");
					const result = await ctx.storage.logs.query({
						where: level ? { level } : undefined,
						orderBy: { timestamp: "desc" },
						limit: limit ?? 10,
						cursor,
					});
					return result;
				},
			},

			"storage/logs/count": {
				handler: async (ctx) => {
					const level = getString(ctx.input, "level");
					const count = await ctx.storage.logs.count(level ? { level } : undefined);
					return { level, count };
				},
			},

			"storage/logs/delete": {
				handler: async (ctx) => {
					const id = getString(ctx.input, "id");
					if (!id) return { error: "id required" };
					const deleted = await ctx.storage.logs.delete(id);
					return { id, deleted };
				},
			},

			"storage/counters/increment": {
				handler: async (ctx) => {
					const name = getString(ctx.input, "name") ?? "default";
					const raw = await ctx.storage.counters.get(name);
					const currentValue = isRecord(raw) && typeof raw.value === "number" ? raw.value : 0;
					const newValue = currentValue + 1;
					await ctx.storage.counters.put(name, { name, value: newValue });
					return { name, value: newValue };
				},
			},

			"content/list": {
				handler: async (ctx) => {
					if (!ctx.content) {
						return { error: "content access not available" };
					}
					const collection = getString(ctx.input, "collection") ?? "posts";
					const limit = getNumber(ctx.input, "limit");
					const cursor = getString(ctx.input, "cursor");
					const result = await ctx.content.list(collection, {
						limit: limit ?? 10,
						cursor,
					});
					return { collection, ...result };
				},
			},

			"content/get": {
				handler: async (ctx) => {
					if (!ctx.content) {
						return { error: "content access not available" };
					}
					const id = getString(ctx.input, "id");
					if (!id) return { error: "id required" };
					const collection = getString(ctx.input, "collection") ?? "posts";
					const item = await ctx.content.get(collection, id);
					return { collection, id, item, exists: item !== null };
				},
			},

			"content/create": {
				handler: async (ctx) => {
					if (!ctx.content?.create) {
						return { error: "content write access not available" };
					}
					const collection = getString(ctx.input, "collection") ?? "posts";
					const inputData =
						isRecord(ctx.input) && isRecord(ctx.input.data) ? ctx.input.data : undefined;
					const data = inputData ?? {
						title: `Test Post ${Date.now()}`,
						body: "Created by api-test plugin",
					};
					const item = await ctx.content.create(collection, data);
					return { collection, item };
				},
			},

			"content/update": {
				handler: async (ctx) => {
					if (!ctx.content?.update) {
						return { error: "content write access not available" };
					}
					const id = getString(ctx.input, "id");
					if (!id) return { error: "id required" };
					const collection = getString(ctx.input, "collection") ?? "posts";
					const inputData =
						isRecord(ctx.input) && isRecord(ctx.input.data) ? ctx.input.data : undefined;
					const data = inputData ?? { updatedAt: new Date().toISOString() };
					const item = await ctx.content.update(collection, id, data);
					return { collection, item };
				},
			},

			"content/delete": {
				handler: async (ctx) => {
					if (!ctx.content?.delete) {
						return { error: "content write access not available" };
					}
					const id = getString(ctx.input, "id");
					if (!id) return { error: "id required" };
					const collection = getString(ctx.input, "collection") ?? "posts";
					const deleted = await ctx.content.delete(collection, id);
					return { collection, id, deleted };
				},
			},

			"media/list": {
				handler: async (ctx) => {
					if (!ctx.media) {
						return { error: "media access not available" };
					}
					const limit = getNumber(ctx.input, "limit");
					const cursor = getString(ctx.input, "cursor");
					const mimeType = getString(ctx.input, "mimeType");
					const result = await ctx.media.list({
						limit: limit ?? 10,
						cursor,
						mimeType,
					});
					return result;
				},
			},

			"media/get": {
				handler: async (ctx) => {
					if (!ctx.media) {
						return { error: "media access not available" };
					}
					const id = getString(ctx.input, "id");
					if (!id) return { error: "id required" };
					const item = await ctx.media.get(id);
					return { id, item, exists: item !== null };
				},
			},

			"media/upload-url": {
				handler: async (ctx) => {
					if (!ctx.media?.getUploadUrl) {
						return { error: "media write access not available" };
					}
					const filename = getString(ctx.input, "filename") ?? `test-${Date.now()}.txt`;
					const contentType = getString(ctx.input, "contentType") ?? "text/plain";
					const result = await ctx.media.getUploadUrl(filename, contentType);
					return { filename, contentType, ...result };
				},
			},

			"http/fetch": {
				handler: async (ctx) => {
					if (!ctx.http) {
						return { error: "http access not available" };
					}
					const url = getString(ctx.input, "url") ?? "https://httpbin.org/get";
					const method = getString(ctx.input, "method") ?? "GET";

					try {
						const response = await ctx.http.fetch(url, { method });
						const data = await response.json();
						return {
							url,
							method,
							status: response.status,
							ok: response.ok,
							data,
						};
					} catch (error) {
						return {
							url,
							method,
							error: error instanceof Error ? error.message : String(error),
						};
					}
				},
			},

			"http/post": {
				handler: async (ctx) => {
					if (!ctx.http) {
						return { error: "http access not available" };
					}
					const url = getString(ctx.input, "url") ?? "https://httpbin.org/post";
					const body = isRecord(ctx.input) ? ctx.input.body : undefined;

					try {
						const response = await ctx.http.fetch(url, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(body ?? { test: true }),
						});
						const data = await response.json();
						return { url, status: response.status, ok: response.ok, data };
					} catch (error) {
						return {
							url,
							error: error instanceof Error ? error.message : String(error),
						};
					}
				},
			},

			"test/all": {
				handler: async (ctx) => {
					const results: Record<string, unknown> = {};

					results.plugin = {
						id: ctx.plugin.id,
						version: ctx.plugin.version,
					};

					ctx.log.info("Running all API tests", { timestamp: Date.now() });
					results.log = "logged";

					const kvKey = `test-all-${Date.now()}`;
					await ctx.kv.set(kvKey, { tested: true });
					const kvValue = await ctx.kv.get(kvKey);
					await ctx.kv.delete(kvKey);
					results.kv = { key: kvKey, value: kvValue, cleaned: true };

					const logId = `test-${Date.now()}`;
					await ctx.storage.logs.put(logId, {
						timestamp: new Date().toISOString(),
						level: "test",
						message: "API test entry",
					});
					const logEntry = await ctx.storage.logs.get(logId);
					await ctx.storage.logs.delete(logId);
					results.storage = { id: logId, entry: logEntry, cleaned: true };

					if (ctx.content) {
						const contentList = await ctx.content.list("posts", { limit: 1 });
						results.content = {
							available: true,
							canWrite: !!ctx.content.create,
							sampleCount: contentList.items.length,
						};
					} else {
						results.content = { available: false };
					}

					if (ctx.media) {
						const mediaList = await ctx.media.list({ limit: 1 });
						results.media = {
							available: true,
							canWrite: !!ctx.media.getUploadUrl,
							sampleCount: mediaList.items.length,
						};
					} else {
						results.media = { available: false };
					}

					if (ctx.http) {
						try {
							const response = await ctx.http.fetch("https://httpbin.org/get");
							results.http = {
								available: true,
								testStatus: response.status,
							};
						} catch (error) {
							results.http = {
								available: true,
								error: error instanceof Error ? error.message : String(error),
							};
						}
					} else {
						results.http = { available: false };
					}

					return {
						success: true,
						timestamp: new Date().toISOString(),
						results,
					};
				},
			},
		},

		hooks: {
			"plugin:install": {
				handler: async (_event, ctx) => {
					ctx.log.info("api-test plugin installed");
					await ctx.kv.set("state:installed", new Date().toISOString());
				},
			},

			"plugin:activate": {
				handler: async (_event, ctx) => {
					ctx.log.info("api-test plugin activated");
					await ctx.kv.set("state:activated", new Date().toISOString());
				},
			},

			"content:afterSave": {
				priority: 200,
				handler: async (event, ctx) => {
					ctx.log.debug("api-test saw content save", {
						collection: event.collection,
						isNew: event.isNew,
					});
					await ctx.storage.logs.put(`save-${Date.now()}`, {
						timestamp: new Date().toISOString(),
						level: "info",
						message: `Content saved: ${event.collection}`,
						data: { collection: event.collection, isNew: event.isNew },
					});
				},
			},
		},
	});
}

export default createPlugin;
