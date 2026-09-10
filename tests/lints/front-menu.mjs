import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const sourceExtension = /\.(?:[cm]?[jt]sx?|astro)$/u;
const javascriptExtension = /\.[cm]?jsx?$/u;
const menuSeedImport = /(?:seed|navigation).*\.json$/u;
const corePaths = new Set([
	"/_emdash/admin",
	"/_emdash/admin/login",
	"/_emdash/admin/plugins-manager",
	"/superboard-system/home",
]);
const frontRoot = "apps/site/src/";

function walk(node, visit) {
	visit(node);
	ts.forEachChild(node, (child) => walk(child, visit));
}
function key(node) {
	return node &&
		(ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
		? node.text
		: undefined;
}
function unwrap(node) {
	while (
		node &&
		(ts.isParenthesizedExpression(node) ||
			ts.isAsExpression(node) ||
			ts.isSatisfiesExpression(node) ||
			ts.isAwaitExpression(node) ||
			ts.isNonNullExpression(node))
	)
		node = node.expression;
	return node;
}
function properties(node) {
	return new Map(
		ts.isObjectLiteralExpression(node)
			? node.properties.flatMap((property) =>
					ts.isPropertyAssignment(property)
						? [[key(property.name), property.initializer]]
						: ts.isShorthandPropertyAssignment(property)
							? [[property.name.text, property.name]]
							: [],
				)
			: [],
	);
}
function environment(filename, source) {
	const code = filename.endsWith(".astro") ? (source.split("---")[1] ?? "") : source;
	const tree = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const bindings = new Map();
	walk(tree, (node) => {
		if (ts.isVariableDeclaration(node) && node.initializer) {
			if (ts.isIdentifier(node.name)) bindings.set(node.name.text, { node: node.initializer });
			else if (ts.isArrayBindingPattern(node.name)) {
				let array = unwrap(node.initializer);
				if (ts.isCallExpression(array) && array.expression.getText(tree) === "Promise.all")
					array = array.arguments[0];
				if (array && ts.isArrayLiteralExpression(array))
					node.name.elements.forEach((element, index) => {
						if (
							ts.isBindingElement(element) &&
							ts.isIdentifier(element.name) &&
							array.elements[index]
						)
							bindings.set(element.name.text, { node: array.elements[index] });
					});
			}
		}
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			ts.isIdentifier(node.left)
		)
			bindings.set(node.left.text, { node: node.right });
		if (ts.isFunctionDeclaration(node) && node.name) bindings.set(node.name.text, { node });
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteral(node.moduleSpecifier) &&
			node.importClause &&
			!node.importClause.isTypeOnly
		) {
			const specifier = node.moduleSpecifier.text;
			if (node.importClause.name)
				bindings.set(node.importClause.name.text, { specifier, exported: "default" });
			const named = node.importClause.namedBindings;
			if (named && ts.isNamedImports(named))
				for (const element of named.elements)
					if (!element.isTypeOnly)
						bindings.set(element.name.text, {
							specifier,
							exported: (element.propertyName ?? element.name).text,
						});
			if (named && ts.isNamespaceImport(named))
				bindings.set(named.name.text, { specifier, exported: "*" });
		}
		if (ts.isExportAssignment(node)) bindings.set("default", { node: node.expression });
	});
	return { filename, tree, bindings };
}

export function lintFrontMenuSource(filename, source, options = {}) {
	if (!filename.startsWith(frontRoot) || !sourceExtension.test(filename)) return [];
	const unit = environment(filename, source);
	const diagnostics = [];
	const cache = new Map([[filename, unit]]);
	const report = (node, rule, message, position) => {
		const span =
			position ??
			unit.tree.getLineAndCharacterOfPosition(
				Math.min(node.getStart(node.getSourceFile()), unit.tree.end),
			);
		diagnostics.push({
			filename,
			severity: "error",
			code: `superboard(${rule})`,
			message,
			labels: [{ span: { line: span.line + 1, column: span.character + 1 } }],
		});
	};
	const load = (specifier, from) => {
		if (!specifier.startsWith(".")) return undefined;
		const path = posix.normalize(posix.join(posix.dirname(from.filename), specifier));
		for (const candidate of [
			path,
			path.replace(javascriptExtension, ".ts"),
			path.replace(javascriptExtension, ".tsx"),
			`${path}.ts`,
			`${path}.tsx`,
			`${path}/index.ts`,
		]) {
			if (cache.has(candidate)) return cache.get(candidate);
			const text = options.readSource?.(candidate);
			if (text !== undefined) {
				const result = environment(candidate, text);
				cache.set(candidate, result);
				return result;
			}
		}
		return undefined;
	};
	const dereference = (input, scope = unit, seen = new Set()) => {
		const node = unwrap(input);
		if (!node || seen.has(node)) return { node, scope };
		const next = new Set(seen).add(node);
		if (ts.isIdentifier(node)) {
			const binding = scope.bindings.get(node.text);
			if (binding?.node) return dereference(binding.node, scope, next);
			if (binding?.specifier) {
				const imported = load(binding.specifier, scope);
				const value = imported?.bindings.get(binding.exported);
				if (value?.node) return dereference(value.node, imported, next);
				return { node, scope, imported: binding };
			}
		}
		if (ts.isPropertyAccessExpression(node)) {
			const object = dereference(node.expression, scope, next);
			if (object.imported?.exported === "*")
				return { node, scope, imported: { ...object.imported, exported: node.name.text } };
			if (object.node && ts.isObjectLiteralExpression(object.node)) {
				const value = properties(object.node).get(node.name.text);
				if (value) return dereference(value, object.scope, next);
			}
		}
		return { node, scope };
	};
	const callee = (node, scope = unit) => {
		const resolved = dereference(node, scope);
		return resolved.imported?.exported ?? key(resolved.node?.name) ?? key(resolved.node);
	};
	const strings = (input, scope = unit, seen = new Set()) => {
		if (!input || seen.has(input)) return [];
		const next = new Set(seen).add(input);
		const { node, scope: owner } = dereference(input, scope);
		if (!node) return [];
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
		if (ts.isTemplateExpression(node))
			return [
				node.head.text +
					node.templateSpans
						.map(
							(span) =>
								(strings(span.expression, owner, next)[0] ?? "${value}") + span.literal.text,
						)
						.join(""),
			];
		if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
			return [
				(strings(node.left, owner, next)[0] ?? "${value}") +
					(strings(node.right, owner, next)[0] ?? "${value}"),
			];
		if (ts.isConditionalExpression(node))
			return [...strings(node.whenTrue, owner, next), ...strings(node.whenFalse, owner, next)];
		if (ts.isCallExpression(node)) {
			const fn = dereference(node.expression, owner);
			const result = [];
			if (
				fn.node &&
				(ts.isFunctionDeclaration(fn.node) ||
					ts.isArrowFunction(fn.node) ||
					ts.isFunctionExpression(fn.node)) &&
				fn.node.body
			) {
				if (!ts.isBlock(fn.node.body)) return strings(fn.node.body, fn.scope, next);
				walk(fn.node.body, (child) => {
					if (ts.isReturnStatement(child))
						result.push(...strings(child.expression, fn.scope, next));
				});
			}
			return result;
		}
		return [];
	};
	const fromRequest = (input) => {
		const { node, scope } = dereference(input);
		return (
			node &&
			ts.isCallExpression(node) &&
			callee(node.expression, scope) === "resolveUserFrontRequestLocale" &&
			node.arguments[0] &&
			ts.isPropertyAccessExpression(node.arguments[0]) &&
			node.arguments[0].name.text === "request"
		);
	};
	const menuSource = (input, scope = unit, seen = new Set()) => {
		if (!input || seen.has(input)) return false;
		const next = new Set(seen).add(input);
		const resolved = dereference(input, scope);
		if (!resolved.node) return false;
		if (ts.isObjectLiteralExpression(resolved.node))
			return menuSource(properties(resolved.node).get("navigation"), resolved.scope, next);
		if (ts.isCallExpression(resolved.node)) {
			const name = callee(resolved.node.expression, resolved.scope);
			if (name === "getMenu")
				return strings(resolved.node.arguments[0], resolved.scope).includes("superboard-admin");
			if (name === "editableNavigationFromMenu")
				return menuSource(resolved.node.arguments[0], resolved.scope, next);
		}
		return false;
	};

	const collectionOrigins = (input, scope, seen = new Set()) => {
		const node = unwrap(input);
		if (!node || seen.has(node)) return new Set();
		const next = new Set(seen).add(node);
		if (ts.isIdentifier(node)) {
			const binding = scope.bindings.get(node.text);
			return binding?.node ? collectionOrigins(binding.node, scope, next) : new Set([node.text]);
		}
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
			const origins = collectionOrigins(node.expression.expression, scope, next);
			if (node.expression.name.text === "concat")
				for (const arg of node.arguments)
					for (const origin of collectionOrigins(arg, scope, next)) origins.add(origin);
			return origins;
		}
		if (ts.isArrayLiteralExpression(node))
			return new Set(
				node.elements.flatMap((element) =>
					ts.isSpreadElement(element)
						? [...collectionOrigins(element.expression, scope, next)]
						: [],
				),
			);
		return new Set();
	};
	const inspectHref = (value, node, position) => {
		if (strings(value).some((text) => text.startsWith("/") || /^https?:/u.test(text)))
			report(
				node,
				"no-hardcoded-front-menu",
				"Navigation links must come from EmDash, including calculated destinations and imported helpers.",
				position,
			);
	};
	let menuRead = false;
	walk(unit.tree, (node) => {
		if (ts.isObjectLiteralExpression(node)) {
			const fields = properties(node);
			const labels = strings(fields.get("label"));
			const urls = [...strings(fields.get("href")), ...strings(fields.get("url"))];
			const navigationShape =
				fields.has("label") &&
				["href", "url", "items", "group_id"].some((name) => fields.has(name));
			const coreUtility =
				filename === "apps/site/src/front-plugins/emdash-core.ts" &&
				urls.length > 0 &&
				urls.every((url) => corePaths.has(url));
			if (navigationShape && !coreUtility && (labels.length > 0 || urls.length > 0))
				report(
					node,
					"no-hardcoded-front-menu",
					"Navigation labels, groups and destinations must come from EmDash records.",
				);
			if (
				fields.has("ar") &&
				(filename.includes("i18n") || filename.includes("catalog") || filename.includes("Controls"))
			)
				report(
					node,
					"front-languages",
					"The front supports English and French; EmDash admin languages are separate.",
				);
		}
		if (
			ts.isCallExpression(node) &&
			callee(node.expression) === "page" &&
			strings(node.arguments[0]).some((value) => value.startsWith("/"))
		)
			report(
				node,
				"no-hardcoded-front-menu",
				"Do not build a parallel navigation catalogue in runtime code.",
			);
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteral(node.moduleSpecifier) &&
			menuSeedImport.test(node.moduleSpecifier.text) &&
			filename.includes("/components/")
		)
			report(
				node,
				"no-seeded-client-menu",
				"Client navigation must read EmDash records, not bundled seed catalogues.",
			);
		if (
			ts.isCallExpression(node) &&
			callee(node.expression) === "getMenu" &&
			strings(node.arguments[0]).includes("superboard-admin")
		) {
			menuRead = true;
			const resolved = dereference(node.arguments[1]);
			const locale = resolved.node && properties(resolved.node).get("locale");
			if (!locale || !fromRequest(locale))
				report(
					node,
					"front-menu-locale",
					"Use the locale resolved from this front request, not a fixed or unrelated locale.",
				);
		}
		if (ts.isCallExpression(node) && callee(node.expression) === "projectNativeFrontPresentation") {
			if (!menuSource(node.arguments[2]))
				report(
					node,
					"front-menu-source",
					"The rendered projection must consume the native EmDash menu; an unused menu lookup is insufficient.",
				);
			if (!fromRequest(node.arguments[1]))
				report(
					node,
					"front-menu-locale",
					"The front projection must use the selected request locale too.",
				);
		}

		if (
			(ts.isFunctionDeclaration(node) ||
				ts.isArrowFunction(node) ||
				ts.isFunctionExpression(node)) &&
			node.body &&
			node.parameters.length > 1
		) {
			const releases = new Set(
				node.parameters
					.filter(
						(parameter) =>
							key(parameter.name) === "release" ||
							(parameter.type?.getText(unit.tree).includes("FrontNavigationGroup") &&
								!parameter.type.getText(unit.tree).includes("Editable")),
					)
					.map((parameter) => key(parameter.name)),
			);
			if (releases.size)
				walk(node.body, (child) => {
					if (
						ts.isReturnStatement(child) &&
						[...collectionOrigins(child.expression, unit)].some((origin) => releases.has(origin))
					)
						report(
							child,
							"no-release-menu-append",
							"Do not restore removed EmDash entries through release aliases or renamed helpers.",
						);
				});
		}
		if (ts.isJsxAttribute(node) && key(node.name) === "href" && node.initializer) {
			let parent = node.parent;
			while (parent) {
				if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(unit.tree) === "nav") {
					inspectHref(
						ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer,
						node,
					);
					break;
				}
				parent = parent.parent;
			}
		}
	});
	if (options.astroAst) {
		const visit = (node, inNavigation = false) => {
			const inside = inNavigation || node.name === "nav";
			if (inside)
				for (const attr of node.attributes ?? [])
					if (attr.name === "href") {
						const expression = ts.createSourceFile(
							"attribute.ts",
							attr.kind === "expression" ? `(${attr.value})` : JSON.stringify(attr.value),
							ts.ScriptTarget.Latest,
							true,
						);
						const statement = expression.statements[0];
						if (statement && ts.isExpressionStatement(statement))
							inspectHref(statement.expression, statement, {
								line: (attr.position?.start.line ?? 1) - 1,
								character: (attr.position?.start.column ?? 1) - 1,
							});
					}
			for (const child of node.children ?? []) visit(child, inside);
		};
		visit(options.astroAst);
	}
	if (filename === "apps/site/src/components/FrontPage.astro" && !menuRead)
		report(
			unit.tree,
			"front-menu-source",
			"The front must load the native EmDash superboard-admin menu.",
		);
	return diagnostics;
}

export async function lintFrontMenuProject(root, sources) {
	const files = sources ?? new Map();
	if (!sources) {
		const visit = (directory) =>
			readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
				entry.isDirectory()
					? visit(resolve(directory, entry.name))
					: [resolve(directory, entry.name)],
			);
		for (const path of visit(resolve(root, frontRoot)))
			if (sourceExtension.test(path)) files.set(relative(root, path), readFileSync(path, "utf8"));
	}
	const readSource = (path) =>
		files.get(path) ??
		(root && existsSync(resolve(root, path))
			? readFileSync(resolve(root, path), "utf8")
			: undefined);
	const results = [];
	let compiler;
	for (const [filename, source] of files) {
		let astroAst;
		if (filename.endsWith(".astro")) {
			try {
				if (!compiler) {
					const site = createRequire(resolve(root ?? process.cwd(), "apps/site/package.json"));
					compiler = createRequire(site.resolve("astro"))("@astrojs/compiler");
				}
				astroAst = (await compiler.parse(source)).ast;
			} catch {
				results.push({
					filename,
					severity: "error",
					code: "superboard(front-menu-parse)",
					message: "Unable to parse the Astro template; menu validation cannot be skipped.",
				});
				continue;
			}
		}
		results.push(...lintFrontMenuSource(filename, source, { readSource, astroAst }));
	}
	return results;
}

async function main() {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
	const diagnostics = await lintFrontMenuProject(root);
	for (const item of diagnostics) console.error(`${item.filename}: ${item.code}: ${item.message}`);
	if (diagnostics.length) process.exitCode = 1;
	else console.log("Front menu authority: passed.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
