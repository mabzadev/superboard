import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function validateSuperBoardBrand({ repositoryRoot = root } = {}) {
	const [manifest, schema] = await Promise.all(
		["config/superboard-brand.json", "schemas/superboard-brand.schema.json"].map(async (path) =>
			JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8")),
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

function gitGrep(repositoryRoot, pattern, paths) {
	try {
		return execFileSync("git", ["grep", "-n", "-I", "-F", pattern, "--", ...paths], {
			cwd: repositoryRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	} catch (error) {
		if (error.status === 1) return "";
		throw error;
	}
}

const sourceRoots = [
	"README.md",
	"SECURITY.md",
	"CONTRIBUTING.md",
	"LICENSE",
	"apps/site/src",
	"packages/supbrd-core/src",
	"packages/supbrd-front-ui/src",
	"packages/supbrd-runtime-plugins/src/front",
	"apps/mcp",
];
const compatibilityReferences = new Map([["apps/mcp/src/api-client.ts", ["env.OPENGROW_API_URL"]]]);
const excludedDirectories = new Set(["node_modules", "dist", ".git", ".wrangler", "__tests__"]);
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

async function sourceFiles(repositoryRoot, path) {
	let info;
	try {
		info = await stat(resolve(repositoryRoot, path));
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
	if (info.isFile()) {
		return /\.(?:test|spec)\./u.test(path) ? [] : [path];
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
				.map((entry) => sourceFiles(repositoryRoot, `${path}/${entry.name}`)),
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
				const checked = (compatibilityReferences.get(path) ?? []).reduce(
					(value, reference) => value.replaceAll(reference, ""),
					line,
				);
				if (hasNonCanonicalBrand(checked)) report(path, `line ${index + 1}`);
			}
		}),
	);
	for (const path of [
		"config/sdk-libraries.json",
		"config/superboard-plugin-packages.json",
		"config/superboard-plugin-catalog.json",
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
	return diagnostics.sort(
		(a, b) => a.filename.localeCompare(b.filename) || a.message.localeCompare(b.message),
	);
}

export async function checkSuperBoardBrand({ repositoryRoot = root } = {}) {
	const manifest = await validateSuperBoardBrand({ repositoryRoot });
	const developmentTarget = JSON.parse(
		await readFile(resolve(repositoryRoot, "deploy/targets/mbza-development.json"), "utf8"),
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
	for (const pattern of ["mabzadev/" + "opengrow-platform", "mabzadev/" + "opengrow-reference"]) {
		const matches = gitGrep(repositoryRoot, pattern, [
			".",
			":(exclude)**/*.test.*",
			":(exclude)config/sdk-release-history.json",
			":(exclude)docs/**",
		]);
		if (matches) violations.push(matches);
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
