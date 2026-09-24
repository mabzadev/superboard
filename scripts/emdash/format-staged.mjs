import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const integration = JSON.parse(
	readFileSync(new URL("../config/emdash-integration.json", import.meta.url), "utf8"),
);
const generatedOutputs = new Set([
	...integration.overlay.generatedFiles,
	"apps/site/wrangler.jsonc",
	"apps/site/seed/seed.json",
	"scripts/config/emdash-parity-matrix.json",
	"scripts/config/emdash-plugin-topology.json",
	"scripts/config/superboard-parity-release.json",
	"scripts/config/superboard-front-bundle.json",
	"scripts/config/superboard-plugin-compatibility.json",
	"scripts/config/superboard-plugin-catalog.json",
	"docs/evidence/issue-54/parity-matrix.receipt.json",
]);

export function filesRequiringFormatting(root, files) {
	const entries = execFileSync(
		"git",
		["diff", "--cached", "--name-status", "--find-renames=100%", "-z"],
		{ cwd: root, encoding: "utf8" },
	).split("\0");
	const unchanged = new Set();
	for (let index = 0; index < entries.length && entries[index];) {
		const status = entries[index++];
		index++;
		if (status.startsWith("R") || status.startsWith("C")) {
			const destination = entries[index++];
			if (status === "R100") unchanged.add(destination);
		}
	}
	return files.filter((file) => {
		const path = relative(root, resolve(root, file)).replaceAll("\\", "/");
		return !unchanged.has(path) && !generatedOutputs.has(path);
	});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = fileURLToPath(new URL("../../", import.meta.url));
	const [mode, ...files] = process.argv.slice(2);
	if (mode !== "astro" && mode !== "code") throw new Error("Expected astro or code formatter mode");
	const selected = filesRequiringFormatting(root, files);
	if (selected.length) {
		const command = resolve(root, "node_modules/.bin", mode === "astro" ? "prettier" : "oxfmt");
		const args = mode === "astro" ? ["--write"] : ["--ignore-path", ".gitignore", "--write"];
		const result = spawnSync(command, [...args, ...selected], { cwd: root, stdio: "inherit" });
		if (result.error) throw result.error;
		process.exitCode = result.status ?? 1;
	}
}
