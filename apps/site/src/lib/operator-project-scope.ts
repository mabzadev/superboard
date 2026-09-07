import {
	signSiteOperatorRequest,
	type OperatorProjectScope,
	type OperatorProjectSummary,
	type OperatorInstanceSummary,
} from "@superboard/contracts/site-operator";

import type { OperatorApiProxyEnv } from "./operator-api-proxy.js";

export type { OperatorProjectScope } from "@superboard/contracts/site-operator";

const PRODUCTION_REF_PATTERN = /^([1-9][0-9]*)-prod$/u;

export class OperatorProjectScopeError extends Error {
	constructor(
		readonly code:
			| "OPERATOR_PROJECT_SCOPE_UNAVAILABLE"
			| "OPERATOR_INSTANCE_SCOPE_CONFLICT"
			| "OPERATOR_INSTANCE_SCOPE_INVALID",
		readonly status: number,
	) {
		super(code);
	}
}

type Operator = { id: string; role: number };

export function resolveOperatorProjectScope(
	env: OperatorApiProxyEnv,
	operator: Operator,
): Promise<OperatorProjectScope> {
	return requestOperatorProjectScope(env, operator, "GET");
}

export function initializeOperatorProjectScope(
	env: OperatorApiProxyEnv,
	operator: Operator,
	idempotencyKey: string,
	options: { legacy_instance_id?: number } = {},
): Promise<OperatorProjectScope> {
	if (!idempotencyKey.trim() || idempotencyKey.length > 255)
		throw new Error("IDEMPOTENCY_KEY_REQUIRED");
	return requestOperatorProjectScope(env, operator, "POST", idempotencyKey, options);
}

async function requestOperatorProjectScope(
	env: OperatorApiProxyEnv,
	operator: Operator,
	method: "GET" | "POST",
	idempotencyKey?: string,
	options: { legacy_instance_id?: number } = {},
): Promise<OperatorProjectScope> {
	const instanceId = env.SUPERBOARD_INSTANCE_ID?.trim();
	const secret = env.SITE_OPERATOR_BRIDGE_TOKEN?.trim();
	if (!env.API_SERVICE || !secret || !instanceId)
		throw new Error("OPERATOR_PROJECT_SCOPE_UNAVAILABLE");
	const request = new Request("https://api.internal/internal/site-operator/project-scope", {
		method,
		...(method === "POST" ? { body: JSON.stringify(options) } : {}),
	});
	const headers = await signSiteOperatorRequest(
		request,
		{ operator_id: operator.id, instance_id: instanceId, role: operator.role },
		secret,
	);
	if (idempotencyKey) {
		headers.set("Idempotency-Key", idempotencyKey);
		headers.set("Content-Type", "application/json");
	}
	const response = await env.API_SERVICE.fetch(new Request(request, { headers }));
	if (!response.ok) {
		const failure: unknown = await response.json().catch(() => null);
		const code =
			failure &&
			typeof failure === "object" &&
			"error" in failure &&
			failure.error &&
			typeof failure.error === "object" &&
			"code" in failure.error
				? failure.error.code
				: undefined;
		if (code === "OPERATOR_INSTANCE_SCOPE_CONFLICT" || code === "OPERATOR_INSTANCE_SCOPE_INVALID")
			throw new OperatorProjectScopeError(code, response.status);
		throw new OperatorProjectScopeError("OPERATOR_PROJECT_SCOPE_UNAVAILABLE", response.status);
	}
	const value: unknown = await response.json();
	if (
		!value ||
		typeof value !== "object" ||
		!("production_project_ref" in value) ||
		!("test_project_ref" in value) ||
		typeof value.production_project_ref !== "string" ||
		typeof value.test_project_ref !== "string"
	)
		throw new Error("OPERATOR_PROJECT_SCOPE_INVALID");
	const production = PRODUCTION_REF_PATTERN.exec(value.production_project_ref);
	if (!production || value.test_project_ref !== `${production[1]}-test`)
		throw new Error("OPERATOR_PROJECT_SCOPE_INVALID");
	const projects =
		"projects" in value && Array.isArray(value.projects)
			? value.projects.map(projectSummary)
			: undefined;
	const instance =
		"instance" in value && value.instance ? instanceSummary(value.instance) : undefined;
	return {
		...(projects ? { projects } : {}),
		...(instance ? { instance } : {}),
		production_project_ref: value.production_project_ref,
		test_project_ref: value.test_project_ref,
	};
}

function projectSummary(value: unknown): OperatorProjectSummary {
	if (!isScopeRecord(value)) throw new Error("OPERATOR_PROJECT_SCOPE_INVALID");
	const row = value;
	if (
		["id", "internal_id", "name", "identifier", "created_at", "updated_at"].some(
			(key) => typeof row[key] !== "string",
		) ||
		typeof row.is_test !== "boolean"
	)
		throw new Error("OPERATOR_PROJECT_SCOPE_INVALID");
	return {
		id: String(row.id),
		internal_id: String(row.internal_id),
		name: String(row.name),
		identifier: String(row.identifier),
		is_test: row.is_test,
		created_at: String(row.created_at),
		updated_at: String(row.updated_at),
	};
}

function instanceSummary(value: unknown): OperatorInstanceSummary {
	if (!isScopeRecord(value)) throw new Error("OPERATOR_PROJECT_SCOPE_INVALID");
	const row = value;
	if (
		["id", "name", "uri_scheme", "created_at", "updated_at"].some(
			(key) => typeof row[key] !== "string",
		) ||
		typeof row.get_started_dismissed !== "boolean" ||
		!Array.isArray(row.projects)
	)
		throw new Error("OPERATOR_PROJECT_SCOPE_INVALID");
	return {
		id: String(row.id),
		name: String(row.name),
		uri_scheme: String(row.uri_scheme),
		get_started_dismissed: row.get_started_dismissed,
		created_at: String(row.created_at),
		updated_at: String(row.updated_at),
		production: projectSummary(row.production),
		test: projectSummary(row.test),
		projects: row.projects.map(projectSummary),
	};
}

function isScopeRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
