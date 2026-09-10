import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { servicePackagePath } from "../../../scripts/cloudflare/services.mjs";
import { inspectWorkerDirectories } from "../../../scripts/cloudflare/worker-inventory.mjs";

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "worker-inventory-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const services = ["api", "email", "identity", "files", "observability", "mcp"];
	for (const service of services) {
		mkdirSync(join(root, servicePackagePath(service), "src"), { recursive: true });
		writeFileSync(join(root, servicePackagePath(service), "package.json"), "{}");
		writeFileSync(join(root, servicePackagePath(service), "src/index.ts"), "export default {};");
	}
	writeFileSync(
		join(root, "pnpm-workspace.yaml"),
		`packages:\n${services.map((service) => `  - ${servicePackagePath(service)}`).join("\n")}\n`,
	);
	return { root, targets: [{ target: "example", features: {} }] };
}

test("worker inventory accepts packages used by registered targets", (t) => {
	const { root, targets } = fixture(t);
	assert.deepEqual(inspectWorkerDirectories(root, targets).diagnostics, []);
});

test("worker inventory reports unused directories and missing workspace declarations", (t) => {
	const { root, targets } = fixture(t);
	mkdirSync(join(root, "packages/plugins/supbrd-core", "unused"));
	writeFileSync(join(root, "packages/plugins/supbrd-core", "unused", "package.json"), "{}");
	const result = inspectWorkerDirectories(root, targets);
	assert.ok(
		result.diagnostics.some((message) =>
			message.includes("packages/plugins/supbrd-core/unused: no registered target"),
		),
	);
	assert.ok(
		result.diagnostics.some((message) =>
			message.includes("packages/plugins/supbrd-core/unused: missing pnpm"),
		),
	);
});

test("worker inventory catches broken sources and workspace entries", (t) => {
	const { root, targets } = fixture(t);
	rmSync(join(root, servicePackagePath("api"), "src/index.ts"));
	rmSync(join(root, servicePackagePath("files")), { recursive: true });
	const result = inspectWorkerDirectories(root, targets);
	assert.ok(
		result.diagnostics.some((message) =>
			message.includes("packages/plugins/supbrd-core/api: registered entrypoint is missing"),
		),
	);
	assert.ok(
		result.diagnostics.some((message) =>
			message.includes(
				"packages/plugins/supbrd-plug-data/worker: workspace points to a missing worker",
			),
		),
	);
	assert.ok(
		result.diagnostics.some((message) =>
			message.includes(
				"packages/plugins/supbrd-plug-data/worker: registered worker package is missing",
			),
		),
	);
});

test("worker inventory respects workspace exclusions and detects empty leftover directories", (t) => {
	const { root, targets } = fixture(t);
	writeFileSync(
		join(root, "pnpm-workspace.yaml"),
		'packages: ["packages/plugins/*/*", "!packages/plugins/supbrd-plug-data/worker"]\n',
	);
	mkdirSync(join(root, "packages/plugins/supbrd-core", "leftover"));
	const result = inspectWorkerDirectories(root, targets);
	assert.ok(
		result.diagnostics.some((message) =>
			message.includes("packages/plugins/supbrd-plug-data/worker: missing pnpm"),
		),
	);
	assert.ok(
		result.diagnostics.some((message) =>
			message.includes(
				"packages/plugins/supbrd-core/leftover: directory contains no worker package",
			),
		),
	);
});

test("worker inventory keeps an optional worker used by another target", (t) => {
	const { root, targets } = fixture(t);
	const directory = join(root, servicePackagePath("support"));
	mkdirSync(join(directory, "src"), { recursive: true });
	writeFileSync(join(directory, "package.json"), "{}");
	writeFileSync(join(directory, "src/index.ts"), "export default {};");
	writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages: ["packages/plugins/*/*"]\n');
	targets.push({ target: "second", features: { support: true } });
	const result = inspectWorkerDirectories(root, targets);
	assert.deepEqual(result.diagnostics, []);
	assert.deepEqual(
		result.workers.find(
			({ directory }) => directory === "packages/plugins/supbrd-plug-support/worker",
		).targets,
		["second"],
	);
});

test("custom Worker inventory ignores the surrounding application directories", (t) => {
	const { root, targets } = fixture(t);
	const directory = "apps/reference/worker";
	mkdirSync(join(root, directory, "src"), { recursive: true });
	mkdirSync(join(root, "apps/reference/lib"), { recursive: true });
	writeFileSync(join(root, directory, "package.json"), "{}");
	writeFileSync(join(root, directory, "src/index.ts"), "export default {};");
	writeFileSync(
		join(root, "pnpm-workspace.yaml"),
		'packages: ["packages/plugins/*/*", "apps/reference/worker"]\n',
	);
	targets[0].customWorker = { packagePath: directory, source: `${directory}/src/index.ts` };
	assert.deepEqual(inspectWorkerDirectories(root, targets).diagnostics, []);
});
