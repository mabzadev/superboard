import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const convergenceInputs = [
	"config/emdash-plugin-topology.json",
	"config/superboard-front-bundle.json",
];

run("SuperBoard Core build", "pnpm", ["--filter", "@superboard/supbrd-core", "build"]);
run("runtime plugin build", "pnpm", ["--filter", "@superboard/supbrd-runtime-plugins", "build"]);

let previousState = null;
let converged = false;
for (let attempt = 1; attempt <= 4; attempt += 1) {
	run(`topology generation ${attempt}`, process.execPath, [
		"scripts/emdash-parity-matrix.mjs",
		"--topology-only",
		"--skip-migration",
		"--write",
	]);
	const currentState = generatedState();
	if (currentState === previousState) {
		converged = true;
		break;
	}
	previousState = currentState;
	run(`runtime plugin rebuild ${attempt}`, "pnpm", [
		"--filter",
		"@superboard/supbrd-runtime-plugins",
		"build",
	]);
}
if (!converged) throw new Error("Plugin topology generation did not converge");

run("immutable manifest migration", process.execPath, [
	"scripts/emdash-parity-matrix.mjs",
	"--topology-only",
	"--write",
]);
run("signed parity Release", process.execPath, ["scripts/emdash-parity-release.mjs", "--write"]);
run("release-derived Parity Matrix", process.execPath, [
	"scripts/emdash-parity-matrix.mjs",
	"--write",
]);
run("EmDash View seed", process.execPath, ["scripts/superboard-emdash-seed.mjs", "--write"]);

function generatedState() {
	const digest = createHash("sha256");
	for (const path of convergenceInputs) digest.update(readFileSync(resolve(root, path)));
	return digest.digest("hex");
}

function run(name, command, args) {
	console.log(`\n[parity:generate] ${name}`);
	const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`Parity generation failed: ${name}`);
}
