import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	SERVICE_PACKAGE_PATHS,
	serviceTestDirectory,
} from "../../../scripts/cloudflare/services.mjs";

const root = resolve(import.meta.dirname, "../../..");
const WORKER_UNIT_PROOF_PATTERN = /\/unit\/index\.test\.ts$/u;
const WORKER_RUNTIME_PROOF_PATTERN = /\/runtime\/[^/]+\.runtime\.test\.ts$/u;
function proofDirectory(proof) {
	const directory = Object.entries(SERVICE_PACKAGE_PATHS).find(
		([service]) => service !== "site" && proof.startsWith(`${serviceTestDirectory(service)}/`),
	)?.[1];
	if (!directory) throw new Error(`Unknown service proof: ${proof}`);
	return directory;
}

export function buildRequiredProofPlan(matrix) {
	const requiredProofs = [
		...new Set(matrix.rows.filter(({ required }) => required).map(({ test }) => test)),
	].toSorted((left, right) => left.localeCompare(right));
	const apiProofs = requiredProofs.filter((path) =>
		path.startsWith("tests/checks/plugins/supbrd-core/api/"),
	);
	const workerRuntimeProofs = requiredProofs.filter(
		(path) =>
			!path.startsWith("tests/checks/apps/site/") && WORKER_RUNTIME_PROOF_PATTERN.test(path),
	);
	const workerUnitProofs = requiredProofs.filter(
		(path) => !apiProofs.includes(path) && WORKER_UNIT_PROOF_PATTERN.test(path),
	);
	const steps = [
		{
			name: "Node parity proofs",
			proofs: [
				"tests/checks/emdash/parity-matrix.test.mjs",
				"tests/checks/sdks/javascript/emdash-store-parity.test.js",
			],
			command: process.execPath,
			args: [
				"--test",
				"tests/checks/emdash/parity-matrix.test.mjs",
				"tests/checks/sdks/javascript/emdash-store-parity.test.js",
			],
			cwd: root,
		},
		{
			name: "Front DOM and client errors",
			proofs: ["tests/checks/apps/site/front-release-dom-parity.test.tsx"],
			command: "pnpm",
			args: [
				"--dir",
				"apps/site",
				"exec",
				"vitest",
				"run",
				"--config",
				"vitest.front.config.ts",
				"../../tests/checks/apps/site/front-release-dom-parity.test.tsx",
			],
			cwd: root,
		},
		{
			name: "Gateway API contracts",
			proofs: apiProofs,
			command: "pnpm",
			args: [
				"--dir",
				"packages/plugins/supbrd-core/api",
				"exec",
				"vitest",
				"run",
				"--config",
				"vitest.config.ts",
				...apiProofs.map((path) => relative("packages/plugins/supbrd-core/api", path)),
			],
			cwd: root,
		},
		...workerRuntimeProofs.map((proof) => {
			const directory = proofDirectory(proof);
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
					relative(directory, proof),
				],
				cwd: root,
			};
		}),
		...workerUnitProofs.map((proof) => {
			const directory = proofDirectory(proof);
			return {
				name: `${directory} unit contract`,
				proofs: [proof],
				command: "pnpm",
				args: ["--dir", directory, "exec", "vitest", "run", relative(directory, proof)],
				cwd: root,
			};
		}),
		{
			name: "Site runtime Instance",
			proofs: ["tests/checks/apps/site/runtime/plugin-parity-instance.runtime.test.ts"],
			command: "pnpm",
			args: [
				"--dir",
				"apps/site",
				"exec",
				"vitest",
				"run",
				"--config",
				"vitest.runtime.config.ts",
				"../../tests/checks/apps/site/runtime/plugin-parity-instance.runtime.test.ts",
			],
			cwd: root,
		},
		{
			name: "React Native SDK contract",
			proofs: ["tests/checks/sdks/react-native/unit/index.test.tsx"],
			command: "pnpm",
			args: [
				"--dir",
				"sdks/react-native",
				"exec",
				"jest",
				"../../tests/checks/sdks/react-native/unit/index.test.tsx",
				"--runInBand",
			],
			cwd: root,
		},
		{
			name: "Flutter SDK contract",
			proofs: ["tests/checks/sdks/flutter/unit/emdash_store_parity_test.dart"],
			command: "flutter",
			args: ["test", "../../tests/checks/sdks/flutter/unit/emdash_store_parity_test.dart"],
			cwd: resolve(root, "sdks/flutter"),
		},
		{
			name: "FlutterFlow SDK contract",
			proofs: ["tests/checks/sdks/flutterflow/emdash_store_parity_test.dart"],
			command: "flutter",
			args: ["test", "../../tests/checks/sdks/flutterflow/emdash_store_parity_test.dart"],
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
		readFileSync(resolve(root, "scripts/config/emdash-parity-matrix.json"), "utf8"),
	);
	runRequiredProofs(matrix);
}
