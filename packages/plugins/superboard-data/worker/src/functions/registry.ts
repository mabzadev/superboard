import type { DataEnv } from "../platform/env.js";
import { DataError, boundedInteger, isRecord, nowIso, sha256Hex } from "../platform/http.js";
import { nextRun, parseCron } from "./cron.js";
import { decryptSecrets, encryptSecrets, secretsAvailable } from "./secrets.js";

export const FUNCTION_ACCESS = ["public", "authenticated", "service"] as const;
export type FunctionAccess = (typeof FUNCTION_ACCESS)[number];

const NAME_PATTERN = /^[a-z][a-z0-9-]{0,47}$/u;
const VARIABLE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const MAXIMUM_SOURCE_BYTES = 1_000_000;
const MAXIMUM_VARIABLES = 64;
const MAXIMUM_VALUE_LENGTH = 8_192;
const KEPT_VERSIONS = 10;
const MAXIMUM_FUNCTIONS = 100;
const RESERVED_VARIABLES = new Set(["SUPERBOARD_API_URL", "SUPERBOARD_PROJECT_ID"]);

export interface FunctionSchedule {
	cron: string;
	enabled: boolean;
	next_run_at: string;
	last_run_at: string | null;
}

export interface FunctionDefinition {
	name: string;
	access: FunctionAccess;
	active_version: number | null;
	timeout_ms: number;
	vars: Record<string, string>;
	secret_names: string[];
	schedule: FunctionSchedule | null;
	created_at: string;
	updated_at: string;
}

export interface FunctionVersion {
	version: number;
	source_hash: string;
	created_by: string | null;
	created_at: string;
}

type FunctionRow = {
	name: string;
	access: FunctionAccess;
	active_version: number | null;
	timeout_ms: number;
	vars_json: string;
	secrets_ciphertext: string | null;
	secret_names_json: string;
	created_at: string;
	updated_at: string;
	cron: string | null;
	enabled: number | null;
	next_run_at: string | null;
	last_run_at: string | null;
};

export function assertFunctionName(name: string): void {
	if (!NAME_PATTERN.test(name))
		throw new DataError(
			422,
			"function_name_invalid",
			"A function name starts with a lowercase letter and contains up to 48 lowercase letters, digits or dashes",
		);
}

export async function listFunctions(
	env: DataEnv,
	projectId: number,
): Promise<FunctionDefinition[]> {
	const { results } = await env.DB.prepare(
		`${SELECT_FUNCTION} WHERE f.project_id = ? ORDER BY f.name`,
	)
		.bind(projectId)
		.all<FunctionRow>();
	return results.map(definitionFromRow);
}

export async function getFunction(
	env: DataEnv,
	projectId: number,
	name: string,
): Promise<(FunctionDefinition & { secretsCiphertext: string | null }) | null> {
	assertFunctionName(name);
	const row = await env.DB.prepare(`${SELECT_FUNCTION} WHERE f.project_id = ? AND f.name = ?`)
		.bind(projectId, name)
		.first<FunctionRow>();
	return row ? { ...definitionFromRow(row), secretsCiphertext: row.secrets_ciphertext } : null;
}

export async function requireFunction(env: DataEnv, projectId: number, name: string) {
	const definition = await getFunction(env, projectId, name);
	if (!definition)
		throw new DataError(404, "function_not_found", `Function ${name} does not exist`);
	return definition;
}

export async function functionDetails(env: DataEnv, projectId: number, name: string) {
	const definition = await requireFunction(env, projectId, name);
	const { secretsCiphertext: _ciphertext, ...visible } = definition;
	const [{ results: versions }, active] = await Promise.all([
		env.DB.prepare(
			`SELECT version, source_hash, created_by, created_at FROM data_function_versions
			 WHERE project_id = ? AND name = ? ORDER BY version DESC`,
		)
			.bind(projectId, name)
			.all<FunctionVersion>(),
		activeSource(env, projectId, name, definition.active_version),
	]);
	return { ...visible, versions, source: active?.source ?? null };
}

export async function activeSource(
	env: DataEnv,
	projectId: number,
	name: string,
	version: number | null,
): Promise<{ source: string; source_hash: string } | null> {
	if (version === null) return null;
	return env.DB.prepare(
		"SELECT source, source_hash FROM data_function_versions WHERE project_id = ? AND name = ? AND version = ?",
	)
		.bind(projectId, name, version)
		.first<{ source: string; source_hash: string }>();
}

export async function deployFunction(
	env: DataEnv,
	projectId: number,
	name: string,
	body: unknown,
	createdBy: string | null,
): Promise<FunctionDefinition> {
	assertFunctionName(name);
	if (!isRecord(body)) throw new DataError(422, "function_invalid", "Body must be an object");
	const current = await getFunction(env, projectId, name);
	if (!current) {
		const count = await env.DB.prepare(
			"SELECT COUNT(*) AS total FROM data_functions WHERE project_id = ?",
		)
			.bind(projectId)
			.first<{ total: number }>();
		if (Number(count?.total ?? 0) >= MAXIMUM_FUNCTIONS)
			throw new DataError(
				409,
				"function_limit",
				`A project has at most ${MAXIMUM_FUNCTIONS} functions`,
			);
		if (typeof body.source !== "string")
			throw new DataError(
				422,
				"function_source_required",
				"The first deployment needs source code",
			);
	}
	const access = body.access === undefined ? (current?.access ?? "authenticated") : body.access;
	if (typeof access !== "string" || !(FUNCTION_ACCESS as readonly string[]).includes(access))
		throw new DataError(422, "function_access_invalid", `access is ${FUNCTION_ACCESS.join(", ")}`);
	const timeout = boundedInteger(
		body.timeout_ms === undefined ? String(current?.timeout_ms ?? 30_000) : String(body.timeout_ms),
		30_000,
		1_000,
		300_000,
		"function_timeout_invalid",
	);
	const vars = body.vars === undefined ? (current?.vars ?? {}) : parseVariables(body.vars, false);
	let secretsCiphertext = current?.secretsCiphertext ?? null;
	let secretNames = current?.secret_names ?? [];
	if (body.secrets !== undefined) {
		const changes = parseVariables(body.secrets, true);
		const existing = current?.secretsCiphertext
			? await decryptSecrets(env, current.secretsCiphertext)
			: {};
		for (const [key, value] of Object.entries(changes)) {
			if (value === null) delete existing[key];
			else existing[key] = value;
		}
		if (Object.keys(existing).length && !secretsAvailable(env))
			throw new DataError(503, "secrets_unavailable", "DATA_ENCRYPTION_KEY is not configured");
		secretNames = Object.keys(existing).sort();
		secretsCiphertext = secretNames.length ? await encryptSecrets(env, existing) : null;
	}
	for (const key of Object.keys(vars))
		if (secretNames.includes(key))
			throw new DataError(422, "variable_conflict", `${key} is both a variable and a secret`);
	const now = nowIso();
	let version = current?.active_version ?? null;
	const statements: D1PreparedStatement[] = [];
	if (typeof body.source === "string") {
		const bytes = new TextEncoder().encode(body.source).byteLength;
		if (bytes === 0 || bytes > MAXIMUM_SOURCE_BYTES)
			throw new DataError(
				413,
				"function_source_size",
				`Source code has 1 to ${MAXIMUM_SOURCE_BYTES} bytes`,
			);
		const hash = await sha256Hex(body.source);
		const active = await activeSource(env, projectId, name, version);
		if (active?.source_hash !== hash) {
			const latest = await env.DB.prepare(
				"SELECT COALESCE(MAX(version), 0) AS version FROM data_function_versions WHERE project_id = ? AND name = ?",
			)
				.bind(projectId, name)
				.first<{ version: number }>();
			version = Number(latest?.version ?? 0) + 1;
			statements.push(
				env.DB.prepare(
					`INSERT INTO data_function_versions (project_id, name, version, source, source_hash, created_by, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				).bind(projectId, name, version, body.source, hash, createdBy, now),
				env.DB.prepare(
					"DELETE FROM data_function_versions WHERE project_id = ? AND name = ? AND version <= ?",
				).bind(projectId, name, version - KEPT_VERSIONS),
			);
		}
	}
	statements.push(
		env.DB.prepare(
			`INSERT INTO data_functions (project_id, name, access, active_version, timeout_ms, vars_json, secrets_ciphertext, secret_names_json, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(project_id, name) DO UPDATE SET access = excluded.access, active_version = excluded.active_version,
			   timeout_ms = excluded.timeout_ms, vars_json = excluded.vars_json, secrets_ciphertext = excluded.secrets_ciphertext,
			   secret_names_json = excluded.secret_names_json, updated_at = excluded.updated_at`,
		).bind(
			projectId,
			name,
			access,
			version,
			timeout,
			JSON.stringify(vars),
			secretsCiphertext,
			JSON.stringify(secretNames),
			now,
			now,
		),
	);
	await env.DB.batch(statements);
	const { secretsCiphertext: _ciphertext, ...definition } = await requireFunction(
		env,
		projectId,
		name,
	);
	return definition;
}

export async function rollbackFunction(
	env: DataEnv,
	projectId: number,
	name: string,
	body: unknown,
): Promise<FunctionDefinition> {
	await requireFunction(env, projectId, name);
	const version = isRecord(body) ? body.version : undefined;
	if (typeof version !== "number" || !(await activeSource(env, projectId, name, version)))
		throw new DataError(404, "function_version_not_found", "This version does not exist");
	await env.DB.prepare(
		"UPDATE data_functions SET active_version = ?, updated_at = ? WHERE project_id = ? AND name = ?",
	)
		.bind(version, nowIso(), projectId, name)
		.run();
	const { secretsCiphertext: _ciphertext, ...definition } = await requireFunction(
		env,
		projectId,
		name,
	);
	return definition;
}

export async function deleteFunction(
	env: DataEnv,
	projectId: number,
	name: string,
	confirmation: string | null,
): Promise<void> {
	await requireFunction(env, projectId, name);
	if (confirmation !== name)
		throw new DataError(
			422,
			"confirmation_required",
			`Pass confirm=${name} to delete this function`,
		);
	await env.DB.batch(
		[
			"data_function_schedules",
			"data_function_runs",
			"data_function_versions",
			"data_functions",
		].map((table) =>
			env.DB.prepare(`DELETE FROM ${table} WHERE project_id = ? AND name = ?`).bind(
				projectId,
				name,
			),
		),
	);
}

export async function setSchedule(
	env: DataEnv,
	projectId: number,
	name: string,
	body: unknown,
): Promise<FunctionSchedule> {
	await requireFunction(env, projectId, name);
	if (!isRecord(body) || typeof body.cron !== "string")
		throw new DataError(422, "cron_invalid", "cron is required");
	const cron = body.cron.trim();
	const enabled = body.enabled === undefined ? true : body.enabled;
	if (typeof enabled !== "boolean")
		throw new DataError(422, "schedule_invalid", "enabled must be a boolean");
	const next = nextRun(parseCron(cron), new Date()).toISOString();
	await env.DB.prepare(
		`INSERT INTO data_function_schedules (project_id, name, cron, enabled, next_run_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(project_id, name) DO UPDATE SET cron = excluded.cron, enabled = excluded.enabled,
		   next_run_at = excluded.next_run_at, updated_at = excluded.updated_at`,
	)
		.bind(projectId, name, cron, enabled ? 1 : 0, next, nowIso())
		.run();
	return {
		cron,
		enabled,
		next_run_at: next,
		last_run_at: (await requireFunction(env, projectId, name)).schedule?.last_run_at ?? null,
	};
}

export async function deleteSchedule(env: DataEnv, projectId: number, name: string): Promise<void> {
	await requireFunction(env, projectId, name);
	await env.DB.prepare("DELETE FROM data_function_schedules WHERE project_id = ? AND name = ?")
		.bind(projectId, name)
		.run();
}

export async function listRuns(
	env: DataEnv,
	projectId: number,
	name: string,
	params: URLSearchParams,
) {
	await requireFunction(env, projectId, name);
	const limit = boundedInteger(params.get("limit"), 50, 1, 100, "limit_invalid");
	const { results } = await env.DB.prepare(
		`SELECT id, version, trigger, status, outcome, duration_ms, logs_json, error, started_at
		 FROM data_function_runs WHERE project_id = ? AND name = ? ORDER BY started_at DESC LIMIT ?`,
	)
		.bind(projectId, name, limit)
		.all<{ logs_json: string } & Record<string, unknown>>();
	return {
		items: results.map(({ logs_json, ...run }) => ({
			...run,
			logs: JSON.parse(logs_json) as unknown,
		})),
	};
}

function parseVariables(value: unknown, allowNull: false): Record<string, string>;
function parseVariables(value: unknown, allowNull: true): Record<string, string | null>;
function parseVariables(value: unknown, allowNull: boolean): Record<string, string | null> {
	if (!isRecord(value))
		throw new DataError(422, "variables_invalid", "Variables must be an object");
	const entries = Object.entries(value);
	if (entries.length > MAXIMUM_VARIABLES)
		throw new DataError(422, "variables_invalid", `Declare at most ${MAXIMUM_VARIABLES} variables`);
	const output: Record<string, string | null> = {};
	for (const [key, item] of entries) {
		if (!VARIABLE_PATTERN.test(key) || RESERVED_VARIABLES.has(key))
			throw new DataError(422, "variable_name_invalid", `${key} is not a valid variable name`);
		if (item === null && allowNull) output[key] = null;
		else if (typeof item === "string" && item.length <= MAXIMUM_VALUE_LENGTH) output[key] = item;
		else throw new DataError(422, "variable_value_invalid", `${key} must be a string`);
	}
	return output;
}

const SELECT_FUNCTION = `SELECT f.name, f.access, f.active_version, f.timeout_ms, f.vars_json, f.secrets_ciphertext,
	f.secret_names_json, f.created_at, f.updated_at, s.cron, s.enabled, s.next_run_at, s.last_run_at
	FROM data_functions f
	LEFT JOIN data_function_schedules s ON s.project_id = f.project_id AND s.name = f.name`;

function definitionFromRow(row: FunctionRow): FunctionDefinition {
	return {
		name: row.name,
		access: row.access,
		active_version: row.active_version === null ? null : Number(row.active_version),
		timeout_ms: Number(row.timeout_ms),
		vars: JSON.parse(row.vars_json) as Record<string, string>,
		secret_names: JSON.parse(row.secret_names_json) as string[],
		schedule:
			row.cron === null || row.next_run_at === null
				? null
				: {
						cron: row.cron,
						enabled: Number(row.enabled) === 1,
						next_run_at: row.next_run_at,
						last_run_at: row.last_run_at,
					},
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}
