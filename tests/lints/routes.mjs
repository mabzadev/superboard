import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { SERVICE_PACKAGE_PATHS } from "../../scripts/cloudflare/services.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sourcePattern = /\.(?:ts|tsx|mjs|js)$/u;
export function inspectRouteSource(source, filename = "routes.ts") {
	const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
	const constructors = new Set();
	const factories = new Set();
	const tableAliases = new Set();
	const failures = [];
	for (const statement of ast.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
			continue;
		const imports = statement.importClause?.namedBindings;
		if (!imports || !ts.isNamedImports(imports)) continue;
		for (const entry of imports.elements) {
			const imported = entry.propertyName?.text ?? entry.name.text;
			if (statement.moduleSpecifier.text === "hono" && imported === "Hono")
				constructors.add(entry.name.text);
			if (
				statement.moduleSpecifier.text === "@superboard/contracts/route-registry" &&
				imported === "registerRouter"
			)
				factories.add(entry.name.text);
		}
	}
	const report = (node, code) =>
		failures.push({
			file: filename,
			line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
			code,
		});
	const visit = (node) => {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.initializer &&
			ts.isPropertyAccessExpression(node.initializer) &&
			node.initializer.name.text === "routes"
		)
			tableAliases.add(node.name.text);
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
			node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
		) {
			let target = node.left;
			while (ts.isElementAccessExpression(target)) target = target.expression;
			if (
				(ts.isPropertyAccessExpression(target) && target.name.text === "routes") ||
				(ts.isIdentifier(target) && tableAliases.has(target.text))
			)
				report(node, "ROUTE_TABLE_MUTATION");
		}
		if (
			ts.isNewExpression(node) &&
			ts.isIdentifier(node.expression) &&
			constructors.has(node.expression.text)
		) {
			const parent = node.parent;
			if (
				!ts.isCallExpression(parent) ||
				!ts.isIdentifier(parent.expression) ||
				!factories.has(parent.expression.text) ||
				parent.arguments[0] !== node
			)
				report(node, "ROUTE_ROUTER_UNREGISTERED");
		}
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
			const receiver = node.expression.expression;
			if (
				ts.isIdentifier(receiver) &&
				tableAliases.has(receiver.text) &&
				["push", "splice", "pop", "shift", "unshift", "sort", "reverse"].includes(
					node.expression.name.text,
				)
			)
				report(node, "ROUTE_TABLE_MUTATION");
			if (
				ts.isPropertyAccessExpression(receiver) &&
				receiver.name.text === "router" &&
				node.expression.name.text === "add"
			)
				report(node, "ROUTE_ROUTER_BYPASS");
			if (
				ts.isPropertyAccessExpression(receiver) &&
				receiver.name.text === "routes" &&
				["push", "splice", "pop", "shift", "unshift"].includes(node.expression.name.text)
			)
				report(node, "ROUTE_TABLE_MUTATION");
		}
		ts.forEachChild(node, visit);
	};
	visit(ast);
	return failures;
}
async function files(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = resolve(directory, entry.name);
			return entry.isDirectory() ? files(path) : sourcePattern.test(entry.name) ? [path] : [];
		}),
	);
	return nested.flat();
}
export async function checkRouteSources() {
	const roots = [
		...Object.values(SERVICE_PACKAGE_PATHS).map((path) => `${path}/src`),
		"apps/reference/worker/src",
	];
	const paths = (await Promise.all(roots.map((path) => files(resolve(root, path)))))
		.flat()
		.filter(
			(path) =>
				!relative(root, path).startsWith(
					"packages/plugins/superboard-authentification/worker/src/melody/",
				),
		);
	const failures = (
		await Promise.all(
			paths.map(async (path) =>
				inspectRouteSource(await readFile(path, "utf8"), relative(root, path)),
			),
		)
	).flat();
	for (const [service, path] of Object.entries(SERVICE_PACKAGE_PATHS)) {
		if (service === "site") continue;
		const source = await readFile(resolve(root, path, "src/index.ts"), "utf8");
		const ast = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
		let publishes = false;
		const visit = (node) => {
			if (
				ts.isCallExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === "withRouteManifest"
			)
				publishes = true;
			ts.forEachChild(node, visit);
		};
		visit(ast);
		if (!publishes)
			failures.push({
				file: `${path}/src/index.ts`,
				line: 1,
				code: `ROUTE_SERVICE_UNVERIFIABLE:${service}`,
			});
	}
	const targets = await readdir(resolve(root, "infra/targets"), { withFileTypes: true });
	for (const entry of targets) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
		const target = JSON.parse(await readFile(resolve(root, "infra/targets", entry.name), "utf8"));
		for (const component of target.customWorker?.managedWorkers ?? []) {
			try {
				const source = await readFile(resolve(root, component.source), "utf8");
				failures.push(...inspectRouteSource(source, component.source));
				if (!source.includes("withRouteManifest"))
					failures.push({
						file: component.source,
						line: 1,
						code: `ROUTE_SERVICE_UNVERIFIABLE:managed-${component.id}`,
					});
			} catch {
				failures.push({
					file: component.source,
					line: 1,
					code: `ROUTE_SERVICE_UNVERIFIABLE:managed-${component.id}`,
				});
			}
		}
	}
	return { checked: paths.length, failures };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const result = await checkRouteSources();
	console.log(JSON.stringify(result));
	if (result.failures.length) process.exitCode = 1;
}
