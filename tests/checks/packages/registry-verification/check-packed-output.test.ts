import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect, it } from "vitest";

const script = fileURLToPath(
	new URL(
		"../../../../packages/registry-verification/scripts/check-packed-output.mjs",
		import.meta.url,
	),
);
const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

it("fails closed when the active package manager entrypoint is unavailable", () => {
	const environment = { ...process.env };
	delete environment.npm_execpath;

	const result = spawnSync(
		process.execPath,
		[
			fileURLToPath(
				new URL(
					"../../../../packages/registry-verification/scripts/check-packed-output.mjs",
					import.meta.url,
				),
			),
		],
		{ encoding: "utf8", env: environment },
	);

	expect(result.status).not.toBe(0);
	expect(result.stderr).toContain("npm_execpath is unavailable");
});

it("runs a native package manager executable directly", () => {
	const directory = mkdtempSync(join(tmpdir(), "registry-verification-native-pnpm-"));
	temporaryDirectories.push(directory);
	const marker = join(directory, "arguments");
	const executable = join(directory, "pnpm");
	writeFileSync(
		executable,
		`#!/bin/sh\nprintf '%s ' "$@" > "${marker}"\nprintf '{"filename":"${join(directory, "missing.tgz")}"}'\n`,
	);
	chmodSync(executable, 0o755);

	const result = spawnSync(process.execPath, [script], {
		encoding: "utf8",
		env: { ...process.env, npm_execpath: executable },
	});

	expect(result.stderr).not.toContain("SyntaxError");
	expect(readFileSync(marker, "utf8")).toMatch(/^pack --pack-destination /);
});
