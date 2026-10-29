import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { applyCloudflareBootstrapPlan, buildCloudflareBootstrapPlan } from "./bootstrap-core.mjs";
import { cloudflareClient, fetchCloudflareBootstrapInventories } from "./bootstrap.mjs";
import { fetchAppleRootG3, generateDevelopmentSecretAssignments } from "./development-secrets.mjs";
import { root, validateTarget } from "./target.mjs";
import {
	applyWorkerShellPlan,
	buildWorkerShellPlan,
	createPrivateWorkerShell,
} from "./worker-shells.mjs";

export async function installationBuildRequest(env, suffix, method, body) {
	if (
		!/^[a-f0-9]{32}$/iu.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
		!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(
			env.SUPERBOARD_BUILD_TRIGGER_UUID ?? "",
		) ||
		!env.SUPERBOARD_SETUP_API_TOKEN
	)
		throw new Error("INSTALLATION_BUILD_CREDENTIALS_REQUIRED");
	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/builds/triggers/${env.SUPERBOARD_BUILD_TRIGGER_UUID}${suffix}`,
		{
			method,
			headers: {
				Authorization: `Bearer ${env.SUPERBOARD_SETUP_API_TOKEN}`,
				"Content-Type": "application/json",
			},
			...(body ? { body: JSON.stringify(body) } : {}),
			signal: AbortSignal.timeout(30_000),
		},
	);
	if (method === "DELETE" && response.status === 404) return null;
	if (!response.ok) throw new Error(`INSTALLATION_BUILD_API:${response.status}`);
	const result = await response.json();
	if (!result.success) throw new Error("INSTALLATION_BUILD_API_FAILED");
	return result.result;
}

export async function initializeInstance(env) {
	const target = JSON.parse(env.SUPERBOARD_TARGET_MANIFEST);
	await validateTarget(target);
	if (!target.freshInstallation || env.SUPERBOARD_ENVIRONMENT !== "production")
		throw new Error("FRESH_INSTALLATION_REQUIRED");
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	const token = env.SUPERBOARD_SETUP_API_TOKEN;
	const client = cloudflareClient({ accountId, token });
	const inventories = await fetchCloudflareBootstrapInventories({ accountId, token });
	const plan = buildCloudflareBootstrapPlan({
		target,
		environment: "production",
		accountId,
		inventories,
	});
	await applyCloudflareBootstrapPlan(plan, target, {
		confirm: plan.confirmation,
		create: client.create,
	});
	const targetJson = JSON.stringify(target);
	await installationBuildRequest(env, "/environment_variables", "PATCH", {
		SUPERBOARD_TARGET_MANIFEST: { value: targetJson, is_secret: true },
	});
	env.SUPERBOARD_TARGET_MANIFEST = targetJson;
	const workers = await client.listPaged("/workers/scripts");
	const shells = buildWorkerShellPlan({
		target,
		environment: "production",
		accountId,
		existingWorkerNames: workers.map(({ id }) => id),
	});
	await applyWorkerShellPlan(shells, {
		confirm: shells.confirmation,
		create: (worker) => createPrivateWorkerShell(worker, target, env),
	});
	let assignments;
	if (env.SUPERBOARD_INSTALLATION_KEYS) assignments = JSON.parse(env.SUPERBOARD_INSTALLATION_KEYS);
	else {
		assignments = await generateDevelopmentSecretAssignments({
			target,
			environment: "production",
			accountId,
			appleRootBase64: await fetchAppleRootG3(),
			analyticsToken: env.SUPERBOARD_INSTALLATION_ANALYTICS_TOKEN,
		});
		await installationBuildRequest(env, "/environment_variables", "PATCH", {
			SUPERBOARD_INSTALLATION_KEYS: { value: JSON.stringify(assignments), is_secret: true },
		});
		env.SUPERBOARD_INSTALLATION_KEYS = JSON.stringify(assignments);
	}
	return target;
}

export async function installationDeploymentEnvironment(env, manifestPath) {
	if (env.SUPERBOARD_INITIAL_INSTALL !== "1") return env;
	const assignments = JSON.parse(env.SUPERBOARD_INSTALLATION_KEYS);
	const manifest = JSON.parse(await readFile(resolve(root, manifestPath), "utf8"));
	const result = { ...env };
	for (const group of manifest.groups)
		for (const secret of group.secrets) {
			const value =
				assignments[secret.service === "push" ? "api" : secret.service]?.[secret.sourceName];
			if (!value)
				throw new Error(`INSTALLATION_SECRET_REQUIRED:${secret.service}:${secret.sourceName}`);
		}
	return result;
}

export async function finishInstanceInitialization(env) {
	await installationBuildRequest(env, "/environment_variables", "PATCH", {
		SUPERBOARD_INITIAL_INSTALL: { value: "0", is_secret: false },
	});
	await installationBuildRequest(env, "", "PATCH", {
		branch_includes: ["main"],
		branch_excludes: env.SUPERBOARD_AUTOMATIC_UPDATES === "1" ? [] : ["*"],
	});
	await installationBuildRequest(
		env,
		"/environment_variables/SUPERBOARD_INSTALLATION_KEYS",
		"DELETE",
	);
	await installationBuildRequest(
		env,
		"/environment_variables/SUPERBOARD_INSTALLATION_ANALYTICS_TOKEN",
		"DELETE",
	);
	await installationBuildRequest(
		env,
		"/environment_variables/SUPERBOARD_SETUP_API_TOKEN",
		"DELETE",
	);
}
