import {
	createProjectContextHeaders,
	verifyInternalProjectContextRequest,
	type ProjectContext,
} from "@superboard/contracts/project-context";
import type { Context, Next } from "hono";

import type { Env } from "../types.js";
import { getRequestAuthContext } from "./auth.js";
import { domainError, resolveAuthorizedProjectContext } from "./domain-modules.js";

type GatewayContext = Context<{ Bindings: Env }>;
export async function proxyBillingLedger(c: GatewayContext): Promise<Response> {
	const requestId = c.req.header("X-Request-Id") || crypto.randomUUID();
	const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
	if (!auth) return domainError(requestId, 401, "unauthorized", "Invalid or expired token");
	const projectRef = c.req.param("projectRef") ?? "";
	const project = await resolveAuthorizedProjectContext(
		c.env.DB,
		auth.userId,
		projectRef,
		auth.siteOperator,
	);
	if (!project.ok) return domainError(requestId, project.status, project.code, project.message);
	if (!c.env.BILLING || !c.env.MODULE_INTERNAL_TOKEN)
		return domainError(
			requestId,
			503,
			"billing_service_unavailable",
			"Billing service is unavailable",
		);
	if (!["GET", "HEAD"].includes(c.req.method) && !c.req.header("Idempotency-Key"))
		return domainError(requestId, 400, "idempotency_key_required", "Idempotency-Key is required");
	const source = new URL(c.req.url);
	const base = `/api/v1/billing/projects/${encodeURIComponent(projectRef)}/ledger`;
	const target = new URL(
		`https://billing.internal/internal/v1/catalog-ledger${source.pathname.slice(base.length)}${source.search}`,
	);
	const context = {
		...project.context,
		actorId: auth.userId,
		...(auth.siteOperator ? { operatorId: auth.siteOperator.operator_id } : {}),
		module: "billing" as const,
		method: c.req.method,
		pathname: target.pathname,
		requestId,
		issuedAt: Math.floor(Date.now() / 1000),
	};
	const headers = await createProjectContextHeaders(context, c.env.MODULE_INTERNAL_TOKEN);
	for (const name of ["Content-Type", "Accept", "Idempotency-Key"]) {
		const value = c.req.header(name);
		if (value) headers.set(name, value);
	}
	try {
		return await c.env.BILLING.fetch(new Request(new Request(target, c.req.raw), { headers }));
	} catch {
		return domainError(
			requestId,
			503,
			"billing_service_unavailable",
			"Billing service is unavailable",
		);
	}
}

export async function migrateProductsLedger(c: GatewayContext): Promise<Response> {
	const authorized = await ledgerAuthority(c);
	if (authorized instanceof Response) return authorized;
	if (!["owner", "admin"].includes(authorized.role))
		return domainError(
			crypto.randomUUID(),
			403,
			"administrator_required",
			"An administrator is required",
		);
	if (!c.env.PRODUCTS_MODULE)
		return domainError(
			crypto.randomUUID(),
			503,
			"products_migration_source_unavailable",
			"The Products migration source is unavailable",
		);
	for (let batch = 0; batch < 4; batch++) {
		const statusResponse = await callLedgerService(
			c,
			authorized,
			"billing",
			"/internal/v1/catalog-ledger/migration/status",
			"GET",
		);
		if (!statusResponse.ok) return statusResponse;
		const state = (await statusResponse.json()) as {
			data: {
				complete: boolean;
				table?: string;
				cursor?: unknown;
				receipt?: unknown;
				signature?: string;
			};
		};
		if (state.data.complete) {
			const finalized = await callLedgerService(
				c,
				authorized,
				"products",
				"/internal/v1/billing-ledger/finalize",
				"POST",
				{ receipt: state.data.receipt, signature: state.data.signature },
			);
			return finalized.ok ? Response.json({ data: { complete: true } }) : finalized;
		}
		const exported = await callLedgerService(
			c,
			authorized,
			"products",
			"/internal/v1/billing-ledger/export",
			"POST",
			{ table: state.data.table, cursor: state.data.cursor },
		);
		if (!exported.ok) return exported;
		const envelope = (await exported.json()) as { data: unknown };
		const imported = await callLedgerService(
			c,
			authorized,
			"billing",
			"/internal/v1/catalog-ledger/migration/import",
			"POST",
			envelope.data,
		);
		if (!imported.ok) return imported;
	}
	const progress = await callLedgerService(
		c,
		authorized,
		"billing",
		"/internal/v1/catalog-ledger/migration/status",
		"GET",
	);
	if (!progress.ok) return progress;
	const state = (await progress.json()) as {
		data: { complete: boolean; receipt?: unknown; signature?: string };
	};
	if (state.data.complete) {
		const finalized = await callLedgerService(
			c,
			authorized,
			"products",
			"/internal/v1/billing-ledger/finalize",
			"POST",
			{ receipt: state.data.receipt, signature: state.data.signature },
		);
		if (!finalized.ok) return finalized;
	}
	return Response.json(state, { headers: { "Cache-Control": "no-store" } });
}

export async function proxyTransferredProductsLedger(
	c: GatewayContext,
	next: Next,
): Promise<Response | void> {
	if (!c.env.BILLING || !c.env.MODULE_INTERNAL_TOKEN) return next();
	const authorized = await ledgerAuthority(c);
	if (authorized instanceof Response) return authorized;
	const response = await callLedgerService(
		c,
		authorized,
		"billing",
		"/internal/v1/catalog-ledger/migration/status",
		"GET",
	);
	if (!response.ok) return next();
	const state = (await response.json()) as { data?: { complete?: boolean } };
	if (!state.data?.complete) return next();
	const source = new URL(c.req.url);
	const prefix = `/api/v1/products/projects/${encodeURIComponent(c.req.param("projectRef") ?? "")}`;
	return callLedgerService(
		c,
		authorized,
		"billing",
		`/internal/v1/catalog-ledger${source.pathname.slice(prefix.length)}${source.search}`,
		c.req.method,
		c.req.raw.body,
	);
}

export async function relayBillingLedger(c: GatewayContext): Promise<Response> {
	const verified = await verifyInternalProjectContextRequest(
		c.req.raw,
		c.env.MODULE_INTERNAL_TOKEN ?? "",
		"billing",
	);
	if (!verified.ok)
		return domainError(
			crypto.randomUUID(),
			401,
			"internal_auth_invalid",
			"Invalid internal project context",
		);
	const source = new URL(c.req.url);
	return callLedgerService(
		c,
		verified.context,
		"billing",
		`/internal/v1/catalog-ledger${source.pathname.slice("/internal/billing/catalog-ledger".length)}${source.search}`,
		c.req.method,
		c.req.raw.body,
	);
}

type AuthorizedLedger = Omit<ProjectContext, "requestId" | "issuedAt">;
async function ledgerAuthority(c: GatewayContext): Promise<AuthorizedLedger | Response> {
	const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
	const requestId = crypto.randomUUID();
	if (!auth) return domainError(requestId, 401, "unauthorized", "Invalid or expired token");
	const result = await resolveAuthorizedProjectContext(
		c.env.DB,
		auth.userId,
		c.req.param("projectRef") ?? "",
		auth.siteOperator,
	);
	if (!result.ok) return domainError(requestId, result.status, result.code, result.message);
	return {
		...result.context,
		actorId: auth.userId,
		...(auth.siteOperator ? { operatorId: auth.siteOperator.operator_id } : {}),
	};
}
async function callLedgerService(
	c: GatewayContext,
	project: AuthorizedLedger,
	module: "products" | "billing",
	path: string,
	method: string,
	body?: unknown,
): Promise<Response> {
	const binding = module === "billing" ? c.env.BILLING : c.env.PRODUCTS_MODULE;
	const secret = c.env.MODULE_INTERNAL_TOKEN;
	if (!binding || !secret)
		return domainError(
			crypto.randomUUID(),
			503,
			"module_unavailable",
			`${module} service is unavailable`,
		);
	const target = new URL(path, `https://${module}.internal`);
	const context = {
		...project,
		module,
		method,
		pathname: target.pathname,
		requestId: c.req.header("X-Request-Id") || crypto.randomUUID(),
		issuedAt: Math.floor(Date.now() / 1000),
	};
	const headers = await createProjectContextHeaders(context, secret);
	const operationKey = c.req.header("Idempotency-Key");
	if (operationKey) headers.set("Idempotency-Key", operationKey);
	const init: RequestInit = { method, headers };
	if (!["GET", "HEAD"].includes(method)) {
		if (body instanceof ReadableStream) {
			init.body = body;
			const type = c.req.header("Content-Type");
			if (type) headers.set("Content-Type", type);
		} else if (body !== undefined) {
			headers.set("Content-Type", "application/json");
			headers.set("Idempotency-Key", crypto.randomUUID());
			init.body = JSON.stringify(body);
		}
	}
	try {
		return await binding.fetch(new Request(target, init));
	} catch {
		return domainError(
			context.requestId,
			503,
			"module_unavailable",
			`${module} service is unavailable`,
		);
	}
}
