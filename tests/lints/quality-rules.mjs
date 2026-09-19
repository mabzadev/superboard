import { dirname, relative, resolve } from "node:path";

function memberName(node) {
	return node?.type === "MemberExpression"
		? node.computed
			? node.property.value
			: node.property.name
		: undefined;
}

function rule(create, messages) {
	return { meta: { type: "problem", schema: [], messages }, create };
}

const pluginPattern = /^(packages\/plugins\/[^/]+)\//u;
const root = resolve(import.meta.dirname, "../..");

export default {
	rules: {
		"section-navigation-layout": rule(
			(context) => ({
				JSXOpeningElement(node) {
					if (node.name.type !== "JSXIdentifier" || node.name.name !== "nav") return;
					const classes = node.attributes.find(
						(attribute) => attribute.type === "JSXAttribute" && attribute.name.name === "className",
					)?.value;
					if (
						classes?.type !== "Literal" ||
						!String(classes.value).split(/\s/u).includes("native-front-local-navigation")
					)
						return;
					const parent = context.sourceCode
						.getAncestors(node)
						.filter((ancestor) => ancestor.type === "JSXElement" && ancestor !== node.parent)
						.at(-1);
					if (parent?.openingElement.name.name === "main")
						context.report({ node, messageId: "position" });
				},
			}),
			{
				position:
					"Render section navigation below the page heading through SectionNavigation, not before the page body.",
			},
		),
		"local-dev-hosts": rule(
			(context) => {
				if (
					!/(?:astro\.config|local-vite-config|vite\.config)\.[cm]?[jt]s$/u.test(context.filename)
				)
					return {};
				return {
					Property(node) {
						if (
							(node.key.name ?? node.key.value) === "allowedHosts" &&
							node.value.type === "Literal" &&
							node.value.value === true
						)
							context.report({ node, messageId: "wildcard" });
					},
				};
			},
			{
				wildcard:
					"Keep an explicit development host allowlist; allowing every host exposes the local server.",
			},
		),
		"api-route-contract": rule(
			(context) => {
				const path = relative(root, context.filename).replaceAll("\\", "/");
				if (!path.startsWith("packages/core/src/astro/routes/api/")) return {};
				let dynamic = false;
				return {
					ExportNamedDeclaration(node) {
						for (const declaration of node.declaration?.declarations ?? [])
							if (declaration.id.name === "prerender" && declaration.init?.value === false)
								dynamic = true;
					},
					"Program:exit"(node) {
						if (!dynamic) context.report({ node, messageId: "dynamic" });
					},
				};
			},
			{
				dynamic:
					"API routes must explicitly export prerender = false so build-time rendering cannot replace request handling.",
			},
		),
		"checked-fetch-response": rule(
			(context) => {
				const responses = new Map();
				const inspected = new Set();
				const consumed = [];
				function variable(node) {
					for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper)
						if (scope.set.has(node.name)) return scope.set.get(node.name);
				}
				return {
					VariableDeclarator(node) {
						if (
							node.id.type === "Identifier" &&
							node.init?.type === "AwaitExpression" &&
							node.init.argument?.type === "CallExpression" &&
							node.init.argument.callee?.name === "fetch"
						)
							responses.set(variable(node.id), node);
					},
					MemberExpression(node) {
						if (node.object.type !== "Identifier") return;
						const property = memberName(node);
						if (["ok", "status"].includes(property)) inspected.add(variable(node.object));
						if (
							["json", "text", "arrayBuffer", "blob"].includes(property) &&
							node.parent.type === "CallExpression"
						)
							consumed.push(node);
					},
					"Program:exit"() {
						for (const node of consumed)
							if (responses.has(variable(node.object)) && !inspected.has(variable(node.object)))
								context.report({ node, messageId: "status" });
					},
				};
			},
			{
				status:
					"Inspect the HTTP status before consuming a fetch response, or use the shared checked request helper.",
			},
		),
		"runtime-i18n": rule(
			(context) => {
				const path = relative(root, context.filename).replaceAll("\\", "/");
				if (
					!/^(?:apps\/site|packages\/(?:supbrd-front-ui|plugins\/supbrd-[^/]+))\//u.test(path) ||
					path === "packages/supbrd-front-ui/src/i18n.ts"
				)
					return {};
				return {
					ImportDeclaration(node) {
						if (node.importKind === "type") return;
						if (
							node.source.value === "@lingui/core" &&
							node.specifiers.some(
								(specifier) =>
									specifier.importKind !== "type" &&
									(["setupI18n", "I18n"].includes(specifier.imported?.name) ||
										specifier.type === "ImportNamespaceSpecifier"),
							)
						)
							context.report({ node, messageId: "factory" });
					},
				};
			},
			{
				factory:
					"Initialize Front translations through createFrontI18n so raw catalogs also compile in production.",
			},
		),
		"safe-sql": rule(
			(context) => ({
				CallExpression(node) {
					if (memberName(node.callee) !== "raw" || node.callee.object?.name !== "sql") return;
					const value = node.arguments[0];
					if (
						(value?.type === "TemplateLiteral" && value.expressions.length) ||
						value?.type === "BinaryExpression"
					)
						context.report({ node, messageId: "interpolation" });
				},
			}),
			{
				interpolation:
					"Use parameterized sql templates and validated sql.ref identifiers instead of interpolating sql.raw.",
			},
		),
		"secret-access": rule(
			(context) => ({
				MemberExpression(node) {
					const name = memberName(node);
					if (
						typeof name !== "string" ||
						!/(?:SECRET|PASSWORD|PRIVATE_KEY|API_KEY|TOKEN)(?:_|$)/u.test(name)
					)
						return;
					const object = node.object;
					if (memberName(object) === "env" && object.object?.type === "MetaProperty")
						context.report({ node, messageId: "build" });
				},
				CallExpression(node) {
					if (
						node.callee.type !== "MemberExpression" ||
						!["console", "logger"].includes(node.callee.object?.name)
					)
						return;
					for (const argument of node.arguments) {
						const name = argument.type === "Identifier" ? argument.name : memberName(argument);
						if (
							typeof name === "string" &&
							/^(?:password|secret|accessToken|refreshToken|authorization|privateKey|apiKey)$/iu.test(
								name,
							)
						)
							context.report({ node: argument, messageId: "log" });
					}
				},
			}),
			{
				build:
					"Read runtime secrets from process.env or Worker bindings; import.meta.env can embed them in a bundle.",
				log: "Log a redacted event or identifier instead of this credential value.",
			},
		),
		"package-boundaries": rule(
			(context) => {
				const path = relative(root, context.filename).replaceAll("\\", "/");
				const owner = path.match(pluginPattern)?.[1];
				function inspect(node) {
					const value = node.source?.value;
					if (typeof value !== "string") return;
					const target = value.startsWith(".")
						? relative(root, resolve(dirname(context.filename), value)).replaceAll("\\", "/")
						: value;
					if (path.startsWith("packages/") && target.startsWith("apps/"))
						context.report({ node, messageId: "application" });
					if (/^(?:workers|tools|config|deploy|e2e|fixtures)\//u.test(target))
						context.report({ node, messageId: "retired" });
					if (
						owner &&
						target.match(pluginPattern)?.[1] &&
						target.match(pluginPattern)[1] !== owner &&
						/\/(?:src|scripts)\//u.test(target)
					)
						context.report({ node, messageId: "private" });
					if (/^(?:@[^/]+\/[^/]+|[^./][^/]*)\/(?:src|internal)\//u.test(value))
						context.report({ node, messageId: "private" });
					if (
						(path.includes("/src/front/") || path.startsWith("packages/supbrd-front-ui/src/")) &&
						(value.startsWith("node:") || target.includes("/server/"))
					)
						context.report({ node, messageId: "browser" });
				}
				return {
					ImportDeclaration: inspect,
					ExportNamedDeclaration: inspect,
					ExportAllDeclaration: inspect,
					ImportExpression(node) {
						inspect({ ...node, source: node.source });
					},
				};
			},
			{
				application: "Shared packages must not import application sources.",
				retired: "This import targets a retired root directory.",
				private: "Import the owner's public package export instead of its private implementation.",
				browser: "Keep server-only code out of the Front dependency graph.",
			},
		),
		"test-integrity": rule(
			(context) => {
				if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(context.filename)) return {};
				const names = new Set(["test", "it", "describe"]);
				return {
					ImportDeclaration(node) {
						if (["node:test", "vitest", "@playwright/test"].includes(node.source.value))
							for (const specifier of node.specifiers)
								if (
									specifier.type === "ImportDefaultSpecifier" ||
									["test", "it", "describe"].includes(specifier.imported?.name)
								)
									names.add(specifier.local.name);
					},
					CallExpression(node) {
						let callee = node.callee;
						const properties = [];
						while (callee.type === "MemberExpression") {
							properties.push(memberName(callee));
							callee = callee.object;
						}
						if (!names.has(callee.name)) return;
						const focusedOption = node.arguments.some(
							(argument) =>
								argument.type === "ObjectExpression" &&
								argument.properties.some(
									(property) =>
										(property.key?.name ?? property.key?.value) === "only" &&
										property.value?.value === true,
								),
						);
						if (properties.includes("only") || focusedOption)
							context.report({ node, messageId: "focused" });
						if (
							properties.includes("skip") &&
							!context.sourceCode
								.getCommentsBefore(node.parent)
								.some((comment) => comment.value.trim().length >= 12)
						)
							context.report({ node, messageId: "skip" });
					},
				};
			},
			{
				focused: "Focused tests prevent the rest of the suite from running.",
				skip: "Explain the concrete missing prerequisite or tracked defect immediately before a skipped test.",
			},
		),
		"worker-io": rule(
			(context) => {
				const path = relative(root, context.filename).replaceAll("\\", "/");
				if (
					!/^packages\/plugins\/.*\/(?:worker|api|app|billing|email|files|identity|observability|flows|marketing|support|analytics)\/src\//u.test(
						path,
					) &&
					!path.startsWith("apps/reference/worker/src/")
				)
					return {};
				return {
					CallExpression(node) {
						if (node.callee.type !== "Identifier" || node.callee.name !== "fetch") return;
						const ancestors = context.sourceCode.getAncestors(node);
						if (!ancestors.some((ancestor) => /Function/u.test(ancestor.type)))
							context.report({ node, messageId: "topLevel" });
						const options = node.arguments[1];
						if (
							!options ||
							(options.type === "ObjectExpression" &&
								!options.properties.some(
									(property) =>
										property.type === "SpreadElement" ||
										property.key?.name === "signal" ||
										property.key?.value === "signal",
								))
						)
							context.report({ node, messageId: "timeout" });
					},
				};
			},
			{
				topLevel:
					"Start network operations inside a Worker request, scheduled event, queue handler or workflow.",
				timeout:
					"Pass an abort signal or the shared request options carrying the network deadline.",
			},
		),
		"documented-suppression": rule(
			(context) => ({
				Program() {
					for (const comment of context.sourceCode.getAllComments()) {
						const value = comment.value.trim();
						if (!/^(?:eslint|oxlint)-disable/u.test(value)) continue;
						if (
							!/^(?:eslint|oxlint)-disable(?:-next-line|-line)?\s+\S[\s\S]*?\s--\s+\S/u.test(value)
						)
							context.report({ loc: comment.loc, messageId: "reason" });
					}
				},
			}),
			{
				reason:
					"Name the exact disabled rules and explain the exception after --; blanket disables are not permitted.",
			},
		),
		"localized-ui": rule(
			(context) => {
				const path = relative(root, context.filename).replaceAll("\\", "/");
				if (
					!path.startsWith("packages/admin/src/") &&
					!path.includes("/src/front/") &&
					!path.startsWith("packages/supbrd-front-ui/src/")
				)
					return {};
				function translated(node) {
					return context.sourceCode
						.getAncestors(node)
						.some(
							(ancestor) =>
								ancestor.type === "JSXElement" &&
								["Trans", "Translation"].includes(ancestor.openingElement.name?.name),
						);
				}
				return {
					JSXText(node) {
						if (/[\p{L}]{2}/u.test(node.value) && !translated(node))
							context.report({ node, messageId: "text" });
					},
					JSXAttribute(node) {
						if (
							["title", "placeholder", "aria-label", "alt"].includes(node.name.name) &&
							node.value?.type === "Literal" &&
							/[\p{L}]{2}/u.test(node.value.value) &&
							!translated(node)
						)
							context.report({ node, messageId: "text" });
						if (
							node.name.name === "className" &&
							node.value?.type === "Literal" &&
							/(?:^|\s|:)(?:(?:m|p)[lr]-|(?:left|right|text-left|text-right|border-l|border-r)(?:-|\s|$))/u.test(
								node.value.value,
							)
						)
							context.report({ node, messageId: "rtl" });
					},
				};
			},
			{
				text: "Translate user-facing copy, including accessible names, through Lingui.",
				rtl: "Use logical start/end, ms/me and ps/pe classes so the layout follows the locale direction.",
			},
		),
	},
};
