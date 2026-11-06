import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
const toolRequire = createRequire(resolve(defaultRoot, "package.json"));
const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/u;
const FORMATTED_FILE = /\.(?:[cm]?[jt]sx?|css)$/u;
const PATH_CALLS = /^(?:path\.)?(?:resolve|join)$/u;
const MODULE_LOCATION = /import\.meta\.(?:url|dirname)|__dirname/u;
const SPECIFIER_CALLS = new Set([
	"require",
	"vi.mock",
	"vi.doMock",
	"vi.unmock",
	"vi.importActual",
	"vi.importMock",
	"import.meta.resolve",
]);

export function createPathMapper(syncConfig) {
	const ignored = syncConfig.ignored.map((pattern) => new RegExp(pattern, "u"));
	const relocated = syncConfig.relocated.map(([pattern, replacement]) => [
		new RegExp(pattern, "u"),
		replacement,
	]);
	return (upstreamPath) => {
		if (ignored.some((pattern) => pattern.test(upstreamPath))) return null;
		for (const [pattern, replacement] of relocated) {
			if (pattern.test(upstreamPath)) return upstreamPath.replace(pattern, replacement);
		}
		return upstreamPath;
	};
}

function relativeSpecifier(fromFile, toFile, specifier) {
	let result = posix.relative(posix.dirname(fromFile), toFile) || ".";
	if (!result.startsWith(".")) result = `./${result}`;
	return specifier.endsWith("/") && !result.endsWith("/") ? `${result}/` : result;
}

function privateImportTarget(owner, specifier) {
	for (const [name, target] of Object.entries(owner.imports)) {
		if (typeof target !== "string" || !target.startsWith("./")) continue;
		const star = name.indexOf("*");
		if (star === -1) {
			if (name === specifier) return posix.join(owner.directory, target);
			continue;
		}
		const prefix = name.slice(0, star);
		const suffix = name.slice(star + 1);
		if (
			specifier.length >= prefix.length + suffix.length &&
			specifier.startsWith(prefix) &&
			specifier.endsWith(suffix)
		) {
			const match = specifier.slice(prefix.length, specifier.length - suffix.length);
			return posix.join(owner.directory, target.replace("*", match));
		}
	}
	return null;
}

export function rewriteRelativeSpecifiers(text, upstreamPath, localPath, mapPath, owner = null) {
	if (!SCRIPT_FILE.test(localPath)) return text;
	const ownerDirectory = owner && posix.dirname(mapPath(`${owner.directory}/package.json`) ?? "");
	const leavesOwner = Boolean(owner) && !localPath.startsWith(`${ownerDirectory}/`);
	const ts = toolRequire("typescript");
	const kind = localPath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	const source = ts.createSourceFile(localPath, text, ts.ScriptTarget.Latest, true, kind);
	const replacements = [];
	const considerTemplate = (node) => {
		const head = node.head.text;
		if (!head.startsWith(".") || !head.includes("/")) return;
		const directory = head.slice(0, head.lastIndexOf("/") + 1);
		const target = posix.normalize(posix.join(posix.dirname(upstreamPath), directory));
		const mapped = mapPath(`${target}/`) ?? `${target}/`;
		const rewritten = relativeSpecifier(localPath, mapped.slice(0, -1), "/");
		if (rewritten === directory) return;
		const start = node.head.getStart(source) + 1;
		replacements.push({ start, end: start + directory.length, value: rewritten });
	};
	const consider = (node) => {
		if (node && ts.isTemplateExpression(node)) return considerTemplate(node);
		if (leavesOwner && node && ts.isStringLiteralLike(node) && node.text.startsWith("#")) {
			const target = privateImportTarget(owner, node.text);
			if (!target) return;
			const rewritten = relativeSpecifier(localPath, mapPath(target) ?? target, node.text);
			replacements.push({ start: node.getStart(source) + 1, end: node.end - 1, value: rewritten });
			return;
		}
		if (!node || !ts.isStringLiteralLike(node) || !node.text.startsWith(".")) return;
		const target = posix.normalize(posix.join(posix.dirname(upstreamPath), node.text));
		const asDirectory = /\.[a-z0-9]+$/iu.test(posix.basename(target))
			? null
			: mapPath(`${target}/`);
		const mapped =
			asDirectory && asDirectory !== `${target}/`
				? asDirectory.slice(0, -1)
				: (mapPath(target) ?? target);
		const rewritten = relativeSpecifier(localPath, mapped, node.text);
		if (rewritten === node.text) return;
		replacements.push({ start: node.getStart(source) + 1, end: node.end - 1, value: rewritten });
	};
	const calleeName = (expression) => expression.getText(source).replace(/\s+/gu, "");
	const moduleFolders = new Set();
	const collectModuleFolders = (node) => {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.initializer &&
			MODULE_LOCATION.test(node.initializer.getText(source))
		) {
			let relative = false;
			const findRelative = (child) => {
				if (ts.isStringLiteralLike(child) && child.text !== "." && child.text !== "./")
					relative = true;
				ts.forEachChild(child, findRelative);
			};
			findRelative(node.initializer);
			if (!relative) moduleFolders.add(node.name.text);
		}
		ts.forEachChild(node, collectModuleFolders);
	};
	collectModuleFolders(source);
	const isModuleLocation = (argument) =>
		MODULE_LOCATION.test(argument.getText(source)) ||
		(ts.isIdentifier(argument) && moduleFolders.has(argument.text));
	const visit = (node) => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
			consider(node.moduleSpecifier);
		if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
			consider(node.argument.literal);
		if (ts.isCallExpression(node)) {
			if (node.expression.kind === ts.SyntaxKind.ImportKeyword) consider(node.arguments[0]);
			else if (SPECIFIER_CALLS.has(calleeName(node.expression))) consider(node.arguments[0]);
			else if (PATH_CALLS.test(calleeName(node.expression))) {
				const anchor = node.arguments.findIndex(isModuleLocation);
				if (anchor !== -1) node.arguments.slice(anchor + 1).forEach(consider);
			}
		}
		if (
			ts.isNewExpression(node) &&
			node.expression.getText(source) === "URL" &&
			node.arguments?.[1]?.getText(source) === "import.meta.url"
		) {
			consider(node.arguments[0]);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	let output = text;
	for (const replacement of replacements.toSorted((left, right) => right.start - left.start)) {
		output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
	}
	return output;
}

function git(root, args, options = {}) {
	return execFileSync("git", args, { cwd: root, maxBuffer: 1 << 30, ...options });
}

export function ensureUpstreamCommit(root, upstream) {
	const present = spawnSync("git", ["cat-file", "-e", `${upstream.commit}^{commit}`], {
		cwd: root,
	});
	if (present.status !== 0)
		git(root, ["fetch", "--no-tags", "--depth=1", upstream.remote, upstream.commit]);
	const object = git(root, ["cat-file", "-t", upstream.commit], { encoding: "utf8" }).trim();
	if (object !== "commit") throw new Error(`Pinned upstream object is ${object}, expected commit`);
}

function readTree(root, commit) {
	const entries = new Map();
	const output = git(root, ["ls-tree", "-r", "-z", "--full-tree", commit], { encoding: "utf8" });
	for (const entry of output.split("\0")) {
		if (!entry) continue;
		const [meta, path] = entry.split("\t");
		const [mode, , oid] = meta.split(" ");
		entries.set(path, { mode, oid });
	}
	return entries;
}

function isBinary(buffer) {
	return buffer.subarray(0, 8000).includes(0);
}

function packageOwner(root, tree, upstreamPath, manifests) {
	for (
		let directory = posix.dirname(upstreamPath);
		directory !== ".";
		directory = posix.dirname(directory)
	) {
		const entry = tree.get(`${directory}/package.json`);
		if (!entry) continue;
		if (!manifests.has(entry.oid)) {
			const manifest = JSON.parse(git(root, ["cat-file", "blob", entry.oid], { encoding: "utf8" }));
			manifests.set(entry.oid, manifest.imports ?? {});
		}
		return { directory, imports: manifests.get(entry.oid) };
	}
	return null;
}

function normalize(upstreamPath, localPath, buffer, mapPath, owner) {
	if (isBinary(buffer)) return { buffer, format: false };
	const original = buffer.toString("utf8");
	const rewritten = rewriteRelativeSpecifiers(original, upstreamPath, localPath, mapPath, owner);
	return {
		text: rewritten,
		format: rewritten !== original && FORMATTED_FILE.test(localPath),
	};
}

function formatTexts(items) {
	const pending = items.filter((item) => item.format);
	if (pending.length === 0) return;
	const directory = mkdtempSync(join(tmpdir(), "superboard-upstream-format-"));
	try {
		pending.forEach((item, index) => {
			const file = join(directory, String(index), item.localPath);
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, item.text);
		});
		spawnSync(
			resolve(defaultRoot, "node_modules/.bin/oxfmt"),
			["-c", resolve(defaultRoot, ".oxfmtrc.json"), "."],
			{
				cwd: directory,
				stdio: "ignore",
			},
		);
		pending.forEach((item, index) => {
			item.text = readFileSync(join(directory, String(index), item.localPath), "utf8");
		});
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function contentOf(item) {
	return item.buffer ?? Buffer.from(item.text, "utf8");
}

function mergeThreeWay(current, base, incoming, labels) {
	const directory = mkdtempSync(join(tmpdir(), "superboard-upstream-merge-"));
	try {
		const files = ["current", "base", "incoming"].map((name) => join(directory, name));
		writeFileSync(files[0], current);
		writeFileSync(files[1], base);
		writeFileSync(files[2], incoming);
		const result = spawnSync(
			"git",
			["merge-file", "-p", "-L", labels[0], "-L", labels[1], "-L", labels[2], ...files],
			{ maxBuffer: 1 << 30 },
		);
		if (result.status < 0 || result.status === null) throw new Error("git merge-file failed");
		return { content: result.stdout, conflicts: result.status };
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

export async function syncUpstream({ root = defaultRoot, base, target, syncConfig, write = true }) {
	const mapPath = createPathMapper(syncConfig);
	const before = readTree(root, base);
	const after = readTree(root, target);
	const report = {
		base,
		target,
		updated: [],
		added: [],
		deleted: [],
		unchanged: 0,
		ignored: 0,
		conflicts: [],
	};
	const work = [];
	for (const upstreamPath of new Set([...before.keys(), ...after.keys()])) {
		const old = before.get(upstreamPath);
		const next = after.get(upstreamPath);
		if (old && next && old.oid === next.oid) {
			report.unchanged += 1;
			continue;
		}
		const localPath = mapPath(upstreamPath);
		if (localPath === null) {
			report.ignored += 1;
			continue;
		}
		if ((old && old.mode === "120000") || (next && next.mode === "120000")) {
			report.conflicts.push({ path: localPath, upstreamPath, kind: "symbolic-link" });
			continue;
		}
		work.push({ upstreamPath, localPath, old, next });
	}
	const normalized = [];
	const manifests = new Map();
	const trees = { old: before, next: after };
	for (const item of work) {
		for (const side of ["old", "next"]) {
			if (!item[side]) continue;
			const buffer = git(root, ["cat-file", "blob", item[side].oid]);
			const owner = packageOwner(root, trees[side], item.upstreamPath, manifests);
			item[side].normalized = {
				localPath: item.localPath,
				...normalize(item.upstreamPath, item.localPath, buffer, mapPath, owner),
			};
			normalized.push(item[side].normalized);
		}
	}
	formatTexts(normalized);
	const labels = ["SuperBoard", `EmDash ${base.slice(0, 9)}`, `EmDash ${target.slice(0, 9)}`];
	for (const { upstreamPath, localPath, old, next } of work) {
		const file = resolve(root, localPath);
		const current = existsSync(file) ? readFileSync(file) : null;
		const oldContent = old ? contentOf(old.normalized) : null;
		const nextContent = next ? contentOf(next.normalized) : null;
		if (!next) {
			if (!current) continue;
			if (oldContent && current.equals(oldContent)) {
				report.deleted.push(localPath);
				if (write) rmSync(file);
			} else {
				report.conflicts.push({ path: localPath, upstreamPath, kind: "deleted-upstream" });
			}
			continue;
		}
		if (!old) {
			if (!current) {
				report.added.push(localPath);
				if (write) {
					mkdirSync(dirname(file), { recursive: true });
					writeFileSync(file, nextContent);
				}
			} else if (!current.equals(nextContent)) {
				report.conflicts.push({ path: localPath, upstreamPath, kind: "added-on-both-sides" });
			}
			continue;
		}
		if (!current) {
			if (!oldContent.equals(nextContent)) {
				report.conflicts.push({ path: localPath, upstreamPath, kind: "deleted-locally" });
			}
			continue;
		}
		if (current.equals(nextContent)) continue;
		if (current.equals(oldContent)) {
			report.updated.push(localPath);
			if (write) writeFileSync(file, nextContent);
			continue;
		}
		if (old.normalized.buffer || next.normalized.buffer) {
			report.conflicts.push({ path: localPath, upstreamPath, kind: "binary" });
			continue;
		}
		const merged = mergeThreeWay(current, oldContent, nextContent, labels);
		if (merged.conflicts > 0) {
			report.conflicts.push({
				path: localPath,
				upstreamPath,
				kind: "content",
				count: merged.conflicts,
			});
		} else {
			report.updated.push(localPath);
		}
		if (write) writeFileSync(file, merged.content);
	}
	return report;
}

function upstreamVersion(root, commit) {
	return JSON.parse(
		git(root, ["show", `${commit}:packages/core/package.json`], { encoding: "utf8" }),
	).version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const argumentsList = process.argv.slice(2);
	const option = (name) => {
		const index = argumentsList.indexOf(name);
		return index === -1 ? undefined : argumentsList[index + 1];
	};
	const reference = option("--to");
	if (!reference) {
		throw new Error(
			"Usage: node scripts/emdash/upstream-sync.mjs --to <commit> [--dry-run] [--report <file>]",
		);
	}
	const configPath = resolve(defaultRoot, "scripts/config/emdash-integration.json");
	const config = JSON.parse(readFileSync(configPath, "utf8"));
	ensureUpstreamCommit(defaultRoot, config.upstream);
	const target = git(defaultRoot, ["rev-parse", "--verify", `${reference}^{commit}`], {
		encoding: "utf8",
	}).trim();
	const write = !argumentsList.includes("--dry-run");
	const report = await syncUpstream({
		base: config.upstream.commit,
		target,
		syncConfig: config.upstreamSync,
		write,
	});
	if (write) {
		config.upstream.commit = target;
		config.upstream.version = upstreamVersion(defaultRoot, target);
		writeFileSync(configPath, `${JSON.stringify(config, null, "\t")}\n`);
		spawnSync(
			resolve(defaultRoot, "node_modules/.bin/oxfmt"),
			["--ignore-path", ".gitignore", configPath],
			{ cwd: defaultRoot, stdio: "ignore" },
		);
	}
	const reportPath = option("--report");
	if (reportPath) writeFileSync(resolve(reportPath), `${JSON.stringify(report, null, "\t")}\n`);
	console.log(
		JSON.stringify({
			target,
			updated: report.updated.length,
			added: report.added.length,
			deleted: report.deleted.length,
			unchanged: report.unchanged,
			ignored: report.ignored,
			conflicts: report.conflicts.length,
		}),
	);
	if (report.conflicts.length > 0) process.exitCode = 1;
}
