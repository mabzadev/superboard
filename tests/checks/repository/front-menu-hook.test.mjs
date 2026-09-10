import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

for (const failure of [0, 42])
	test(`the commit hook enforces menu checks when the guard exits ${failure}`, (context) => {
		const directory = mkdtempSync(join(tmpdir(), "superboard-menu-hook-"));
		context.after(() => rmSync(directory, { recursive: true, force: true }));
		const bin = join(directory, "bin");
		mkdirSync(bin);
		const log = join(directory, "calls");
		writeFileSync(
			join(bin, "pnpm"),
			'#!/bin/sh\nprintf "%s\\n" "$*" >> "$MENU_HOOK_LOG"\nif [ "$1 $2" = "run check:front-menu" ]; then exit "$MENU_HOOK_EXIT"; fi\n',
			{ mode: 0o755 },
		);
		writeFileSync(join(bin, "gitleaks"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		const result = spawnSync(
			"sh",
			["-e", resolve(import.meta.dirname, "../../../.husky/pre-commit")],
			{
				cwd: directory,
				env: {
					...process.env,
					PATH: `${bin}:${process.env.PATH}`,
					MENU_HOOK_LOG: log,
					MENU_HOOK_EXIT: String(failure),
				},
				encoding: "utf8",
			},
		);
		assert.equal(result.status, failure, result.stderr);
		const calls = readFileSync(log, "utf8").trim().split("\n");
		assert.equal(calls[0], "run check:front-menu");
		if (failure) assert.deepEqual(calls, ["run check:front-menu"]);
		else {
			assert.ok(calls.includes("run typecheck"));
			assert.ok(calls.includes("run test"));
		}
	});
