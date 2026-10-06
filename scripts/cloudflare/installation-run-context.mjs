export function validateInstallationRunContext(env) {
	if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REPOSITORY !== "mabzadev/superboard")
		throw new Error("INSTALLATION_RUNNER_REQUIRED");
	if (
		!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(env.SUPERBOARD_INSTALLATION_RUN_ID ?? "")
	)
		throw new Error("INSTALLATION_RUN_INVALID");
	const branch =
		env.SUPERBOARD_ENVIRONMENT === "development"
			? "dev"
			: env.SUPERBOARD_ENVIRONMENT === "production"
				? "main"
				: null;
	if (!branch || env.SUPERBOARD_SOURCE_BRANCH !== branch)
		throw new Error("INSTALLATION_BRANCH_MISMATCH");
	if (
		!/^[a-f0-9]{40}$/u.test(env.SUPERBOARD_SOURCE_REVISION ?? "") ||
		!/^[a-f0-9]{32}$/u.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
		!/^[a-z][a-z0-9-]{1,30}$/u.test(env.SUPERBOARD_TARGET ?? "")
	)
		throw new Error("INSTALLATION_CONTEXT_INVALID");
	return {
		authority: "github-actions",
		runId: env.SUPERBOARD_INSTALLATION_RUN_ID,
		branch,
		revision: env.SUPERBOARD_SOURCE_REVISION,
		accountId: env.CLOUDFLARE_ACCOUNT_ID,
		target: env.SUPERBOARD_TARGET,
		environment: env.SUPERBOARD_ENVIRONMENT,
	};
}

export async function installationRunRequest(env, action, body, fetchImpl = fetch) {
	validateInstallationRunContext(env);
	const origin = new URL(env.SUPERBOARD_INSTALLER_ORIGIN);
	if (
		origin.protocol !== "https:" ||
		origin.origin !== env.SUPERBOARD_INSTALLER_ORIGIN ||
		!/^[A-Za-z0-9_-]{43}$/u.test(env.SUPERBOARD_INSTALLATION_RUN_LEASE ?? "") ||
		!["context", "state", "complete"].includes(action)
	)
		throw new Error("INSTALLATION_RUN_CREDENTIALS_INVALID");

	for (let attempt = 0; attempt < 12; attempt += 1) {
		const response = await fetchImpl(
			`${origin.origin}/runner/runs/${env.SUPERBOARD_INSTALLATION_RUN_ID}/${action}`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${env.SUPERBOARD_INSTALLATION_RUN_LEASE}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body ?? {}),
				signal: AbortSignal.timeout(30_000),
				redirect: "error",
			},
		);
		const result = await response.json();
		if (response.ok) return result.result;
		if (
			response.status === 503 &&
			["INSTALLATION_AUTHORIZATION_BUSY", "INSTALLATION_AUTHORIZATION_UNAVAILABLE"].includes(
				result.error,
			) &&
			attempt < 11
		) {
			await new Promise((resolveDelay) => {
				setTimeout(resolveDelay, Math.min(1000 * 2 ** attempt, 8000));
			});
			continue;
		}
		throw new Error(`INSTALLATION_RUN_API:${response.status}`);
	}
	throw new Error("INSTALLATION_AUTHORIZATION_UNAVAILABLE");
}
