import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("a manifest cannot validate its console for the first time during deployment", async () => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-unvalidated-console-"));
	try {
		const configPath = join(directory, "wrangler.json");
		await writeFile(join(directory, "worker.mjs"), "export default {};\n");
		await writeFile(configPath, JSON.stringify({ main: "worker.mjs" }));
		let commands = 0;
		await assert.rejects(
			runConsolidatedDeployment(
				{
					manifest: {
						groups: [{ id: "console", services: ["site"], configPath, secrets: [] }],
						queueTransfers: [],
						retiredWorkerCandidates: [],
					},
					readiness: { consolidated: true },
					initialInstall: true,
				},
				() => {
					commands++;
					return "";
				},
			),
			/PREPARED_CONSOLE_ARTIFACT_REQUIRED/,
		);
		assert.equal(commands, 0);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("single-console deployment refuses to build or upload without a prepared manifest", async () => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-single-console-"));
	try {
		const boundary = join(directory, "subprocess.mjs");
		const marker = join(directory, "subprocess-started");
		await writeFile(
			boundary,
			`
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { writeFileSync } from "node:fs";
childProcess.spawnSync = () => {
	writeFileSync(process.env.REGRESSION_DEPLOY_MARKER, "started");
	return { status: 0, stdout: "", stderr: "" };
};
syncBuiltinESMExports();
`,
		);
		const result = spawnSync(
			process.execPath,
			[
				"--import",
				boundary,
				"scripts/cloudflare-deploy.mjs",
				"--target",
				"mbza-development",
				"--environment",
				"development",
				"--service",
				"site",
				"--skip-migrations",
			],
			{
				env: {
					...process.env,
					CLOUDFLARE_ACCOUNT_ID_MBZA_DEVELOPMENT: "0".repeat(32),
					REGRESSION_DEPLOY_MARKER: marker,
				},
				encoding: "utf8",
			},
		);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /PREPARED_DEPLOYMENT_REQUIRED/);
		await assert.rejects(access(marker), { code: "ENOENT" });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("single-console deploy and upload preserve validated bytes and reject later edits", async () => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-single-prepared-"));
	try {
		const server = join(directory, "server");
		await mkdir(server);
		const worker = join(server, "worker.mjs");
		const client = join(server, "client.js");
		const configPath = join(server, "wrangler.json");
		await writeFile(worker, "export default {};\n");
		await writeFile(client, "export const version = 'validated';\n");
		await writeFile(configPath, JSON.stringify({ main: worker }));
		const manifestPath = join(directory, "prepared.json");
		await writeFile(
			manifestPath,
			JSON.stringify({
				target: "mbza-development",
				environment: "development",
				groups: [{ id: "console", configPath }],
				consoleArtifact: await captureConsoleArtifact(configPath),
			}),
		);
		const boundary = join(directory, "subprocess.mjs");
		const marker = join(directory, "uploaded.json");
		await writeFile(
			boundary,
			`
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
childProcess.spawnSync = (command, args) => {
	if (args.some(arg => arg.endsWith("cloudflare-site-build.mjs"))) {
		writeFileSync(process.env.REGRESSION_WORKER, "untested");
	}
	if (args.includes("wrangler")) {
		writeFileSync(process.env.REGRESSION_DEPLOY_MARKER, JSON.stringify({
			mode: args.includes("upload") ? "upload" : "deploy",
			config: args[args.indexOf("--config") + 1],
			worker: readFileSync(process.env.REGRESSION_WORKER, "utf8"),
			client: readFileSync(process.env.REGRESSION_CLIENT, "utf8"),
		}));
	}
	return { status: 0, stdout: "", stderr: "" };
};
syncBuiltinESMExports();
`,
		);
		const run = (extra = []) =>
			spawnSync(
				process.execPath,
				[
					"--import",
					boundary,
					"scripts/cloudflare-deploy.mjs",
					"--target",
					"mbza-development",
					"--environment",
					"development",
					"--service",
					"site",
					"--skip-migrations",
					"--prepared-deployment",
					manifestPath,
					...extra,
				],
				{
					env: {
						...process.env,
						CLOUDFLARE_ACCOUNT_ID_MBZA_DEVELOPMENT: "0".repeat(32),
						REGRESSION_DEPLOY_MARKER: marker,
						REGRESSION_WORKER: worker,
						REGRESSION_CLIENT: client,
					},
					encoding: "utf8",
				},
			);
		for (const mode of ["deploy", "upload"]) {
			const result = run(mode === "upload" ? ["--upload-only"] : []);
			assert.equal(result.status, 0, result.stderr);
			assert.deepEqual(JSON.parse(await readFile(marker, "utf8")), {
				mode,
				config: configPath,
				worker: "export default {};\n",
				client: "export const version = 'validated';\n",
			});
			await rm(marker);
		}
		await writeFile(client, "export const version = 'untested';\n");
		const result = run();
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /CONSOLE_ARTIFACT_CHANGED_AFTER_VALIDATION/);
		await assert.rejects(access(marker), { code: "ENOENT" });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
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

test("a failing plugin regression check stops the commit hook", async () => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-plugin-hook-"));
	try {
		const marker = join(directory, "commit-continued");
		await writeFile(
			join(directory, "pnpm"),
			`#!/bin/sh
if [ "$1 $2" = "run check:front-menu" ]; then exit 0; fi
if [ "$1 $2" = "run test:plugins:regression" ]; then exit 7; fi
: > "$REGRESSION_DEPLOY_MARKER"
`,
			{ mode: 0o755 },
		);
		await writeFile(join(directory, "gitleaks"), '#!/bin/sh\n: > "$REGRESSION_DEPLOY_MARKER"\n', {
			mode: 0o755,
		});
		const result = spawnSync("/bin/sh", ["-e", join(import.meta.dirname, "../.husky/pre-commit")], {
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
					consoleArtifact: await captureConsoleArtifact(config),
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
