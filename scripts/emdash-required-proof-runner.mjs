import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const WORKER_UNIT_PROOF_PATTERN = /^workers\/(?!api\/)[^/]+\/src\/index\.test\.ts$/u;
const WORKER_RUNTIME_PROOF_PATTERN = /^workers\/[^/]+\/runtime-tests\/[^/]+\.runtime\.test\.ts$/u;

export function buildRequiredProofPlan(matrix) {
	const requiredProofs = [
		...new Set(matrix.rows.filter(({ required }) => required).map(({ test }) => test)),
	].toSorted((left, right) => left.localeCompare(right));
	const apiProofs = requiredProofs.filter((path) => path.startsWith("workers/api/"));
	const workerRuntimeProofs = requiredProofs.filter((path) =>
		WORKER_RUNTIME_PROOF_PATTERN.test(path),
	);
	const workerUnitProofs = requiredProofs.filter((path) => WORKER_UNIT_PROOF_PATTERN.test(path));
	const steps = [
		{
			name: "Node parity proofs",
			proofs: [
				"scripts/dashboard-route-parity.test.mjs",
				"sdks/javascript/test/emdash-store-parity.test.js",
			],
			command: process.execPath,
			args: [
				"--test",
				"scripts/dashboard-route-parity.test.mjs",
				"sdks/javascript/test/emdash-store-parity.test.js",
			],
			cwd: root,
		},
		{
			name: "Front DOM and client errors",
			proofs: ["apps/site/tests/front-release-dom-parity.test.tsx"],
			command: "pnpm",
			args: [
				"--dir",
				"apps/site",
				"exec",
				"vitest",
				"run",
				"--config",
				"vitest.front.config.ts",
				"tests/front-release-dom-parity.test.tsx",
			],
			cwd: root,
		},
		{
			name: "Gateway API contracts",
			proofs: apiProofs,
			command: "pnpm",
			args: [
				"--dir",
				"workers/api",
				"exec",
				"vitest",
				"run",
				"--config",
				"vitest.config.ts",
				...apiProofs.map((path) => path.slice("workers/api/".length)),
			],
			cwd: root,
		},
		...workerRuntimeProofs.map((proof) => {
			const directory = proof.split("/").slice(0, 2).join("/");
			return {
				name: `${directory} runtime contract`,
				proofs: [proof],
				command: "pnpm",
				args: [
					"--dir",
					directory,
					"exec",
					"vitest",
					"run",
					"--config",
					"vitest.runtime.config.ts",
					proof.slice(`${directory}/`.length),
				],
				cwd: root,
			};
		}),
		...workerUnitProofs.map((proof) => {
			const directory = proof.split("/").slice(0, 2).join("/");
			return {
				name: `${directory} unit contract`,
				proofs: [proof],
				command: "pnpm",
				args: ["--dir", directory, "exec", "vitest", "run", "src/index.test.ts"],
				cwd: root,
			};
		}),
		{
			name: "Site runtime Instance",
			proofs: ["apps/site/runtime-tests/plugin-parity-instance.runtime.test.ts"],
			command: "pnpm",
			args: [
				"--dir",
				"apps/site",
				"exec",
				"vitest",
				"run",
				"--config",
				"vitest.runtime.config.ts",
				"runtime-tests/plugin-parity-instance.runtime.test.ts",
			],
			cwd: root,
		},
		{
			name: "React Native SDK contract",
			proofs: ["sdks/react-native/src/__tests__/index.test.tsx"],
			command: "pnpm",
			args: [
				"--dir",
				"sdks/react-native",
				"exec",
				"jest",
				"src/__tests__/index.test.tsx",
				"--runInBand",
			],
			cwd: root,
		},
		{
			name: "Flutter SDK contract",
			proofs: ["sdks/flutter/test/emdash_store_parity_test.dart"],
			command: "flutter",
			args: ["test", "test/emdash_store_parity_test.dart"],
			cwd: resolve(root, "sdks/flutter"),
		},
		{
			name: "FlutterFlow SDK contract",
			proofs: ["sdks/flutterflow/test/emdash_store_parity_test.dart"],
			command: "flutter",
			args: ["test", "test/emdash_store_parity_test.dart"],
			cwd: resolve(root, "sdks/flutterflow"),
		},
	];
	const coveredProofs = steps
		.flatMap(({ proofs }) => proofs)
		.toSorted((left, right) => left.localeCompare(right));
	if (JSON.stringify(coveredProofs) !== JSON.stringify(requiredProofs)) {
		const covered = new Set(coveredProofs);
		const required = new Set(requiredProofs);
		const missing = requiredProofs.filter((proof) => !covered.has(proof));
		const stale = coveredProofs.filter((proof) => !required.has(proof));
		throw new Error(
			`Required parity proof plan is incomplete: missing=${missing.join(",")}; stale=${stale.join(",")}`,
		);
	}
	return steps;
}

export function runRequiredProofs(matrix) {
	const proofChecksums = new Map(
		matrix.rows
			.filter(({ required, test, proof_sha256: checksum }) => required && test && checksum)
			.map(({ test: proof, proof_sha256: checksum }) => [proof, checksum]),
	);
	const completedProofs = new Map();
	for (const step of buildRequiredProofPlan(matrix)) {
		console.log(`\n[parity] ${step.name}`);
		const receipt =
			step.name === "Site runtime Instance"
				? JSON.stringify({ complete: true, proofs: Object.fromEntries(completedProofs) })
				: undefined;
		const result = spawnSync(step.command, step.args, {
			cwd: step.cwd,
			encoding: "utf8",
			stdio: "inherit",
			env: {
				...process.env,
				NEXT_TELEMETRY_DISABLED: "1",
				...(receipt ? { SUPERBOARD_VERIFIED_PROOF_RECEIPTS: receipt } : {}),
			},
		});
		if (result.error) throw result.error;
		if (result.status !== 0) {
			throw new Error(`Required parity proof failed: ${step.name}`);
		}
		for (const proof of step.proofs) {
			const checksum = proofChecksums.get(proof);
			if (checksum) completedProofs.set(proof, checksum);
		}
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const matrix = JSON.parse(
		readFileSync(resolve(root, "config/emdash-parity-matrix.json"), "utf8"),
	);
	runRequiredProofs(matrix);
}
