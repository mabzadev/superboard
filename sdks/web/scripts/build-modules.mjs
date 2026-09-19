import { spawnSync } from "node:child_process";
import { cp, readdir, readFile, writeFile } from "node:fs/promises";
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
const modules = [
	["identity/web/dist", "identity"],
	["flows/upstream/packages/js/dist", "flows"],
	["flows/upstream/packages/react/dist", "flows/react"],
	["flows/upstream/packages/js-components/dist", "flows/components"],
	["flows/upstream/packages/react-components/dist", "flows/react-components"],
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
for (const [source, destination] of modules) {
	const output = resolve(sdk, "dist", destination);
	await cp(resolve(sdk, source), output, { recursive: true });
	await rewrite(output);
}

await cp(resolve(sdk, "flows/upstream/packages/styles/src"), resolve(sdk, "dist/flows/styles"), {
	recursive: true,
});
