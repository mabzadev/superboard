import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
	describeAstroRoutes,
	endpointMethods,
	routeManifestModuleSource,
	superboardRouteRegistry,
} from "../../../../apps/site/route-registry.mjs";

const itemPattern = /^\/items\/([^/]+)\/?$/u;

await test("the Astro adapter reads methods from the resolved endpoint source and adds its real HEAD fallback", async () => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-astro-routes-"));
	try {
		const entrypoint = join(directory, "endpoint.mjs");
		await writeFile(entrypoint, 'export const GET = () => new Response("first");');
		const observed = [
			{ type: "endpoint", pattern: "/items/[id]", patternRegex: itemPattern, entrypoint },
		];
		const first = await describeAstroRoutes(observed, directory);
		assert.deepEqual(first.failures, []);
		assert.deepEqual(
			first.descriptors.map((route) => route.method),
			["GET", "HEAD"],
		);
		await writeFile(entrypoint, 'export const POST = () => new Response("created", {status:201});');
		const changed = await describeAstroRoutes(observed, directory);
		assert.deepEqual(
			changed.descriptors.map((route) => route.method),
			["POST"],
		);
		assert.deepEqual((await describeAstroRoutes([], directory)).descriptors, []);
		await writeFile(entrypoint, "export const notAHandler = 1;");
		assert.equal((await describeAstroRoutes(observed, directory)).failures.length, 1);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

await test("endpoint metadata does not turn types or page exports into HTTP methods", () => {
	assert.deepEqual(
		endpointMethods("export type GET = string; export { handler as POST };", "route.ts"),
		["POST"],
	);
});

await test("framework ownership follows the mounted module and generated handlers execute its exports", async () => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-route-handlers-"));
	try {
		const entrypoint = join(directory, "endpoint.mjs");
		await writeFile(entrypoint, 'export const GET = () => new Response("upstream handler");');
		const graph = await describeAstroRoutes(
			[{ type: "endpoint", pattern: "/unrelated-url/[id]", patternRegex: itemPattern, entrypoint }],
			directory,
			[{ pluginId: "superboard-content", roots: [directory] }],
		);
		assert.deepEqual(graph.failures, []);
		assert.equal(graph.descriptors[0].pluginId, "superboard-content");
		const generatedFile = join(directory, "generated.mjs");
		await writeFile(generatedFile, routeManifestModuleSource(graph));
		const generated = await import(pathToFileURL(generatedFile).href);
		const route = generated.default.descriptors.find((candidate) => candidate.method === "GET");
		const module = await generated.default.handlers[route.id]();
		assert.equal(await module.GET().text(), "upstream handler");
		const removed = await describeAstroRoutes([], directory);
		const removedFile = join(directory, "removed.mjs");
		await writeFile(removedFile, routeManifestModuleSource(removed));
		const withdrawn = await import(pathToFileURL(removedFile).href);
		assert.equal(withdrawn.default.handlers[route.id], undefined);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

await test("changing an endpoint export invalidates the executing virtual manifest during development", async () => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-route-refresh-"));
	try {
		const entrypoint = join(directory, "endpoint.mjs");
		await writeFile(entrypoint, 'export const GET = () => new Response("read");');
		const integration = superboardRouteRegistry();
		let plugin;
		integration.hooks["astro:config:setup"]({
			config: { root: pathToFileURL(directory + "/") },
			addMiddleware() {},
			updateConfig(config) {
				plugin = config.vite.plugins[0];
			},
		});
		await integration.hooks["astro:routes:resolved"]({
			routes: [{ type: "endpoint", pattern: "/items/[id]", patternRegex: itemPattern, entrypoint }],
		});
		const id = plugin.resolveId("virtual:superboard/route-manifest");
		const before = await import(`data:text/javascript,${encodeURIComponent(plugin.load(id))}`);
		assert.deepEqual(
			before.default.descriptors.map((route) => route.method),
			["GET", "HEAD"],
		);
		await writeFile(entrypoint, 'export const POST = () => new Response("created");');
		const module = { id };
		const invalidated = [];
		const changed = await plugin.handleHotUpdate({
			file: entrypoint,
			modules: [],
			server: {
				moduleGraph: {
					getModuleById: () => module,
					invalidateModule(value) {
						invalidated.push(value);
					},
				},
			},
		});
		assert.deepEqual(changed, [module]);
		assert.deepEqual(invalidated, [module]);
		const after = await import(`data:text/javascript,${encodeURIComponent(plugin.load(id))}`);
		assert.deepEqual(
			after.default.descriptors.map((route) => route.method),
			["POST"],
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
