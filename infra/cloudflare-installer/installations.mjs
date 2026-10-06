import { readBuildVariable } from "../../scripts/cloudflare/build-variables.mjs";
import { installationTarget } from "../../scripts/cloudflare/installation-target.mjs";
import { installerApi } from "./cloudflare-api.mjs";
import { cloudflareGrantToken, encryptedStore } from "./encrypted-store.mjs";

const repository = "mabzadev/superboard";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const account = /^[a-f0-9]{32}$/u;

async function hash(value) {
	return Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
		(byte) => byte.toString(16).padStart(2, "0"),
	).join("");
}

async function github(path, fetchImpl) {
	const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
		headers: { Accept: "application/vnd.github+json", "User-Agent": "SuperBoard-Installer" },
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) throw new Error("INSTALLATION_SOURCE_UNAVAILABLE");
	return response.json();
}

async function sourceRevision(environment, fetchImpl) {
	const branch = environment === "development" ? "dev" : "main";
	const result = await github(`/commits/${encodeURIComponent(branch)}`, fetchImpl);
	if (!/^[a-f0-9]{40}$/u.test(result.sha ?? "")) throw new Error("INSTALLATION_SOURCE_INVALID");
	return result.sha;
}

export function installationRegistry(env, fetchImpl = fetch) {
	const db = env.INSTALLER_DB;
	const store = encryptedStore(env);
	function canDeployProduction(identity) {
		if (!identity || !["refs/heads/main", "refs/heads/dev"].includes(identity.ref))
			throw new Error("INSTALLATION_RUNNER_UNAUTHORIZED");
		return identity.ref === "refs/heads/main";
	}
	async function reauthorize(row, authorization) {
		if (!authorization?.refreshToken) throw new Error("INSTALLATION_AUTHORIZATION_REQUIRED");
		if (
			!(await installerApi(authorization.token, fetchImpl).list("/accounts")).some(
				({ id }) => id === row.account_id,
			)
		)
			throw new Error("INSTALLATION_ACCOUNT_AUTHORIZATION_REQUIRED");
		await store.put(`grant:${authorization.id}`, authorization, undefined, true);
		await db
			.prepare(
				"UPDATE installer_installations SET grant_id=?,updated_at=? WHERE id=? AND account_id=? AND owner_id=?",
			)
			.bind(authorization.id, Date.now(), row.id, row.account_id, row.owner_id)
			.run();
	}
	async function runFinished(row) {
		if (!row.github_run_id) return true;
		const result = await github(`/actions/runs/${row.github_run_id}/jobs?per_page=100`, fetchImpl);
		return (
			result.jobs?.some((job) => job.name === `Install ${row.id}` && job.status === "completed") ===
			true
		);
	}
	async function owned(id, owner) {
		const row = await db
			.prepare("SELECT * FROM installer_installations WHERE id = ? AND owner_id = ?")
			.bind(id, owner)
			.first();
		if (!row) throw new Error("INSTALLATION_NOT_FOUND");
		return row;
	}
	async function run(request, id) {
		const token = request.headers.get("Authorization")?.replace(/^Bearer /u, "");
		if (!/^[A-Za-z0-9_-]{43}$/u.test(token ?? "")) throw new Error("INSTALLATION_RUN_UNAUTHORIZED");
		const row = await db
			.prepare(
				"SELECT * FROM installer_installations WHERE run_id = ? AND lease_hash = ? AND lease_expires > ? AND status = 'deploying'",
			)
			.bind(id, await hash(token), Date.now())
			.first();
		if (!row) throw new Error("INSTALLATION_RUN_UNAUTHORIZED");
		return row;
	}
	return {
		async adoptDevelopment(input, authorization, owner) {
			const configured = JSON.parse(
				(await readBuildVariable(env, "INSTALLER_DEVELOPMENT_TARGET")) ?? "null",
			);
			if (
				!configured ||
				configured.accountId !== input.accountId ||
				!uuid.test(configured.id ?? "") ||
				!authorization.refreshToken
			)
				throw new Error("INSTALLATION_DEVELOPMENT_UNAVAILABLE");
			const { target, id } = configured;
			const api = installerApi(authorization.token, fetchImpl);
			if (
				!(await api.list("/accounts")).some(
					({ id: accountId }) => accountId === configured.accountId,
				)
			)
				throw new Error("INSTALLATION_ACCOUNT_UNAVAILABLE");
			const workers = await api.list(`/accounts/${configured.accountId}/workers/scripts`);
			if (!workers.some(({ id: name }) => name === target.workers.site.development))
				throw new Error("INSTALLATION_DEVELOPMENT_UNAVAILABLE");
			const existing = await db
				.prepare("SELECT * FROM installer_installations WHERE id=?")
				.bind(id)
				.first();
			if (existing) {
				if (
					existing.owner_id !== owner ||
					existing.account_id !== configured.accountId ||
					existing.environment !== "development"
				)
					throw new Error("INSTALLATION_ID_CONFLICT");
				if (existing.status !== "deploying") await reauthorize(existing, authorization);
				return { id, status: existing.status };
			}
			const revision = await sourceRevision("development", fetchImpl);
			await store.put(`grant:${authorization.id}`, authorization, undefined, true);
			await store.put(
				`instance:${id}`,
				{ owner, accountId: configured.accountId, target, initial: false },
				undefined,
				true,
			);
			const saved = await store.get(`instance:${id}`);
			if (saved.owner !== owner || saved.accountId !== configured.accountId)
				throw new Error("INSTALLATION_ID_CONFLICT");
			await db
				.prepare(
					"INSERT INTO installer_installations (id,owner_id,account_id,grant_id,environment,target_name,automatic_updates,status,desired_revision,created_at,updated_at) VALUES (?,?,?,?,'development',?,1,'queued',?,?,?) ON CONFLICT(id) DO NOTHING",
				)
				.bind(
					id,
					owner,
					configured.accountId,
					authorization.id,
					target.target,
					revision,
					Date.now(),
					Date.now(),
				)
				.run();
			return { id, status: "queued" };
		},
		async owner(authorization) {
			const user = (await installerApi(authorization.token, fetchImpl).request("/user")).result;
			if (!account.test(user?.id ?? "")) throw new Error("INSTALLATION_USER_UNAVAILABLE");
			return user.id;
		},
		async list(owner) {
			const rows = (
				await db
					.prepare(
						"SELECT id, account_id, environment, target_name, automatic_updates, status, deployed_revision, github_run_id, error_code FROM installer_installations WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100",
					)
					.bind(owner)
					.all()
			).results;
			return Promise.all(
				rows.map(async (row) => ({
					...row,
					site: (await store.get(`instance:${row.id}`))?.target?.domains?.site,
				})),
			);
		},
		async register(input, authorization, owner) {
			const registrationHash = await hash(
				JSON.stringify({
					owner,
					accountId: input.accountId,
					name: input.name,
					domain: input.domain,
					email: input.email,
					automaticUpdates: input.automaticUpdates,
				}),
			);
			if (
				!uuid.test(input.installationId ?? "") ||
				!account.test(input.accountId ?? "") ||
				typeof input.automaticUpdates !== "boolean" ||
				!authorization.refreshToken
			)
				throw new Error("INSTALLATION_INPUT_INVALID");
			const api = installerApi(authorization.token, fetchImpl);
			if (!(await api.list("/accounts")).some(({ id }) => id === input.accountId))
				throw new Error("INSTALLATION_ACCOUNT_UNAVAILABLE");
			const base = `/accounts/${input.accountId}`;
			const zones = await api.list(`/zones?account.id=${input.accountId}`);
			const zone = zones.find(({ name, status }) => name === input.domain && status === "active");
			if (!zone) throw new Error("INSTALLATION_ACTIVE_ZONE_REQUIRED");
			const subdomain = (await api.request(`${base}/workers/subdomain`)).result?.subdomain;
			if (!subdomain) throw new Error("INSTALLATION_WORKERS_SUBDOMAIN_REQUIRED");
			const target = installationTarget({
				...input,
				workersDevSubdomain: subdomain,
				hostPrefix: `${input.name}-${input.installationId.slice(0, 8)}`,
			});
			const existing = await db
				.prepare("SELECT * FROM installer_installations WHERE id = ?")
				.bind(input.installationId)
				.first();
			if (existing) {
				const state = await store.get(`instance:${input.installationId}`);
				if (
					existing.owner_id !== owner ||
					existing.account_id !== input.accountId ||
					state.target.target !== target.target ||
					state.target.zoneName !== target.zoneName ||
					state.target.operator?.email !== target.operator?.email
				)
					throw new Error("INSTALLATION_ID_CONFLICT");
				if (state.registrationHash !== registrationHash)
					throw new Error("INSTALLATION_ID_CONFLICT");
				if (existing.status !== "deploying") await reauthorize(existing, authorization);
				return { id: existing.id, status: existing.status };
			}
			const names = new Set(Object.values(target.workers).flatMap((value) => Object.values(value)));
			if ((await api.list(`${base}/workers/scripts`)).some(({ id }) => names.has(id)))
				throw new Error("INSTALLATION_WORKER_ALREADY_EXISTS");
			const domains = new Set(Object.values(target.domains));
			if ((await api.list(`/zones/${zone.id}/dns_records`)).some(({ name }) => domains.has(name)))
				throw new Error("INSTALLATION_DOMAIN_ALREADY_USED");
			if (
				(await api.list(`/zones/${zone.id}/workers/routes`)).some(({ pattern }) =>
					[...domains].some((domain) => pattern.includes(domain) || pattern.startsWith("*")),
				)
			)
				throw new Error("INSTALLATION_ROUTE_ALREADY_USED");
			const revision = await sourceRevision("production", fetchImpl);
			await store.put(`grant:${authorization.id}`, authorization, undefined, true);
			const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
			await store.put(
				`instance:${input.installationId}`,
				{
					owner,
					accountId: input.accountId,
					registrationHash,
					target,
					initial: true,
					backupBucket: `superboard-${target.target}-backups`,
					backupKey: secret,
				},
				undefined,
				true,
			);
			const saved = await store.get(`instance:${input.installationId}`);
			if (
				saved.owner !== owner ||
				saved.accountId !== input.accountId ||
				saved.registrationHash !== registrationHash
			)
				throw new Error("INSTALLATION_ID_CONFLICT");
			await db
				.prepare(
					"INSERT INTO installer_installations (id,owner_id,account_id,grant_id,environment,target_name,automatic_updates,status,desired_revision,created_at,updated_at) VALUES (?,?,?,?,'production',?,?,'queued',?,?,?) ON CONFLICT(id) DO NOTHING",
				)
				.bind(
					input.installationId,
					owner,
					input.accountId,
					authorization.id,
					target.target,
					input.automaticUpdates ? 1 : 0,
					revision,
					Date.now(),
					Date.now(),
				)
				.run();
			return { id: input.installationId, status: "queued" };
		},
		async configure(id, owner, input, authorization) {
			const row = await owned(id, owner);
			if (typeof input.automaticUpdates !== "boolean")
				throw new Error("INSTALLATION_INPUT_INVALID");
			if (input.retry || input.update) {
				if ((row.status === "deploying" && !row.github_run_id) || !(await runFinished(row)))
					throw new Error("INSTALLATION_ALREADY_RUNNING");
				if (authorization) await reauthorize(row, authorization);
				const revision = input.update
					? await sourceRevision(row.environment, fetchImpl)
					: row.desired_revision;
				await db
					.prepare(
						"UPDATE installer_installations SET status='queued',desired_revision=?,run_id=NULL,lease_hash=NULL,lease_expires=NULL,error_code=NULL,updated_at=? WHERE id=? AND (status!='deploying' OR run_id=?)",
					)
					.bind(revision, Date.now(), id, row.run_id)
					.run();
			}
			const pause = !input.automaticUpdates && !input.retry && !input.update;
			await db
				.prepare(
					"UPDATE installer_installations SET automatic_updates=?,status=CASE WHEN ?=1 AND status='queued' AND deployed_revision IS NOT NULL AND run_id IS NULL THEN 'ready' ELSE status END,desired_revision=CASE WHEN ?=1 AND status='queued' AND deployed_revision IS NOT NULL AND run_id IS NULL THEN deployed_revision ELSE desired_revision END,updated_at=? WHERE id=?",
				)
				.bind(input.automaticUpdates ? 1 : 0, pause ? 1 : 0, pause ? 1 : 0, Date.now(), id)
				.run();
			return { id, status: (await owned(id, owner)).status };
		},
		async jobs(identity) {
			const production = canDeployProduction(identity);
			const expired = (
				await db
					.prepare(
						"SELECT id,github_run_id FROM installer_installations WHERE status='deploying' AND lease_expires < ? AND environment=? LIMIT 50",
					)
					.bind(Date.now(), production ? "production" : "development")
					.all()
			).results;
			for (const row of expired)
				if (await runFinished(row))
					await db
						.prepare(
							"UPDATE installer_installations SET status='failed',run_id=NULL,lease_hash=NULL,lease_expires=NULL,error_code='INSTALLATION_RUN_EXPIRED',updated_at=? WHERE id=? AND status='deploying' AND lease_expires < ?",
						)
						.bind(Date.now(), row.id, Date.now())
						.run();
			for (const environment of ["development", "production"]) {
				if (environment !== (production ? "production" : "development")) continue;
				const revision = await sourceRevision(environment, fetchImpl);
				await db
					.prepare(
						"UPDATE installer_installations SET desired_revision=?,status=CASE WHEN status='ready' AND deployed_revision!=? THEN 'queued' ELSE status END,updated_at=? WHERE environment=? AND automatic_updates=1 AND status IN ('ready','queued','deploying')",
					)
					.bind(revision, revision, Date.now(), environment)
					.run();
			}
			return (
				await db
					.prepare(
						"SELECT id,desired_revision AS revision FROM installer_installations WHERE status='queued' AND run_id IS NULL AND environment=? ORDER BY created_at LIMIT 50",
					)
					.bind(production ? "production" : "development")
					.all()
			).results;
		},
		async claim(id, revision, identity) {
			const production = canDeployProduction(identity);
			if (!uuid.test(id) || !/^[a-f0-9]{40}$/u.test(revision))
				throw new Error("INSTALLATION_INPUT_INVALID");
			const runId = crypto.randomUUID();
			const lease = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
				.replaceAll("+", "-")
				.replaceAll("/", "_")
				.replaceAll("=", "");
			const row = await db
				.prepare(
					"UPDATE installer_installations SET status='deploying',run_id=?,run_revision=?,lease_hash=?,lease_expires=?,github_run_id=?,updated_at=? WHERE id=? AND desired_revision=? AND status='queued' AND run_id IS NULL AND environment=? RETURNING id",
				)
				.bind(
					runId,
					revision,
					await hash(lease),
					Date.now() + 7_200_000,
					identity.runId,
					Date.now(),
					id,
					revision,
					production ? "production" : "development",
				)
				.first();
			if (!row) throw new Error("INSTALLATION_ALREADY_RUNNING");
			return { runId, lease };
		},
		async context(request, runId) {
			const row = await run(request, runId);
			const state = await store.get(`instance:${row.id}`);
			return {
				...state,
				id: row.id,
				accountId: row.account_id,
				environment: row.environment,
				revision: row.run_revision,
				automaticUpdates: Boolean(row.automatic_updates),
				token: await cloudflareGrantToken(env, row.grant_id, fetchImpl, 30 * 60_000),
			};
		},
		async persist(request, runId, variables) {
			const row = await run(request, runId);
			const state = await store.get(`instance:${row.id}`);
			for (const [name, entry] of Object.entries(variables)) {
				if (name === "SUPERBOARD_TARGET_MANIFEST") {
					const target = JSON.parse(entry.value);
					if (
						target.target !== row.target_name ||
						target.freshInstallation?.id !== state.target.freshInstallation?.id
					)
						throw new Error("INSTALLATION_TARGET_MISMATCH");
					state.target = target;
				} else if (name === "SUPERBOARD_INSTALLATION_KEYS")
					state.keys = entry == null ? undefined : entry.value;
				else if (name === "SUPERBOARD_INITIAL_INSTALL" && entry.value === "0")
					state.initial = false;
				else if (
					name !== "SUPERBOARD_INSTALLATION_ANALYTICS_TOKEN" &&
					name !== "SUPERBOARD_SETUP_API_TOKEN"
				)
					throw new Error("INSTALLATION_VARIABLE_REJECTED");
			}
			await store.put(`instance:${row.id}`, state);
			return { status: "saved" };
		},
		async complete(request, runId, input) {
			const row = await run(request, runId);
			if (input.status !== "deployed" && input.status !== "failed")
				throw new Error("INSTALLATION_INPUT_INVALID");
			if (input.status === "deployed") {
				const state = await store.get(`instance:${row.id}`);
				if (state.initial) throw new Error("INSTALLATION_INITIALIZATION_INCOMPLETE");
				await db
					.prepare(
						"UPDATE installer_installations SET status=CASE WHEN desired_revision!=run_revision AND automatic_updates=1 THEN 'queued' ELSE 'ready' END,deployed_revision=run_revision,run_id=NULL,lease_hash=NULL,lease_expires=NULL,error_code=NULL,updated_at=? WHERE id=? AND run_id=?",
					)
					.bind(Date.now(), row.id, runId)
					.run();
			} else
				await db
					.prepare(
						"UPDATE installer_installations SET status='failed',run_id=NULL,lease_hash=NULL,lease_expires=NULL,error_code=?,updated_at=? WHERE id=? AND run_id=?",
					)
					.bind(
						/^[A-Z0-9_:.-]{1,160}$/u.test(input.errorCode ?? "")
							? input.errorCode
							: "INSTALLATION_DEPLOYMENT_FAILED",
						Date.now(),
						row.id,
						runId,
					)
					.run();
			return { id: row.id, status: input.status };
		},
	};
}
