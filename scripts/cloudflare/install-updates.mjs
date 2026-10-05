import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { backupEncryptionKey } from "../database/d1-backup-crypto.mjs";
import { parseArgs, validateTarget } from "./target.mjs";
import { instanceBranch, instanceBuildConfiguration } from "./workers-builds-config.mjs";

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;

export async function instanceUpdatePlan(input) {
	if (input.schemaVersion !== 1 || !/^[a-f0-9]{32}$/iu.test(input.accountId ?? ""))
		throw new Error("INSTALLATION_ACCOUNT_INVALID");
	if (typeof input.automaticUpdates !== "boolean") throw new Error("AUTOMATIC_UPDATES_REQUIRED");
	for (const key of ["repoConnectionUuid", "buildTokenUuid"])
		if (!uuidPattern.test(input[key] ?? "")) throw new Error(`INSTALLATION_${key}_INVALID`);
	await validateTarget(input.target);
	const branch = instanceBranch(input.environment);
	const workerName = input.target.workers.site[input.environment];
	if (!workerName || !input.target.environments[input.environment])
		throw new Error("INSTALLATION_ENVIRONMENT_MISSING");
	if (
		input.environment === "production" &&
		!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(input.backupBucket ?? "")
	)
		throw new Error("INSTALLATION_BACKUP_BUCKET_REQUIRED");
	return {
		accountId: input.accountId,
		target: input.target.target,
		environment: input.environment,
		branch,
		workerName,
		automaticUpdates: input.automaticUpdates,
		configuration: instanceBuildConfiguration(),
	};
}

export async function installInstanceUpdates(input, { token, backupKey, fetchImpl = fetch } = {}) {
	const plan = await instanceUpdatePlan(input);
	if (!token) throw new Error("CLOUDFLARE_API_TOKEN_REQUIRED");
	if (input.environment === "production") backupEncryptionKey(backupKey);
	const base = `https://api.cloudflare.com/client/v4/accounts/${plan.accountId}`;
	async function request(path, method = "GET", body) {
		const response = await fetchImpl(`${base}${path}`, {
			method,
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			...(body ? { body: JSON.stringify(body) } : {}),
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) throw new Error(`CLOUDFLARE_BUILDS_API:${response.status}`);
		const payload = await response.json();
		if (payload.success !== true) throw new Error("CLOUDFLARE_BUILDS_API:UNSUCCESSFUL");
		return payload;
	}
	async function list(path) {
		const items = [];
		for (let page = 1; page <= 1000; page += 1) {
			const payload = await request(`${path}?page=${page}&per_page=100`);
			if (!Array.isArray(payload.result)) throw new Error("CLOUDFLARE_BUILDS_LIST_INVALID");
			items.push(...payload.result);
			if (payload.result_info?.total_pages != null) {
				if (page >= payload.result_info.total_pages) return items;
			} else if (payload.result.length < 100) return items;
		}
		throw new Error("CLOUDFLARE_BUILDS_PAGINATION_LIMIT");
	}
	const workers = await list("/workers/scripts");
	const site = workers.find(({ id }) => id === plan.workerName);
	if (!/^[a-f0-9]{32}$/iu.test(site?.tag ?? ""))
		throw new Error("INSTALLATION_SITE_WORKER_REQUIRED");
	const triggerName = `superboard-${plan.target}-${plan.environment}`;
	const names = new Set(
		Object.values(input.target.workers).map((value) => value[plan.environment]),
	);
	let existing;
	for (const worker of workers.filter(({ id }) => names.has(id))) {
		const triggers = await list(`/builds/workers/${encodeURIComponent(worker.tag)}/triggers`);
		for (const trigger of triggers) {
			if (trigger.deleted_on) continue;
			if (worker.id !== plan.workerName || trigger.trigger_name !== triggerName || existing)
				throw new Error(`INSTALLATION_CONFLICTING_TRIGGER:${worker.id}`);
			if (
				(trigger.repo_connection_uuid ?? trigger.repo_connection?.repo_connection_uuid) !==
				input.repoConnectionUuid
			)
				throw new Error("INSTALLATION_REPOSITORY_MISMATCH");
			if (!uuidPattern.test(trigger.trigger_uuid ?? ""))
				throw new Error("INSTALLATION_TRIGGER_INVALID");
			existing = trigger;
		}
	}
	const configuration = {
		build_token_uuid: input.buildTokenUuid,
		trigger_name: triggerName,
		build_command: plan.configuration.buildCommand,
		deploy_command: plan.configuration.deployCommand,
		root_directory: "/",
		branch_includes: [plan.branch],
		branch_excludes: ["*"],
		path_includes: ["*"],
		path_excludes: [],
		build_caching_enabled: true,
	};
	const trigger = existing
		? (await request(`/builds/triggers/${existing.trigger_uuid}`, "PATCH", configuration)).result
		: (
				await request("/builds/triggers", "POST", {
					...configuration,
					external_script_id: site.tag,
					repo_connection_uuid: input.repoConnectionUuid,
				})
			).result;
	if (!uuidPattern.test(trigger?.trigger_uuid ?? ""))
		throw new Error("INSTALLATION_TRIGGER_INVALID");
	const triggerPath = `/builds/triggers/${trigger.trigger_uuid}`;
	const variable = (value, is_secret = false) => ({ value, is_secret });
	await request(`${triggerPath}/environment_variables`, "PATCH", {
		NODE_VERSION: variable("24"),
		CLOUDFLARE_ACCOUNT_ID: variable(plan.accountId),
		SUPERBOARD_TARGET: variable(plan.target),
		SUPERBOARD_ENVIRONMENT: variable(plan.environment),
		SUPERBOARD_TARGET_MANIFEST: variable(JSON.stringify(input.target), true),
		...(input.backupBucket ? { SUPERBOARD_BACKUP_R2_BUCKET: variable(input.backupBucket) } : {}),
		...(input.environment === "production"
			? { SUPERBOARD_BACKUP_ENCRYPTION_KEY: variable(backupKey, true) }
			: {}),
	});
	await request(triggerPath, "PATCH", {
		...configuration,
		branch_excludes: plan.automaticUpdates ? [] : ["*"],
	});
	const verified = (await list(`/builds/workers/${site.tag}/triggers`)).find(
		(value) => value.trigger_uuid === trigger.trigger_uuid,
	);
	if (
		!verified ||
		JSON.stringify(verified.branch_includes) !== JSON.stringify([plan.branch]) ||
		JSON.stringify(verified.branch_excludes) !== JSON.stringify(plan.automaticUpdates ? [] : ["*"])
	)
		throw new Error("INSTALLATION_TRIGGER_VERIFICATION_FAILED");
	return { ...plan, triggerUuid: trigger.trigger_uuid, status: "configured" };
}

async function main() {
	const args = parseArgs();
	if (typeof args.installation !== "string")
		throw new Error("--installation <file.json> is required");
	const input = JSON.parse(await readFile(resolve(args.installation), "utf8"));
	if (typeof args["target-file"] === "string") {
		input.target = JSON.parse(await readFile(resolve(args["target-file"]), "utf8"));
		input.environment = args.environment;
	}
	const result = args.apply
		? await installInstanceUpdates(input, {
				token: process.env.CLOUDFLARE_API_TOKEN,
				backupKey: process.env.SUPERBOARD_BACKUP_ENCRYPTION_KEY,
			})
		: { ...(await instanceUpdatePlan(input)), status: "plan" };
	console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
	await main();
