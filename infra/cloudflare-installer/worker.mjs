import { readBuildVariable } from "../../scripts/cloudflare/build-variables.mjs";
import { installerApi } from "./cloudflare-api.mjs";
import { installationRegistry } from "./installations.mjs";
import { installerOAuth, oauthConfigured } from "./oauth.mjs";
import { runnerIdentity } from "./runner-identity.mjs";
export { installerApi } from "./cloudflare-api.mjs";
import { installationTarget } from "../../scripts/cloudflare/installation-target.mjs";
import { instanceBuildConfiguration } from "../../scripts/cloudflare/workers-builds-config.mjs";
import { installerPage } from "./page.mjs";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const account = /^[a-f0-9]{32}$/u;

async function installationSourceAvailable(fetchImpl, source = "workers-builds.mjs") {
	try {
		const response = await fetchImpl(
			`https://raw.githubusercontent.com/mabzadev/superboard/main/scripts/cloudflare/${source}`,
			{ method: "HEAD", signal: AbortSignal.timeout(10_000) },
		);
		return response.ok;
	} catch {
		return false;
	}
}

export async function startInstallation(input, token, fetchImpl = fetch) {
	if (
		!/^[A-Za-z0-9_-]{20,256}$/u.test(input.analyticsToken ?? "") ||
		input.analyticsToken === token
	)
		throw new Error("INSTALLATION_ANALYTICS_TOKEN_REQUIRED");
	if (
		!account.test(input.accountId ?? "") ||
		!uuid.test(input.installationId ?? "") ||
		!uuid.test(input.buildTokenUuid ?? "") ||
		typeof input.automaticUpdates !== "boolean"
	)
		throw new Error("INSTALLATION_INPUT_INVALID");
	if (!(await installationSourceAvailable(fetchImpl)))
		throw new Error("INSTALLATION_SOURCE_NOT_PUBLISHED");
	const api = installerApi(token, fetchImpl);
	const base = `/accounts/${input.accountId}`;
	const accounts = await api.list("/accounts");
	if (!accounts.some(({ id }) => id === input.accountId))
		throw new Error("INSTALLATION_ACCOUNT_UNAVAILABLE");
	const zones = await api.list(`/zones?account.id=${input.accountId}`);
	const zone = zones.find(({ name, status }) => name === input.domain && status === "active");
	if (!zone) throw new Error("INSTALLATION_ACTIVE_ZONE_REQUIRED");
	const tokens = await api.list(`${base}/builds/tokens`);
	if (!tokens.some(({ build_token_uuid }) => build_token_uuid === input.buildTokenUuid))
		throw new Error("INSTALLATION_BUILD_TOKEN_UNAVAILABLE");
	const subdomain = (await api.request(`${base}/workers/subdomain`)).result?.subdomain;
	if (!subdomain) throw new Error("INSTALLATION_WORKERS_SUBDOMAIN_REQUIRED");
	const target = installationTarget({ ...input, workersDevSubdomain: subdomain });
	const workerName = target.workers.site.production;
	const triggerName = `superboard-${target.target}-production`;
	let existingTrigger;
	const workers = await api.list(`${base}/workers/scripts`);
	let site = workers.find(({ id }) => id === workerName);
	if (site) {
		const settings = (await api.request(`${base}/workers/scripts/${workerName}/settings`)).result;
		if (
			!settings?.bindings?.some(
				({ name, text }) => name === "SUPERBOARD_INSTALLATION_ID" && text === input.installationId,
			)
		)
			throw new Error("INSTALLATION_WORKER_ALREADY_EXISTS");
		const triggers = await api.list(`${base}/builds/workers/${site.tag}/triggers`);
		if (triggers.length > 1 || (triggers.length === 1 && triggers[0].trigger_name !== triggerName))
			throw new Error("INSTALLATION_TRIGGER_CONFLICT");
		if (triggers.length) {
			existingTrigger = triggers[0];
			const variables = (
				await api.request(
					`${base}/builds/triggers/${existingTrigger.trigger_uuid}/environment_variables`,
				)
			).result;
			if (
				[
					"SUPERBOARD_TARGET_MANIFEST",
					"SUPERBOARD_INITIAL_INSTALL",
					"SUPERBOARD_SETUP_API_TOKEN",
					"SUPERBOARD_BACKUP_ENCRYPTION_KEY",
				].every((name) => Object.hasOwn(variables, name))
			)
				return {
					status: "registered",
					target: target.target,
					dashboard: `https://dash.cloudflare.com/${input.accountId}/workers/services/view/${workerName}/production/settings`,
				};
		}
	} else {
		const domains = new Set(Object.values(target.domains));
		const records = await api.list(`/zones/${zone.id}/dns_records`);
		if (records.some(({ name }) => domains.has(name)))
			throw new Error("INSTALLATION_DOMAIN_ALREADY_USED");
		const routes = await api.list(`/zones/${zone.id}/workers/routes`);
		if (
			routes.some(({ pattern }) =>
				[...domains].some((domain) => pattern.includes(domain) || pattern.startsWith("*")),
			)
		)
			throw new Error("INSTALLATION_ROUTE_ALREADY_USED");
		const form = new FormData();
		form.set(
			"metadata",
			JSON.stringify({
				main_module: "index.mjs",
				compatibility_date: "2026-09-01",
				bindings: [
					{ type: "plain_text", name: "SUPERBOARD_INSTALLATION_ID", text: input.installationId },
				],
			}),
		);
		form.set(
			"index.mjs",
			new Blob(
				[
					"export default { fetch() { return new Response('Installation in progress', { status: 503 }); } };",
				],
				{ type: "application/javascript+module" },
			),
			"index.mjs",
		);
		await api.request(`${base}/workers/scripts/${workerName}`, "PUT", form);
		await api.request(`${base}/workers/scripts/${workerName}/subdomain`, "POST", {
			enabled: false,
		});
		site = (await api.list(`${base}/workers/scripts`)).find(({ id }) => id === workerName);
	}
	if (!account.test(site?.tag ?? "")) throw new Error("INSTALLATION_WORKER_TAG_MISSING");
	const repositoryResponse = await fetchImpl("https://api.github.com/repos/mabzadev/superboard", {
		headers: { Accept: "application/vnd.github+json", "User-Agent": "SuperBoard-Installer" },
		signal: AbortSignal.timeout(30_000),
	});
	if (!repositoryResponse.ok) throw new Error("INSTALLATION_SOURCE_UNAVAILABLE");
	const repository = await repositoryResponse.json();
	if (repository.full_name !== "mabzadev/superboard" || !repository.id || !repository.owner?.id)
		throw new Error("INSTALLATION_SOURCE_INVALID");
	const connection = (
		await api.request(`${base}/builds/repos/connections`, "PUT", {
			provider_type: "github",
			provider_account_id: String(repository.owner.id),
			provider_account_name: "mabzadev",
			repo_id: String(repository.id),
			repo_name: "superboard",
		})
	).result;
	if (!uuid.test(connection?.repo_connection_uuid ?? ""))
		throw new Error("INSTALLATION_GITHUB_CONNECTION_REQUIRED");
	const configuration = instanceBuildConfiguration();
	const trigger =
		existingTrigger ??
		(
			await api.request(`${base}/builds/triggers`, "POST", {
				external_script_id: site.tag,
				repo_connection_uuid: connection.repo_connection_uuid,
				build_token_uuid: input.buildTokenUuid,
				trigger_name: triggerName,
				build_command: configuration.buildCommand,
				deploy_command: configuration.deployCommand,
				root_directory: "/",
				branch_includes: ["main"],
				branch_excludes: ["*"],
				path_includes: ["*"],
				path_excludes: [],
				build_caching_enabled: true,
			})
		).result;
	if (!uuid.test(trigger?.trigger_uuid ?? "")) throw new Error("INSTALLATION_TRIGGER_INVALID");
	const bucket = `superboard-${target.target}-backups`;
	try {
		await api.request(`${base}/r2/buckets/${bucket}`);
	} catch (error) {
		if (error.message !== "CLOUDFLARE_API_404") throw error;
		await api.request(`${base}/r2/buckets`, "POST", { name: bucket });
	}
	const variable = (value, is_secret = false) => ({ value, is_secret });
	const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
	await api.request(
		`${base}/builds/triggers/${trigger.trigger_uuid}/environment_variables`,
		"PATCH",
		{
			NODE_VERSION: variable("24"),
			CLOUDFLARE_ACCOUNT_ID: variable(input.accountId),
			SUPERBOARD_TARGET: variable(target.target),
			SUPERBOARD_ENVIRONMENT: variable("production"),
			SUPERBOARD_TARGET_MANIFEST: variable(JSON.stringify(target), true),
			SUPERBOARD_INITIAL_INSTALL: variable("1"),
			SUPERBOARD_AUTOMATIC_UPDATES: variable(input.automaticUpdates ? "1" : "0"),
			SUPERBOARD_BUILD_TRIGGER_UUID: variable(trigger.trigger_uuid),
			SUPERBOARD_SETUP_API_TOKEN: variable(token, true),
			SUPERBOARD_INSTALLATION_ANALYTICS_TOKEN: variable(input.analyticsToken, true),
			SUPERBOARD_BACKUP_R2_BUCKET: variable(bucket),
			SUPERBOARD_BACKUP_ENCRYPTION_KEY: variable(key, true),
		},
	);
	const build = (
		await api.request(`${base}/builds/triggers/${trigger.trigger_uuid}/builds`, "POST", {
			branch: "main",
		})
	).result;
	return {
		status: "queued",
		target: target.target,
		buildUuid: build?.build_uuid,
		dashboard: `https://dash.cloudflare.com/${input.accountId}/workers/services/view/${workerName}/production/deployments`,
	};
}

export function createInstaller(fetchImpl = fetch) {
	return {
		async fetch(request, env = {}) {
			const url = new URL(request.url);
			const headers = {
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
				"Referrer-Policy": "no-referrer",
			};
			try {
				if (request.method === "GET" && url.pathname === "/api/readiness")
					return Response.json(
						{
							available:
								oauthConfigured(env) &&
								env.INSTALLER_RUNNER_ENABLED === "1" &&
								(await installationSourceAvailable(fetchImpl, "installation-runner.mjs")),
						},
						{ headers },
					);
				if (request.method === "GET" && url.pathname === "/")
					return new Response(installerPage(url.searchParams.get("lang")), {
						headers: {
							...headers,
							"Content-Type": "text/html; charset=utf-8",
							"Content-Security-Policy":
								"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
						},
					});
				if (request.method === "GET" && url.pathname === "/oauth/start")
					return await installerOAuth(env, fetchImpl).start(request);
				if (request.method === "GET" && url.pathname === "/oauth/callback")
					return await installerOAuth(env, fetchImpl).callback(request);
				if (url.pathname.startsWith("/runner/")) {
					if (env.INSTALLER_RUNNER_ENABLED !== "1")
						throw new Error("INSTALLATION_RUNNER_UNAVAILABLE");
					const registry = installationRegistry(env, fetchImpl);
					if (url.pathname === "/runner/jobs" && request.method === "GET") {
						const identity = await runnerIdentity(request, fetchImpl);
						return Response.json({ result: await registry.jobs(identity) }, { headers });
					}
					if (url.pathname === "/runner/claim" && request.method === "POST") {
						const identity = await runnerIdentity(request, fetchImpl);
						const input = await readInput(request);
						return Response.json(
							{ result: await registry.claim(input.id, input.revision, identity) },
							{ headers },
						);
					}
					const match = url.pathname.match(
						/^\/runner\/runs\/([a-f0-9-]{36})\/(context|state|complete)$/u,
					);
					if (!match || request.method !== "POST")
						return Response.json(
							{ error: "INSTALLATION_ROUTE_NOT_FOUND" },
							{ status: 404, headers },
						);
					const result =
						match[2] === "context"
							? await registry.context(request, match[1])
							: match[2] === "state"
								? await registry.persist(request, match[1], await readInput(request))
								: await registry.complete(request, match[1], await readInput(request));
					return Response.json({ result }, { headers });
				}
				if (request.method === "GET" && url.pathname === "/api/session") {
					const authorization = await installerOAuth(env, fetchImpl).authorization(request);
					const api = installerApi(authorization.token, fetchImpl);
					const user = (await api.request("/user")).result;
					return Response.json(
						{
							result: {
								authenticated: true,
								email: user.email,
								accounts: (await api.list("/accounts")).map(({ id, name }) => ({ id, name })),
							},
						},
						{ headers },
					);
				}
				if (
					request.method !== "POST" ||
					request.headers.get("Origin") !== url.origin ||
					request.headers.get("X-SuperBoard-Request") !== "1"
				)
					return Response.json(
						{ error: "INSTALLATION_REQUEST_REJECTED" },
						{ status: 403, headers },
					);
				if (url.pathname === "/api/logout")
					return await installerOAuth(env, fetchImpl).logout(request);
				const bearer = request.headers.get("Authorization") ?? "";
				const legacy = /^Bearer [A-Za-z0-9_-]{20,256}$/u.test(bearer);
				const authorization = legacy
					? null
					: await installerOAuth(env, fetchImpl).authorization(request);
				const token = legacy ? bearer.slice(7) : authorization.token;
				const input = await readInput(request, 4096);
				const api = installerApi(token, fetchImpl);
				let result;
				if (url.pathname === "/api/accounts")
					result = (await api.list("/accounts")).map(({ id, name }) => ({ id, name }));
				else if (url.pathname === "/api/options" && account.test(input.accountId ?? ""))
					result = {
						development: await (async () => {
							const configured = JSON.parse(
								(await readBuildVariable(env, "INSTALLER_DEVELOPMENT_TARGET")) ?? "null",
							);
							return configured?.accountId === input.accountId ? configured.target.target : null;
						})(),
						zones: (await api.list("/zones?account.id=" + input.accountId))
							.filter(({ status }) => status === "active")
							.map(({ name }) => name),
						...(legacy
							? {
									tokens: (await api.list("/accounts/" + input.accountId + "/builds/tokens")).map(
										({ build_token_uuid, build_token_name }) => ({
											id: build_token_uuid,
											name: build_token_name,
										}),
									),
								}
							: {}),
					};
				else if (url.pathname === "/api/install" && legacy)
					result = await startInstallation(input, token, fetchImpl);
				else if (
					authorization &&
					[
						"/api/install",
						"/api/instances",
						"/api/instances/configure",
						"/api/instances/development",
					].includes(url.pathname)
				) {
					if (env.INSTALLER_RUNNER_ENABLED !== "1")
						throw new Error("INSTALLATION_RUNNER_UNAVAILABLE");
					const registry = installationRegistry(env, fetchImpl);
					const owner = await registry.owner(authorization);
					result =
						url.pathname === "/api/instances/development"
							? await registry.adoptDevelopment(input, authorization, owner)
							: url.pathname === "/api/install"
								? await registry.register(input, authorization, owner)
								: url.pathname === "/api/instances"
									? await registry.list(owner)
									: await registry.configure(input.id, owner, input, authorization);
				} else
					return Response.json({ error: "INSTALLATION_ROUTE_NOT_FOUND" }, { status: 404, headers });
				return Response.json({ result }, { headers });
			} catch (error) {
				const code = /^(?:INSTALLATION|CLOUDFLARE)_[A-Z0-9_]+$/u.test(error.message)
					? error.message
					: "INSTALLATION_FAILED";
				const status = /SESSION_|UNAUTHORIZED/u.test(code)
					? 401
					: /NOT_CONFIGURED|UNAVAILABLE$|AUTHORIZATION_BUSY$/u.test(code)
						? 503
						: /ALREADY_RUNNING|CONFLICT$/u.test(code)
							? 409
							: 400;
				return Response.json({ error: code }, { status, headers });
			}
		},
	};
}

async function readInput(request, maximum = 250_000) {
	const reader = request.body?.getReader();
	if (!reader) throw new Error("INSTALLATION_INPUT_INVALID");
	const decoder = new TextDecoder();
	let text = "";
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maximum) {
			await reader.cancel();
			throw new Error("INSTALLATION_INPUT_TOO_LARGE");
		}
		text += decoder.decode(value, { stream: true });
	}
	const value = JSON.parse(text + decoder.decode());
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("INSTALLATION_INPUT_INVALID");
	return value;
}

export default createInstaller();
