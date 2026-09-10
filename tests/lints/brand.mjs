import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export async function validateSuperBoardBrand({ repositoryRoot = root } = {}) {
	const [manifest, schema] = await Promise.all(
		["scripts/config/superboard-brand.json", "scripts/config/superboard-brand.schema.json"].map(
			async (path) => JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8")),
		),
	);
	const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
	if (!validate(manifest)) {
		const details = (validate.errors ?? [])
			.map((error) => `${error.instancePath || "/"} ${error.message}`)
			.join("; ");
		throw new Error(`invalid SuperBoard brand contract: ${details}`);
	}
	return manifest;
}

const sourceRoots = [
	"README.md",
	"SECURITY.md",
	"CONTRIBUTING.md",
	"LICENSE",
	"apps/site/src",
	"packages/supbrd-core/src",
	"packages/supbrd-front-ui/src",
	"packages/plugins",
	"apps/mcp",
];
const excludedDirectories = new Set([
	"node_modules",
	"dist",
	".git",
	".wrangler",
	".dart_tool",
	".build",
	"build",
	"coverage",
	".astro",
	".next",
	".open-next",
	"generated",
	"test-results",
	"tmp-receipts",
]);
const retiredNamespacePattern = /open(?:grow)/iu;
const sourceExtensions = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".astro",
	".css",
	".json",
	".md",
	".mdx",
	".dart",
	".kt",
	".kts",
	".swift",
	".h",
	".mm",
	".m",
	".sql",
	".yaml",
	".yml",
	".jsonc",
	".toml",
	".xml",
	".pbxproj",
	".podspec",
	".plist",
	".sh",
]);
const displayFields = new Set([
	"name",
	"displayName",
	"label",
	"label_fr",
	"title",
	"description",
	"notes",
]);
function hasNonCanonicalBrand(value) {
	return /open[-_ ]?(?:grow|flow)/iu.test(value) || /\bSuperboard\b/u.test(value);
}

async function sourceFiles(repositoryRoot, path, includeTests = false) {
	let info;
	try {
		info = await stat(resolve(repositoryRoot, path));
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
	if (info.isFile()) {
		return !includeTests && /\.(?:test|spec)\./u.test(path) ? [] : [path];
	}
	const entries = await readdir(resolve(repositoryRoot, path), { withFileTypes: true });
	return (
		await Promise.all(
			entries
				.filter((entry) =>
					entry.isDirectory()
						? !excludedDirectories.has(entry.name)
						: entry.isFile() && sourceExtensions.has(extname(entry.name)),
				)
				.map((entry) => sourceFiles(repositoryRoot, `${path}/${entry.name}`, includeTests)),
		)
	).flat();
}

export async function lintSuperBoardBrandProject(repositoryRoot = root) {
	const diagnostics = [];
	function report(filename, location) {
		diagnostics.push({
			filename,
			severity: "error",
			code: "superboard/canonical-brand",
			message: `${location}: use the canonical product name SuperBoard`,
		});
	}
	const files = (
		await Promise.all(sourceRoots.map((path) => sourceFiles(repositoryRoot, path)))
	).flat();
	await Promise.all(
		files.map(async (path) => {
			const source = await readFile(resolve(repositoryRoot, path), "utf8");
			for (const [index, line] of source.split("\n").entries()) {
				if (hasNonCanonicalBrand(line)) report(path, `line ${index + 1}`);
			}
		}),
	);
	for (const path of [
		"scripts/config/sdk-libraries.json",
		"scripts/config/superboard-plugin-packages.json",
		"scripts/config/superboard-plugin-catalog.json",
		"superboard.project.json",
	]) {
		let source;
		try {
			source = await readFile(resolve(repositoryRoot, path), "utf8");
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw error;
		}
		function inspect(value, location = "") {
			if (!value || typeof value !== "object") return;
			for (const [key, child] of Object.entries(value)) {
				const next = `${location}/${key}`;
				if (displayFields.has(key) && typeof child === "string" && hasNonCanonicalBrand(child))
					report(path, next);
				else inspect(child, next);
			}
		}
		inspect(JSON.parse(source));
	}
	let namespaceFiles;
	try {
		namespaceFiles = execFileSync(
			"git",
			["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
			{
				cwd: repositoryRoot,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
				maxBuffer: 32 * 1024 * 1024,
			},
		)
			.split("\0")
			.filter(Boolean);
	} catch {
		namespaceFiles = await sourceFiles(repositoryRoot, ".", true);
	}
	for (const path of namespaceFiles) {
		const filename = path.replace(/^\.\//u, "");
		let source;
		try {
			source = await readFile(resolve(repositoryRoot, path));
		} catch (error) {
			if (["ENOENT", "EISDIR"].includes(error.code)) continue;
			throw error;
		}
		if (retiredNamespacePattern.test(filename)) report(filename, "retired namespace in filename");
		if (!source.includes(0) && retiredNamespacePattern.test(source.toString("utf8")))
			report(filename, "retired namespace in source");
	}

	return diagnostics.sort(
		(a, b) => a.filename.localeCompare(b.filename) || a.message.localeCompare(b.message),
	);
}

export async function checkSuperBoardBrand({ repositoryRoot = root } = {}) {
	const manifest = await validateSuperBoardBrand({ repositoryRoot });
	const developmentTarget = JSON.parse(
		await readFile(resolve(repositoryRoot, "infra/targets/mbza-development.json"), "utf8"),
	);
	const violations = [];
	if (
		(developmentTarget.domains?.dashboard ?? developmentTarget.domains?.site) !==
			manifest.developmentDomains.dashboard ||
		developmentTarget.domains?.shortlinks !== manifest.developmentDomains.shortLinks
	) {
		violations.push("MBZA domains do not match the canonical SuperBoard brand contract");
	}
	const retiredDashboard = ["grow", "mbza", "dev"].join(".");
	if (
		!developmentTarget.retiredDomains?.some(
			(entry) => entry.hostname === retiredDashboard && entry.policy === "must-be-unassigned",
		)
	) {
		violations.push("the retired MBZA dashboard domain is not fail-closed");
	}
	violations.push(
		...(await lintSuperBoardBrandProject(repositoryRoot)).map(
			({ filename, message }) => `${filename}: ${message}`,
		),
	);
	if (violations.length > 0) {
		throw new Error(`legacy active brand references found:\n${violations.join("\n")}`);
	}
	return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const manifest = await checkSuperBoardBrand();
	process.stdout.write(
		`${manifest.brand.name} brand contract valid: ${manifest.repositories.canonical}, https://${manifest.developmentDomains.dashboard}\n`,
	);
}
