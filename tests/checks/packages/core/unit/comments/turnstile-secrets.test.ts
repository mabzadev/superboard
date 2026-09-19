import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { build } from "vite";
import { afterEach, expect, it, vi } from "vitest";

import { verifyTurnstileToken } from "../../../../../../packages/core/src/comments/turnstile.js";

afterEach(() => vi.unstubAllGlobals());

it("rejects an unsuccessful HTTP response even if its JSON claims verification succeeded", async () => {
	vi.stubGlobal("fetch", async () => Response.json({ success: true }, { status: 503 }));
	expect(await verifyTurnstileToken("fake-token", "fake-secret")).toBe(false);
});

it("keeps Turnstile credentials out of production bundles and reads the runtime value", async () => {
	const marker = "turnstile-build-canary-not-a-real-secret";
	const result = await build({
		configFile: false,
		logLevel: "silent",
		define: {
			"import.meta.env.EMDASH_TURNSTILE_SECRET_KEY": JSON.stringify(marker),
			"import.meta.env.TURNSTILE_SECRET_KEY": JSON.stringify(marker),
		},
		build: {
			write: false,
			minify: false,
			lib: {
				entry: fileURLToPath(
					new URL("../../../../../../packages/core/src/comments/turnstile.ts", import.meta.url),
				),
				formats: ["es"],
			},
		},
	});
	const output = Array.isArray(result) ? result[0] : result;
	if (!output || !("output" in output)) throw new Error("Expected an in-memory Rollup output");
	const chunk = output.output.find((item) => item.type === "chunk");
	if (!chunk || chunk.type !== "chunk") throw new Error("Missing compiled Turnstile module");
	expect(chunk.code).not.toContain(marker);
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`;
	const child = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`const module = await import(${JSON.stringify(moduleUrl)}); process.stdout.write(module.getTurnstileSecretKey());`,
		],
		{
			encoding: "utf8",
			env: {
				...process.env,
				EMDASH_TURNSTILE_SECRET_KEY: "runtime-canary",
				TURNSTILE_SECRET_KEY: "fallback-canary",
			},
		},
	);
	expect(child.status, child.stderr).toBe(0);
	expect(child.stdout).toBe("runtime-canary");
});
