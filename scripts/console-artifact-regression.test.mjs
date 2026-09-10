import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { captureConsoleArtifact } from "./cloudflare-console-artifact.mjs";
import { runConsolidatedDeployment } from "./cloudflare-consolidate.mjs";

test("active deployment requires a prepared manifest before executing commands", async () => {
	let commands = 0;
	await assert.rejects(
		runConsolidatedDeployment({}, () => {
			commands++;
			return "";
		}),
		/PREPARED_DEPLOYMENT_REQUIRED/,
	);
	assert.equal(commands, 0);
});

test("a changed validated artifact is rejected before invoking any deployment command", async () => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-tampered-console-"));
	try {
		const worker = join(directory, "worker.mjs");
		const configPath = join(directory, "wrangler.jsonc");
		await writeFile(worker, "export default {};\n");
		await writeFile(configPath, JSON.stringify({ main: worker }));
		const consoleArtifact = await captureConsoleArtifact(configPath);
		await writeFile(worker, "export default { changed: true };\n");
		let commands = 0;
		await assert.rejects(
			runConsolidatedDeployment(
				{
					manifest: {
						groups: [{ id: "console", configPath, secrets: [] }],
						consoleArtifact,
						queueTransfers: [],
						retiredWorkerCandidates: [],
					},
					initialInstall: true,
				},
				() => {
					commands++;
					return "";
				},
			),
			/CONSOLE_ARTIFACT_CHANGED_AFTER_VALIDATION/,
		);
		assert.equal(commands, 0);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

for (const script of ["cloudflare:deploy", "cloudflare:deploy:all"]) {
	test(`${script} cannot reach deployment when regression tests fail`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "superboard-deployment-gate-"));
		try {
			const marker = join(directory, "deployment-started");
			await writeFile(join(directory, "pnpm"), "#!/bin/sh\nexit 7\n", { mode: 0o755 });
			await writeFile(join(directory, "node"), '#!/bin/sh\n: > "$REGRESSION_DEPLOY_MARKER"\n', {
				mode: 0o755,
			});
			const manifest = JSON.parse(
				await readFile(new URL("../package.json", import.meta.url), "utf8"),
			);
			const result = spawnSync("/bin/sh", ["-c", manifest.scripts[script]], {
				env: {
					...process.env,
					PATH: `${directory}:${process.env.PATH}`,
					REGRESSION_DEPLOY_MARKER: marker,
				},
				encoding: "utf8",
			});
			assert.equal(result.status, 7, result.stderr);
			await assert.rejects(access(marker), { code: "ENOENT" });
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
}

test("deploying a prepared console preserves the tested Worker and browser assets", async () => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-tested-console-"));
	try {
		const worker = join(directory, "worker.mjs");
		const client = join(directory, "client.js");
		const config = join(directory, "wrangler.jsonc");
		await writeFile(worker, "export default { fetch() { return new Response('validated'); } };\n");
		await writeFile(client, "export const version = 'validated';\n");
		await writeFile(config, JSON.stringify({ name: "test-console", main: worker }));
		const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
		const validated = { worker: digest(worker), client: digest(client) };
		let uploaded;
		await runConsolidatedDeployment(
			{
				targetName: "example-development",
				environment: "development",
				manifest: {
					groups: [
						{
							id: "console",
							label: "Console",
							services: ["site"],
							workerName: "test-console",
							configPath: config,
							prepareConfigPath: null,
							secrets: [],
						},
					],
					retiredWorkerCandidates: [],
					queueTransfers: [],
				},
				readiness: { consolidated: true },
				initialInstall: true,
				env: {},
			},
			(_command, args) => {
				if (args[0] === "scripts/cloudflare-site-build.mjs") {
					// A later build can incorporate edits or a compiler different from the validated build.
					writeFileSync(
						worker,
						"export default { fetch() { return new Response('untested'); } };\n",
					);
					writeFileSync(client, "export const version = 'untested';\n");
				}
				if (args.includes("deploy")) uploaded = { worker: digest(worker), client: digest(client) };
				return "";
			},
		);
		assert.deepEqual(
			uploaded,
			validated,
			"Deployment must upload exactly the Worker and browser assets that passed validation",
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
