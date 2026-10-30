import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const require = createRequire(import.meta.url);
const virtualId = "virtual:superboard/route-manifest";
const resolvedId = `\0${virtualId}`;
const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ALL"]);

function frameworkRouteGroups() {
	const root = resolve(dirname(require.resolve("emdash")), "astro/routes/api");
	return [
		{
			origin: "cms",
			pluginId: "superboard-data",
			roots: [resolve(root, "content"), resolve(root, "taxonomies")],
		},
		{
			origin: "cms",
			pluginId: "superboard-core",
			roots: [root],
		},
	];
}

export function routeManifestModuleSource(current) {
	const metadata = JSON.stringify({ descriptors: current.descriptors, failures: current.failures });
	const handlers = (current.handlers ?? [])
		.map(({ id, component }) => `${JSON.stringify(id)}: () => import(${JSON.stringify(component)})`)
		.join(",");
	return `export default {...${metadata}, handlers: {${handlers}}};`;
}

export function endpointMethods(source, filename) {
	const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
	const methods = new Set();
	for (const statement of ast.statements) {
		if (
			ts.isExportDeclaration(statement) &&
			statement.exportClause &&
			ts.isNamedExports(statement.exportClause)
		) {
			for (const entry of statement.exportClause.elements)
				if (!entry.isTypeOnly && httpMethods.has(entry.name.text)) methods.add(entry.name.text);
		}
		if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
			continue;
		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations)
				if (ts.isIdentifier(declaration.name) && httpMethods.has(declaration.name.text))
					methods.add(declaration.name.text);
		}
		if (
			ts.isFunctionDeclaration(statement) &&
			statement.name &&
			httpMethods.has(statement.name.text)
		)
			methods.add(statement.name.text);
	}
	if (methods.has("GET") && !methods.has("HEAD") && !methods.has("ALL")) methods.add("HEAD");
	return [...methods].toSorted((left, right) => left.localeCompare(right));
}

export async function describeAstroRoutes(routes, root, groups = frameworkRouteGroups()) {
	const descriptors = [];
	const handlers = [];
	const failures = [];
	const observed = [];
	for (const route of routes) {
		if (route.type !== "endpoint") continue;
		try {
			const component = route.entrypoint.startsWith("file:")
				? fileURLToPath(route.entrypoint)
				: isAbsolute(route.entrypoint)
					? route.entrypoint
					: route.entrypoint.startsWith(".") || route.entrypoint.startsWith("src/")
						? resolve(root, route.entrypoint)
						: require.resolve(route.entrypoint);
			const methods = endpointMethods(await readFile(component, "utf8"), component);
			const owner = groups.find((group) =>
				group.roots.some((sourceRoot) => component.startsWith(sourceRoot + sep)),
			);
			if (!methods.length) throw new Error("ASTRO_ENDPOINT_METHODS_MISSING");
			const path = route.pattern
				.replace(/\[\.\.\.([^\]]+)\]/gu, ":$1{.*}")
				.replace(/\[([^\]]+)\]/gu, ":$1");
			const isCms =
				owner?.origin === "cms" ||
				component.includes("packages/core/src/astro/routes/api") ||
				component.includes("emdash/astro/routes/api") ||
				(path.startsWith("/_emdash/") && !path.startsWith("/_emdash/api/superboard/"));
			const origin = owner?.origin ?? (isCms ? "cms" : "superboard");
			for (const method of methods) {
				const id = `site:astro:${method}:${route.pattern}`;
				descriptors.push({
					id,
					routeId: id,
					module: "astro",
					pluginId: owner?.pluginId ?? "superboard-core",
					service: "site",
					method,
					path,
					executionPath: path,
					surface: "board",
					access: "framework",
					transport: "http",
					kind: "canonical",
					matchPattern: route.patternRegex?.source,
					origin,
				});
				if (owner) handlers.push({ id, component });
				observed.push({ method, pattern: route.pattern, component });
			}
		} catch (error) {
			failures.push({
				pattern: route.pattern,
				reason: error instanceof Error ? error.message : "ASTRO_ROUTE_UNVERIFIABLE",
			});
		}
	}
	return { descriptors, observed, failures, handlers };
}

export function superboardRouteRegistry() {
	let root;
	let resolvedRoutes = [];
	let current = {
		descriptors: [],
		observed: [],
		failures: [{ pattern: "*", reason: "ASTRO_ROUTES_NOT_RESOLVED" }],
	};
	let server;
	return {
		name: "superboard-route-registry",
		hooks: {
			"astro:config:setup": ({ config, addMiddleware, updateConfig }) => {
				root = fileURLToPath(config.root);
				addMiddleware({
					entrypoint: new URL("./src/route-manifest-middleware.ts", import.meta.url),
					order: "pre",
				});
				updateConfig({
					vite: {
						plugins: [
							{
								name: "superboard-executing-route-manifest",
								resolveId(id) {
									return id === virtualId ? resolvedId : null;
								},
								load(id) {
									return id === resolvedId ? routeManifestModuleSource(current) : null;
								},
								configureServer(value) {
									server = value;
								},
								async handleHotUpdate(context) {
									if (!current.observed.some((route) => route.component === context.file)) return;
									current = await describeAstroRoutes(resolvedRoutes, root);
									const module = context.server.moduleGraph.getModuleById(resolvedId);
									if (!module) return;
									context.server.moduleGraph.invalidateModule(module);
									return [...context.modules, module];
								},
							},
						],
					},
				});
			},
			"astro:routes:resolved": async ({ routes }) => {
				resolvedRoutes = routes;
				current = await describeAstroRoutes(routes, root);
				const module = server?.moduleGraph.getModuleById(resolvedId);
				if (module) server.moduleGraph.invalidateModule(module);
			},
			"astro:build:done": () => {
				if (current.failures.length)
					throw new Error(`ASTRO_ROUTE_COVERAGE_INCOMPLETE:${JSON.stringify(current.failures)}`);
			},
		},
	};
}
