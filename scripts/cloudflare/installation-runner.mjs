import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { installationRunRequest } from "./installation-run-context.mjs";
const root = resolve(new URL("../..", import.meta.url).pathname);
function parseArgs() {
	const args = {};
	for (let index = 2; index < process.argv.length; index += 1) {
		const value = process.argv[index];
		if (value.startsWith("--")) {
			args[value.slice(2)] =
				process.argv[index + 1] && !process.argv[index + 1].startsWith("--")
					? process.argv[++index]
					: true;
		}
	}
	return args;
}

async function githubIdentity(env) {
	if (
		env.GITHUB_ACTIONS !== "true" ||
		!env.ACTIONS_ID_TOKEN_REQUEST_URL ||
		!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
	)
		throw new Error("INSTALLATION_RUNNER_REQUIRED");
	const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
	if (url.protocol !== "https:" || !url.hostname.endsWith(".actions.githubusercontent.com"))
		throw new Error("INSTALLATION_IDENTITY_URL_INVALID");
	url.searchParams.set("audience", "superboard-installer");
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
		signal: AbortSignal.timeout(30_000),
		redirect: "error",
	});
	if (!response.ok) throw new Error("INSTALLATION_IDENTITY_UNAVAILABLE");
	const token = (await response.json()).value;
	if (typeof token !== "string") throw new Error("INSTALLATION_IDENTITY_INVALID");
	return token;
}

async function request(env, path, body) {
	const origin = new URL(env.SUPERBOARD_INSTALLER_ORIGIN);
	if (origin.protocol !== "https:" || origin.origin !== env.SUPERBOARD_INSTALLER_ORIGIN)
		throw new Error("INSTALLATION_ORIGIN_INVALID");
	const token = await githubIdentity(env);
	const response = await fetch(`${origin.origin}${path}`, {
		method: body ? "POST" : "GET",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		...(body ? { body: JSON.stringify(body) } : {}),
		signal: AbortSignal.timeout(30_000),
		redirect: "error",
	});
	if (!response.ok) throw new Error(`INSTALLATION_RUN_API:${response.status}`);
	return (await response.json()).result;
}

export function redactedCommandOutput(values) {
	const secrets = [
		...new Set(values.filter((value) => typeof value === "string" && value.length >= 4)),
	].sort((a, b) => b.length - a.length);
	return (value) =>
		secrets
			.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), String(value))
			.replace(
				/https?:\/\/[^\s"'<>]*[?&](?:x-amz-[^=\s&]+|token|signature|credential)=[^\s"'<>]*/giu,
				"[redacted-url]",
			);
}

function executor(redact) {
	return (command, args, env) =>
		new Promise((resolveCommand, reject) => {
			const token = env.CLOUDFLARE_API_TOKEN;
			if (token) console.log(`::add-mask::${token}`);
			const redactToken = redactedCommandOutput([token]);
			const child = spawn(command, args, {
				cwd: root,
				env,
				stdio: ["ignore", "pipe", "pipe"],
				shell: false,
			});
			for (const stream of [child.stdout, child.stderr]) {
				let pending = "";
				stream.setEncoding("utf8");
				stream.on("data", (chunk) => {
					pending += chunk;
					const lines = pending.split("\n");
					pending = lines.pop();
					for (const line of lines) process.stdout.write(`${redactToken(redact(line))}\n`);
				});
				stream.on("end", () => {
					if (pending) process.stdout.write(`${redactToken(redact(pending))}\n`);
				});
			}
			child.on("error", () => reject(new Error("INSTALLATION_COMMAND_UNAVAILABLE")));
			child.on("exit", (code) =>
				code === 0
					? resolveCommand()
					: reject(new Error(`INSTALLATION_COMMAND_FAILED:${command}:${code}`)),
			);
		});
}

async function deploy(args, processEnvironment) {
	const { buildInstance, deployInstance } = await import("./workers-builds.mjs");
	const claim = await request(processEnvironment, "/runner/claim", {
		id: args.id,
		revision: args.revision,
	});
	console.log(`::add-mask::${claim.lease}`);
	let env = {
		...processEnvironment,
		SUPERBOARD_INSTALLATION_RUN_ID: claim.runId,
		SUPERBOARD_INSTALLATION_RUN_LEASE: claim.lease,
		SUPERBOARD_SOURCE_REVISION: args.revision,
		SUPERBOARD_SOURCE_BRANCH: "main",
		SUPERBOARD_ENVIRONMENT: "production",
		SUPERBOARD_TARGET: "pending-run",
		CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
	};
	try {
		let context = await installationRunRequest(env, "context");
		if (context.revision !== args.revision) throw new Error("INSTALLATION_REVISION_MISMATCH");
		const { execFileSync } = await import("node:child_process");
		if (
			execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() !==
			context.revision
		)
			throw new Error("INSTALLATION_CHECKOUT_MISMATCH");
		const hidden = [
			context.token,
			claim.lease,
			context.accountId,
			context.target.target,
			context.target.workersDevSubdomain,
			context.target.operator.email,
			context.backupKey,
			...Object.values(context.target.domains),
			...Object.values(context.target.workers).flatMap((entry) => Object.values(entry)),
		];
		for (const value of hidden) if (value) console.log(`::add-mask::${value}`);
		const redact = redactedCommandOutput(hidden);
		const execute = executor(redact);
		env = {
			...env,
			CLOUDFLARE_ACCOUNT_ID: context.accountId,
			CLOUDFLARE_API_TOKEN: context.token,
			SUPERBOARD_SETUP_API_TOKEN: context.token,
			SUPERBOARD_SOURCE_BRANCH: context.environment === "development" ? "dev" : "main",
			SUPERBOARD_ENVIRONMENT: context.environment,
			SUPERBOARD_TARGET: context.target.target,
			SUPERBOARD_TARGET_MANIFEST: JSON.stringify(context.target),
			SUPERBOARD_INITIAL_INSTALL: context.initial ? "1" : "0",
			SUPERBOARD_AUTOMATIC_UPDATES: context.automaticUpdates ? "1" : "0",
			SUPERBOARD_BACKUP_R2_BUCKET: context.backupBucket,
			SUPERBOARD_BACKUP_ENCRYPTION_KEY: context.backupKey,
			...(context.keys ? { SUPERBOARD_INSTALLATION_KEYS: context.keys } : {}),
		};
		await buildInstance(env, execute);
		context = await installationRunRequest(env, "context");
		console.log(`::add-mask::${context.token}`);
		env.CLOUDFLARE_API_TOKEN = context.token;
		env.SUPERBOARD_SETUP_API_TOKEN = context.token;
		if (context.environment === "production") {
			const url = `https://api.cloudflare.com/client/v4/accounts/${context.accountId}/r2/buckets`;
			const headers = {
				Authorization: `Bearer ${context.token}`,
				"Content-Type": "application/json",
			};
			const existing = await fetch(`${url}/${context.backupBucket}`, {
				headers,
				signal: AbortSignal.timeout(30_000),
			});
			if (existing.status === 404) {
				const created = await fetch(url, {
					method: "POST",
					headers,
					body: JSON.stringify({ name: context.backupBucket }),
					signal: AbortSignal.timeout(30_000),
				});
				if (!created.ok) throw new Error("INSTALLATION_BACKUP_BUCKET_FAILED");
			} else if (!existing.ok) throw new Error("INSTALLATION_BACKUP_BUCKET_FAILED");
		}
		await deployInstance(env, executor(redactedCommandOutput([...hidden, context.token])));
		await installationRunRequest(env, "complete", { status: "deployed" });
		console.log("SuperBoard installation verified.");
	} catch (error) {
		const errorCode = /^[A-Z0-9_:.-]{1,160}$/u.test(error.message)
			? error.message
			: "INSTALLATION_DEPLOYMENT_FAILED";
		await installationRunRequest(env, "complete", { status: "failed", errorCode }).catch(() =>
			console.error("INSTALLATION_STATUS_UPDATE_FAILED"),
		);
		throw new Error(errorCode);
	}
}

async function main() {
	const args = parseArgs();
	if (args.plan) {
		const jobs = await request(process.env, "/runner/jobs");
		await appendFile(
			process.env.GITHUB_OUTPUT,
			`matrix=${JSON.stringify({ include: jobs })}\nhas_jobs=${jobs.length > 0}\n`,
		);
		console.log(`Pending installations: ${jobs.length}`);
	} else await deploy(args, process.env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
	await main();
