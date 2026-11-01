import { spawnSync } from "node:child_process";
import { cp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sdk = resolve(import.meta.dirname, "..");
const root = resolve(sdk, "../..");
function run(args) {
	const result = spawnSync("pnpm", args, { cwd: root, stdio: "inherit" });
	if (result.status !== 0) throw new Error(`SDK module build failed: ${args.join(" ")}`);
}
run(["--dir", "sdks/web/identity/web", "build"]);
run([
	"--filter",
	"@superboard/flows-js",
	"--filter",
	"@superboard/flows-react",
	"--filter",
	"@superboard/flows-js-components",
	"--filter",
	"@superboard/flows-react-components",
	"--workspace-concurrency=1",
	"-r",
	"build",
]);
// The package exports map only exposes ESM, declarations and stylesheets for
// Flows, so the CommonJS (`.js`) and IIFE (`.global.js`) builds tsup also emits
// are unreachable for consumers and are not published.
const exported = (path) => /\.(?:mjs|d\.m?ts|css)$/u.test(path);
const modules = [
	["identity/web/dist", "identity"],
	["flows/upstream/packages/js/dist", "flows", exported],
	["flows/upstream/packages/react/dist", "flows/react", exported],
	["flows/upstream/packages/js-components/dist", "flows/components", exported],
	["flows/upstream/packages/react-components/dist", "flows/react-components", exported],
];
const names = {
	"@superboard/flows-react-components": "@superboard/web/flows/react-components",
	"@superboard/flows-js-components": "@superboard/web/flows/components",
	"@superboard/flows-react": "@superboard/web/flows/react",
	"@superboard/flows-js": "@superboard/web/flows",
};
async function rewrite(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) await rewrite(path);
		else if (/\.(?:m?js|[mc]?ts)$/u.test(entry.name)) {
			let source = await readFile(path, "utf8");
			for (const [before, after] of Object.entries(names))
				source = source.replaceAll(before, after);
			await writeFile(path, source);
		}
	}
}
for (const [source, destination, include] of modules) {
	const output = resolve(sdk, "dist", destination);
	await cp(resolve(sdk, source), output, {
		recursive: true,
		filter: include ? async (path) => (await stat(path)).isDirectory() || include(path) : undefined,
	});
	await rewrite(output);
}

await cp(resolve(sdk, "flows/upstream/packages/styles/src"), resolve(sdk, "dist/flows/styles"), {
	recursive: true,
});
