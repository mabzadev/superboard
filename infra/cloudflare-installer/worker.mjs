import { installationTarget } from "../../scripts/cloudflare/installation-target.mjs";
import { instanceBuildConfiguration } from "../../scripts/cloudflare/workers-builds-config.mjs";
import { installerPage } from "./page.mjs";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const account = /^[a-f0-9]{32}$/u;

async function installationSourceAvailable(fetchImpl) {
	try {
		const response = await fetchImpl(
			"https://raw.githubusercontent.com/mabzadev/superboard/main/scripts/cloudflare/workers-builds.mjs",
			{ method: "HEAD", signal: AbortSignal.timeout(10_000) },
		);
		return response.ok;
	} catch {
		return false;
	}
}

export function installerApi(token, fetchImpl = fetch) {
	return {
		async request(path, method = "GET", body) {
			const multipart = body instanceof FormData;
			const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					...(!multipart ? { "Content-Type": "application/json" } : {}),
				},
				...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
				signal: AbortSignal.timeout(30_000),
			});
			if (!response.ok) throw new Error(`CLOUDFLARE_API_${response.status}`);
			const payload = await response.json();
			if (!payload.success) throw new Error("CLOUDFLARE_API_FAILED");
			return payload;
		},
		async list(path) {
			const items = [];
			for (let page = 1; page <= 1000; page += 1) {
				const payload = await this.request(
					`${path}${path.includes("?") ? "&" : "?"}page=${page}&per_page=100`,
				);
				if (!Array.isArray(payload.result)) throw new Error("CLOUDFLARE_LIST_INVALID");
				items.push(...payload.result);
				if (
					payload.result_info?.total_pages != null
						? page >= payload.result_info.total_pages
						: payload.result.length < 100
				)
					return items;
			}
			throw new Error("CLOUDFLARE_PAGINATION_LIMIT");
		},
	};
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
		async fetch(request) {
			const url = new URL(request.url);
			const headers = {
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
				"Referrer-Policy": "no-referrer",
			};
			if (request.method === "GET" && url.pathname === "/api/readiness")
				return Response.json(
					{ available: await installationSourceAvailable(fetchImpl) },
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
			if (
				request.method !== "POST" ||
				request.headers.get("Origin") !== url.origin ||
				request.headers.get("X-SuperBoard-Request") !== "1"
			)
				return Response.json({ error: "INSTALLATION_REQUEST_REJECTED" }, { status: 403, headers });
			const authorization = request.headers.get("Authorization") ?? "";
			if (!/^Bearer [A-Za-z0-9_-]{20,256}$/u.test(authorization))
				return Response.json({ error: "INSTALLATION_TOKEN_REQUIRED" }, { status: 401, headers });
			try {
				const text = await request.text();
				if (text.length > 4096)
					return Response.json({ error: "INSTALLATION_INPUT_TOO_LARGE" }, { status: 413, headers });
				const input = JSON.parse(text);
				const token = authorization.slice(7);
				const api = installerApi(token, fetchImpl);
				let result;
				if (url.pathname === "/api/accounts")
					result = (await api.list("/accounts")).map(({ id, name }) => ({ id, name }));
				else if (url.pathname === "/api/options" && account.test(input.accountId ?? ""))
					result = {
						zones: (await api.list(`/zones?account.id=${input.accountId}`))
							.filter(({ status }) => status === "active")
							.map(({ name }) => name),
						tokens: (await api.list(`/accounts/${input.accountId}/builds/tokens`)).map(
							({ build_token_uuid, build_token_name }) => ({
								id: build_token_uuid,
								name: build_token_name,
							}),
						),
					};
				else if (url.pathname === "/api/install")
					result = await startInstallation(input, token, fetchImpl);
				else
					return Response.json({ error: "INSTALLATION_ROUTE_NOT_FOUND" }, { status: 404, headers });
				return Response.json({ result }, { headers });
			} catch (error) {
				const code = /^(?:INSTALLATION|CLOUDFLARE)_[A-Z0-9_]+$/u.test(error.message)
					? error.message
					: "INSTALLATION_FAILED";
				return Response.json({ error: code }, { status: 400, headers });
			}
		},
	};
}

export default createInstaller();
