import {
	BILLING_CATALOG_TABLES,
	signBillingCatalogBatch,
	verifyBillingCatalogCompletion,
	type BillingCatalogCompletion,
	type BillingCatalogTable,
	type BillingCatalogBatch,
	type BillingCatalogValue,
} from "@superboard/contracts/billing-catalog";
import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import type { Next } from "hono";

import { httpError, type WorkerContext } from "./http.js";

export async function exportBillingLedger(c: WorkerContext): Promise<Response> {
	const project = c.get("project");
	const body = await readJsonObjectLimited(c.req.raw, 16_000);
	const table = String(body.table ?? "products");
	if (!Object.hasOwn(BILLING_CATALOG_TABLES, table))
		throw httpError("catalog_table_invalid", "Unknown ledger table", 422);
	const name = table as BillingCatalogTable;
	const spec = BILLING_CATALOG_TABLES[name];
	const cursor = body.cursor ?? [];
	if (
		!Array.isArray(cursor) ||
		(cursor.length !== 0 && cursor.length !== spec.keys.length) ||
		cursor.some((value) => typeof value !== "string" && typeof value !== "number")
	)
		throw httpError("catalog_cursor_invalid", "Invalid ledger cursor", 422);
	await c.env.DB.prepare(
		"INSERT INTO products_billing_ledger_authority (project_id,status,changed_at) VALUES (?,'pending',?) ON CONFLICT DO NOTHING",
	)
		.bind(project.projectId, new Date().toISOString())
		.run();
	const state = await c.env.DB.prepare(
		"SELECT status FROM products_billing_ledger_authority WHERE project_id=?",
	)
		.bind(project.projectId)
		.first<{ status: string }>();
	if (state?.status === "active")
		throw httpError("catalog_already_transferred", "Ledger authority is already transferred", 409);
	let predicate =
		name === "entitlement_products"
			? "EXISTS (SELECT 1 FROM products parent WHERE parent.id=t.product_id AND parent.project_id=?)"
			: name === "purchase_entitlements"
				? "EXISTS (SELECT 1 FROM purchases parent WHERE parent.id=t.purchase_id AND parent.project_id=?)"
				: "t.project_id=?";
	if (name === "audit_events")
		predicate +=
			" AND (t.action LIKE 'purchase.%' OR t.action LIKE 'refund.%' OR t.action LIKE 'subscription.%')";
	if (name === "idempotency_keys")
		predicate +=
			" AND (t.path LIKE '/internal/v1/purchases%' OR t.path LIKE '/internal/v1/refunds%' OR t.path LIKE '/internal/v1/subscriptions%')";
	const values: unknown[] = [project.projectId];
	if (cursor.length) {
		const branches = spec.keys.map((key, index) => {
			const comparisons = spec.keys.slice(0, index).map((prior, priorIndex) => {
				values.push(cursor[priorIndex]);
				return `t.${prior}=?`;
			});
			values.push(cursor[index]);
			comparisons.push(`t.${key}>?`);
			return `(${comparisons.join(" AND ")})`;
		});
		predicate += ` AND (${branches.join(" OR ")})`;
	}
	const rows = await c.env.DB.prepare(
		`SELECT ${spec.columns.map((column) => `t.${column}`).join(",")} FROM ${name} t WHERE ${predicate} ORDER BY ${spec.keys.map((key) => `t.${key}`).join(",")} LIMIT 10`,
	)
		.bind(...values)
		.all<Record<string, BillingCatalogValue>>();
	const selected: typeof rows.results = [];
	let bytes = 0;
	for (const row of rows.results) {
		const size = new TextEncoder().encode(JSON.stringify(row)).length;
		if (bytes + size > 2 * 1024 * 1024) break;
		selected.push(row);
		bytes += size;
	}
	if (rows.results.length && !selected.length)
		throw httpError("catalog_row_too_large", "Ledger row exceeds migration batch size", 413);
	const next = selected.length
		? spec.keys.map((key) => selected.at(-1)![key] as string | number)
		: cursor;
	const batch: BillingCatalogBatch = {
		schema_version: 1,
		instance_id: project.instanceId!,
		project_ref: project.projectRef!,
		project_id: project.projectId,
		table: name,
		cursor,
		next_cursor: next,
		complete: rows.results.length < 10 && selected.length === rows.results.length,
		rows: selected,
		issued_at: Math.floor(Date.now() / 1000),
	};
	return Response.json(
		{ data: { batch, signature: await signBillingCatalogBatch(batch, c.env.INTERNAL_API_TOKEN) } },
		{ headers: { "Cache-Control": "no-store" } },
	);
}

export async function finalizeBillingLedger(c: WorkerContext): Promise<Response> {
	const body = await readJsonObjectLimited(c.req.raw, 1024);
	const project = c.get("project");
	const receipt = body.receipt as BillingCatalogCompletion;
	if (
		!receipt ||
		receipt.project_id !== project.projectId ||
		receipt.project_ref !== project.projectRef ||
		receipt.instance_id !== project.instanceId ||
		typeof body.signature !== "string" ||
		!(await verifyBillingCatalogCompletion(receipt, body.signature, c.env.INTERNAL_API_TOKEN))
	)
		throw httpError(
			"catalog_confirmation_required",
			"Verified Billing import confirmation is required",
			403,
		);
	await c.env.DB.prepare(
		"UPDATE products_billing_ledger_authority SET status='active',changed_at=? WHERE project_id=?",
	)
		.bind(new Date().toISOString(), c.get("project").projectId)
		.run();
	return Response.json({ data: { complete: true } });
}

export async function forwardTransferredBillingLedger(
	c: WorkerContext,
	next: Next,
): Promise<Response | void> {
	const path = new URL(c.req.url).pathname;
	if (
		!/^\/internal\/v1\/(?:purchases|refunds|subscriptions|customers\/[^/]+\/entitlements)(?:\/|$)/u.test(
			path,
		)
	)
		return next();
	const state = await c.env.DB.prepare(
		"SELECT status FROM products_billing_ledger_authority WHERE project_id=?",
	)
		.bind(c.get("project").projectId)
		.first<{ status: string }>()
		.catch((error: unknown) => {
			if (error instanceof Error && error.message.includes("no such table")) return null;
			throw error;
		});
	if (!state) return next();
	if (state.status !== "active")
		return ["GET", "HEAD"].includes(c.req.method)
			? next()
			: Response.json({ error: { code: "catalog_transfer_pending" } }, { status: 503 });
	const env = c.env as typeof c.env & { API_SERVICE?: Fetcher };
	if (!env.API_SERVICE)
		return Response.json({ error: { code: "billing_relay_unavailable" } }, { status: 503 });
	const source = new URL(c.req.url);
	const target = new URL(
		`https://api.internal/internal/billing/catalog-ledger${source.pathname.slice("/internal/v1".length)}${source.search}`,
	);
	const project = c.get("project");
	const numericActor = /^\d+$/u.test(project.actorId) ? Number(project.actorId) : 0;
	const headers = await createProjectContextHeaders(
		{
			module: "billing",
			method: c.req.method,
			pathname: target.pathname,
			projectId: Number(project.projectId),
			projectRef: project.projectRef!,
			instanceId: Number(project.instanceId),
			environment: project.environment === "test" ? "test" : "production",
			actorId: numericActor,
			...(numericActor === 0 ? { operatorId: project.actorId } : {}),
			role: project.role!,
			requestId: project.requestId,
			issuedAt: Math.floor(Date.now() / 1000),
		},
		c.env.INTERNAL_API_TOKEN,
	);
	for (const name of ["Content-Type", "Idempotency-Key"]) {
		const value = c.req.header(name);
		if (value) headers.set(name, value);
	}
	return env.API_SERVICE.fetch(new Request(new Request(target, c.req.raw), { headers }));
}
