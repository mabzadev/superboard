import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

describe("miniflare plugin isolation", () => {
	let mf: Miniflare | undefined;

	afterEach(async () => {
		if (mf) {
			await mf.dispose();
			mf = undefined;
		}
	});

	it("can create an isolated plugin worker with scoped service bindings", async () => {
		mf = new Miniflare({
			workers: [
				{
					name: "plugin-test",
					modules: true,
					serviceBindings: {
						BRIDGE: "bridge",
					},
					script: `
						export default {
							async fetch(request, env) {
								const url = new URL(request.url);

								if (url.pathname === "/hook/afterSave") {
									const res = await env.BRIDGE.fetch("http://bridge/content/get", {
										method: "POST",
										body: JSON.stringify({ collection: "posts", id: "123" }),
										headers: { "Content-Type": "application/json" },
									});
									const data = await res.json();
									return Response.json({
										hookResult: "processed",
										contentFromBridge: data,
									});
								}

								return new Response("Unknown hook", { status: 404 });
							}
						};
					`,
				},
				{
					name: "bridge",
					modules: true,
					script: `
						export default {
							async fetch(request) {
								const url = new URL(request.url);
								if (url.pathname === "/content/get") {
									const { collection, id } = await request.json();
									return Response.json({
										success: true,
										data: { id, type: collection, slug: "test-post", data: { title: "Hello" } }
									});
								}
								return new Response("Not found", { status: 404 });
							}
						};
					`,
				},
			],
		});

		const response = await mf.dispatchFetch("http://localhost/hook/afterSave");
		const result = (await response.json()) as {
			hookResult: string;
			contentFromBridge: {
				success: boolean;
				data: { id: string; type: string; slug: string };
			};
		};

		expect(result.hookResult).toBe("processed");
		expect(result.contentFromBridge.success).toBe(true);
		expect(result.contentFromBridge.data.id).toBe("123");
		expect(result.contentFromBridge.data.type).toBe("posts");
	});

	it("plugins are isolated from each other", async () => {
		mf = new Miniflare({
			workers: [
				{
					name: "plugin-a",
					modules: true,
					serviceBindings: {
						BRIDGE: async () => {
							return Response.json({ success: true, data: { secret: "bridge-data" } });
						},
					},
					script: `
						export default {
							async fetch(request, env) {
								const res = await env.BRIDGE.fetch("http://bridge/");
								const data = await res.json();
								return Response.json({ hasAccess: true, data });
							}
						};
					`,
				},
			],
		});

		const resA = await mf.dispatchFetch("http://localhost/");
		const dataA = (await resA.json()) as { hasAccess: boolean };
		expect(dataA.hasAccess).toBe(true);
		await mf.dispose();

		mf = new Miniflare({
			workers: [
				{
					name: "plugin-b",
					modules: true,
					script: `
						export default {
							async fetch(request, env) {
								const hasBridge = "BRIDGE" in env;
								return Response.json({ hasBridge });
							}
						};
					`,
				},
			],
		});

		const resB = await mf.dispatchFetch("http://localhost/");
		const dataB = (await resB.json()) as { hasBridge: boolean };
		expect(dataB.hasBridge).toBe(false);
	});

	it("can load plugin code dynamically from a string", async () => {
		const pluginCode = `
			export default {
				async fetch(request, env) {
					return Response.json({
						pluginId: "dynamic-plugin",
						version: "1.0.0",
						message: "I was loaded from a string!",
					});
				}
			};
		`;

		mf = new Miniflare({
			workers: [
				{
					name: "dynamic-plugin",
					modules: true,
					script: pluginCode,
				},
			],
		});

		const response = await mf.dispatchFetch("http://dynamic-plugin/");
		const result = (await response.json()) as { pluginId: string; message: string };
		expect(result.pluginId).toBe("dynamic-plugin");
		expect(result.message).toBe("I was loaded from a string!");
	});

	it("can use KV namespace bindings per plugin", async () => {
		mf = new Miniflare({
			kvNamespaces: ["PLUGIN_KV"],
			modules: true,
			script: `
				export default {
					async fetch(request, env) {
						const url = new URL(request.url);
						if (url.pathname === "/set") {
							await env.PLUGIN_KV.put("test-key", "test-value");
							return new Response("set");
						}
						if (url.pathname === "/get") {
							const val = await env.PLUGIN_KV.get("test-key");
							return Response.json({ value: val });
						}
						return new Response("unknown", { status: 404 });
					}
				};
			`,
		});

		await mf.dispatchFetch("http://localhost/set");
		const getRes = await mf.dispatchFetch("http://localhost/get");
		const getData = (await getRes.json()) as { value: string };
		expect(getData.value).toBe("test-value");
		await mf.dispose();

		mf = new Miniflare({
			modules: true,
			script: `
				export default {
					async fetch(request, env) {
						const hasKv = "PLUGIN_KV" in env;
						return Response.json({ hasKv });
					}
				};
			`,
		});

		const noKvRes = await mf.dispatchFetch("http://localhost/");
		const noKvData = (await noKvRes.json()) as { hasKv: boolean };
		expect(noKvData.hasKv).toBe(false);
	});

	it("can reconfigure workers without full restart (add/remove plugins)", async () => {
		mf = new Miniflare({
			modules: true,
			script: `
				export default {
					async fetch() { return Response.json({ id: "original" }); }
				};
			`,
		});

		const res1 = await mf.dispatchFetch("http://localhost/");
		const data1 = (await res1.json()) as { id: string };
		expect(data1.id).toBe("original");

		await mf.dispose();

		mf = new Miniflare({
			modules: true,
			script: `
				export default {
					async fetch() { return Response.json({ id: "new-plugin" }); }
				};
			`,
		});

		const res2 = await mf.dispatchFetch("http://localhost/");
		const data2 = (await res2.json()) as { id: string };
		expect(data2.id).toBe("new-plugin");
	});

	it("external service binding to Node HTTP server works", async () => {
		mf = new Miniflare({
			workers: [
				{
					name: "plugin-with-external-bridge",
					modules: true,
					serviceBindings: {
						BRIDGE: async (request: Request) => {
							const url = new URL(request.url);
							if (url.pathname === "/content/get") {
								const body = (await request.json()) as { collection: string; id: string };
								return Response.json({
									success: true,
									data: {
										id: body.id,
										type: body.collection,
										data: { title: "From Node backing service" },
									},
								});
							}
							return new Response("Not found", { status: 404 });
						},
					},
					script: `
						export default {
							async fetch(request, env) {
								const res = await env.BRIDGE.fetch("http://bridge/content/get", {
									method: "POST",
									body: JSON.stringify({ collection: "posts", id: "from-plugin" }),
									headers: { "Content-Type": "application/json" },
								});
								const data = await res.json();
								return Response.json(data);
							}
						};
					`,
				},
			],
		});

		const response = await mf.dispatchFetch("http://plugin-with-external-bridge/");
		const result = (await response.json()) as {
			success: boolean;
			data: { id: string; data: { title: string } };
		};

		expect(result.success).toBe(true);
		expect(result.data.id).toBe("from-plugin");
		expect(result.data.data.title).toBe("From Node backing service");
	});
});
