import { spawnSync } from "node:child_process";
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import { parseTree, printParseErrorCode } from "jsonc-parser";
import { parse as parseShell } from "shell-quote";
import { parseDocument } from "yaml";

export function diagnostic(filename, code, message, line = 1) {
	return {
		filename,
		code: `quality(${code})`,
		message,
		severity: "error",
		labels: [{ span: { line, column: 1 } }],
	};
}

export function lintConfigurationSource(filename, source) {
	if (/\.ya?ml$/u.test(filename)) {
		return parseDocument(source, { uniqueKeys: true }).errors.map((error) =>
			diagnostic(filename, "configuration-syntax", error.message, error.linePos?.[0]?.line),
		);
	}
	const errors = [];
	const jsonc = /(?:\.jsonc$|(?:^|\/)tsconfig[^/]*\.json$|\.oxlintrc\.json$)/u.test(filename);
	const tree = parseTree(source, errors, { allowTrailingComma: jsonc, disallowComments: !jsonc });
	const result = errors.map((error) =>
		diagnostic(
			filename,
			"configuration-syntax",
			printParseErrorCode(error.error),
			source.slice(0, error.offset).split("\n").length,
		),
	);
	function walk(node) {
		if (node?.type === "object") {
			const keys = new Set();
			for (const property of node.children ?? []) {
				const key = property.children[0].value;
				if (keys.has(key))
					result.push(
						diagnostic(
							filename,
							"duplicate-key",
							`Duplicate configuration key: ${key}`,
							source.slice(0, property.offset).split("\n").length,
						),
					);
				keys.add(key);
			}
		}
		for (const child of node?.children ?? []) walk(child);
	}
	walk(tree);
	return result;
}

export function lintCommandPaths(root, filename, scripts) {
	const result = [];
	for (const [name, command] of Object.entries(scripts)) {
		let cwd = resolve(root, dirname(filename));
		let segment = [];
		const inspect = () => {
			const tokens = segment;
			segment = [];
			if (tokens[0] === "cd") {
				if (typeof tokens[1] === "string" && !tokens[1].includes("$"))
					cwd = resolve(cwd, tokens[1]);
				return;
			}
			if (tokens.includes("-e") || tokens.includes("--eval")) return;
			const dirIndex = tokens.findIndex((token) => token === "--dir" || token === "-C");
			const commandRoot =
				dirIndex >= 0 && tokens[dirIndex + 1] ? resolve(cwd, tokens[dirIndex + 1]) : cwd;
			for (const [index, token] of tokens.entries()) {
				if (index === dirIndex + 1 && dirIndex >= 0) continue;
				if (typeof token !== "string" || /[$`]/u.test(token)) continue;
				if (
					!/^(?:\.{1,2}\/|(?:apps|packages|scripts|tests|sdks|infra)\/)[^\s]*\.(?:[cm]?[jt]sx?|astro|jsonc?|ya?ml|sh)$/u.test(
						token,
					)
				)
					continue;
				if (/(?:^|\/)(?:dist|generated|\.astro|\.wrangler)\//u.test(token)) continue;
				const found = /[*?[]/u.test(token)
					? globSync(token, { cwd: commandRoot }).length > 0
					: existsSync(resolve(commandRoot, token));
				if (!found)
					result.push(
						diagnostic(
							filename,
							"command-path",
							`${name}: no file matches ${token} from ${relative(root, commandRoot) || "."}`,
						),
					);
			}
		};
		for (const item of parseShell(command, (key) => `$${key}`)) {
			if (typeof item === "object" && item.op !== "glob") inspect();
			else segment.push(typeof item === "object" ? item.pattern : item);
		}
		inspect();
	}
	return result;
}

export function trackedFiles(root) {
	const result = spawnSync(
		"git",
		["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
		{ cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
	);
	if (result.status !== 0) throw new Error(result.stderr || "Cannot enumerate maintained files");
	return [
		...new Set(result.stdout.split("\0").filter((path) => path && existsSync(resolve(root, path)))),
	].sort();
}

export function maintainedFile(path) {
	return (
		!/(?:^|\/)(?:node_modules|dist|generated|\.wrangler|\.next|\.astro|\.yarn|coverage|build)\//u.test(
			path,
		) &&
		!/^(?:sdks\/flows\/upstream\/(?:reference|product)\/|(?:\.agents|\.claude)\/skills\/)/u.test(
			path,
		) &&
		!/(?:^|\/)skills\/[^/]+\/scaffold\//u.test(path)
	);
}

export function lintRepository(root, paths = trackedFiles(root)) {
	const result = [];
	const configs = paths.filter(
		(path) =>
			maintainedFile(path) &&
			(/(?:^|\/)(?:package|tsconfig[^/]*|wrangler[^/]*)\.jsonc?$/u.test(path) ||
				/^(?:scripts\/config|infra\/targets)\/.*\.json$/u.test(path) ||
				/^\.github\/workflows\/.*\.ya?ml$/u.test(path)),
	);
	for (const path of configs) {
		if (path.startsWith("tests/fixtures/") || path.startsWith("sdks/web/flows/upstream/")) continue;
		const source = readFileSync(resolve(root, path), "utf8");
		const syntax = lintConfigurationSource(path, source);
		result.push(...syntax);
		if (syntax.length || !path.endsWith(".json")) continue;
		let value;
		try {
			value = JSON.parse(source);
		} catch {
			continue;
		}
		if (path.endsWith("package.json"))
			result.push(...lintCommandPaths(root, path, value.scripts ?? {}));
		if (typeof value.$schema === "string" && value.$schema.startsWith(".")) {
			const schemaPath = resolve(root, dirname(path), value.$schema);
			if (!existsSync(schemaPath))
				result.push(diagnostic(path, "schema-path", `Missing schema: ${value.$schema}`));
			else if (!schemaPath.includes("node_modules")) {
				try {
					const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
					const Validator = schema.$schema?.includes("2020-12") ? Ajv2020 : Ajv;
					const validate = new Validator({
						allErrors: true,
						strict: false,
						validateFormats: false,
					}).compile(schema);
					if (!validate(value))
						result.push(diagnostic(path, "configuration-schema", JSON.stringify(validate.errors)));
				} catch (error) {
					result.push(diagnostic(path, "schema-tool-failure", error.message));
				}
			}
		}
	}
	return result;
}
