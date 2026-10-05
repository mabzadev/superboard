export function instanceBuildConfiguration() {
	return {
		authority: "cloudflare-workers-builds",
		mode: "per-instance",
		buildCommand: "pnpm install --frozen-lockfile && pnpm cloudflare:builds:build",
		deployCommand: "pnpm cloudflare:builds:deploy",
		buildVariables: ["CLOUDFLARE_ACCOUNT_ID", "SUPERBOARD_ENVIRONMENT", "SUPERBOARD_TARGET"],
		nonProductionBranchBuilds: false,
	};
}

export function instanceBranch(environment) {
	if (environment === "development") return "dev";
	if (environment === "production") return "main";
	throw new Error("CLOUDFLARE_BUILD_ENVIRONMENT_INVALID");
}

export function validateBuildContext(env) {
	if (env.WORKERS_CI !== "1") throw new Error("CLOUDFLARE_WORKERS_BUILDS_REQUIRED");
	const branch = instanceBranch(env.SUPERBOARD_ENVIRONMENT);
	if (env.WORKERS_CI_BRANCH !== branch) throw new Error("CLOUDFLARE_BUILD_BRANCH_MISMATCH");
	if (!/^[a-f0-9]{40}$/u.test(env.WORKERS_CI_COMMIT_SHA ?? ""))
		throw new Error("CLOUDFLARE_BUILD_REVISION_INVALID");
	if (!/^[a-f0-9]{32}$/iu.test(env.CLOUDFLARE_ACCOUNT_ID ?? ""))
		throw new Error("CLOUDFLARE_BUILD_ACCOUNT_INVALID");
	if (!/^[a-z][a-z0-9-]{1,30}$/u.test(env.SUPERBOARD_TARGET ?? ""))
		throw new Error("CLOUDFLARE_BUILD_TARGET_INVALID");
	return {
		branch,
		revision: env.WORKERS_CI_COMMIT_SHA,
		accountId: env.CLOUDFLARE_ACCOUNT_ID,
		target: env.SUPERBOARD_TARGET,
		environment: env.SUPERBOARD_ENVIRONMENT,
	};
}
