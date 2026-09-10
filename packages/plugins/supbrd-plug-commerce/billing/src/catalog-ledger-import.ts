import {
	BILLING_CATALOG_TABLES,
	verifyBillingCatalogBatch,
	signBillingCatalogCompletion,
	type BillingCatalogBatch,
	type BillingCatalogTable,
} from "@superboard/contracts/billing-catalog";

import { httpError, readJson, requestHash, type WorkerContext } from "./catalog-ledger-http.js";

const tableOrder = Object.keys(BILLING_CATALOG_TABLES) as BillingCatalogTable[];

export async function catalogImportStatus(c: WorkerContext): Promise<Response> {
	return c.json({ data: await status(c) });
}

async function status(c: WorkerContext) {
	const project = c.get("project");
	const rows = await c.env.DB.prepare(
		"SELECT source_table,source_cursor,completed_at FROM billing_catalog_imports WHERE project_id=? AND source='products'",
	)
		.bind(project.projectId)
		.all<{ source_table: string; source_cursor: string; completed_at: string | null }>();
	const pending = tableOrder.find(
		(table) => !rows.results.some((row) => row.source_table === table && row.completed_at),
	);
	if (pending) {
		const row = rows.results.find((row) => row.source_table === pending);
		return {
			complete: false,
			table: pending,
			cursor: row ? (JSON.parse(row.source_cursor) as Array<string | number>) : [],
		};
	}
	const receipt = {
		schema_version: 1 as const,
		project_id: project.projectId,
		project_ref: project.projectRef!,
		instance_id: project.instanceId!,
		issued_at: Math.floor(Date.now() / 1000),
	};
	return {
		complete: true,
		receipt,
		signature: await signBillingCatalogCompletion(receipt, c.env.INTERNAL_API_TOKEN),
	};
}

export async function importCatalogBatch(c: WorkerContext): Promise<Response> {
	const envelope = (await readJson(c.req.raw, 4 * 1024 * 1024)) as {
		batch?: BillingCatalogBatch;
		signature?: string;
	};
	const batch = envelope?.batch;
	const project = c.get("project");
	if (
		!batch ||
		batch.schema_version !== 1 ||
		!Object.hasOwn(BILLING_CATALOG_TABLES, batch.table) ||
		!Array.isArray(batch.rows) ||
		batch.rows.length > 10 ||
		!Array.isArray(batch.cursor) ||
		!Array.isArray(batch.next_cursor) ||
		typeof batch.complete !== "boolean" ||
		typeof envelope.signature !== "string"
	)
		throw httpError("catalog_batch_invalid", "Invalid catalog import batch", 422);
	if (
		batch.project_id !== project.projectId ||
		batch.instance_id !== project.instanceId ||
		batch.project_ref !== project.projectRef ||
		!(await verifyBillingCatalogBatch(batch, envelope.signature, c.env.INTERNAL_API_TOKEN))
	)
		throw httpError("catalog_batch_forbidden", "Catalog import evidence is invalid", 403);
	const current = await status(c);
	const spec = BILLING_CATALOG_TABLES[batch.table];
	if (
		current.complete ||
		current.table !== batch.table ||
		JSON.stringify(current.cursor) !== JSON.stringify(batch.cursor)
	) {
		const completed = await c.env.DB.prepare(
			"SELECT completed_at FROM billing_catalog_imports WHERE project_id=? AND source='products' AND source_table=?",
		)
			.bind(project.projectId, batch.table)
			.first<{ completed_at: string | null }>();
		if (completed?.completed_at) return c.json({ data: current });
		throw httpError("catalog_cursor_conflict", "Catalog import cursor changed", 409);
	}
	if (
		(batch.cursor.length && batch.cursor.length !== spec.keys.length) ||
		(batch.next_cursor.length !== spec.keys.length && batch.rows.length)
	)
		throw httpError("catalog_cursor_invalid", "Invalid import cursor", 422);
	const statements: D1PreparedStatement[] = [];
	for (const sourceRow of batch.rows) {
		if (
			!sourceRow ||
			typeof sourceRow !== "object" ||
			Object.keys(sourceRow).length !== spec.columns.length ||
			spec.columns.some((column) => !(column in sourceRow)) ||
			Object.values(sourceRow).some(
				(value) => value !== null && typeof value !== "string" && typeof value !== "number",
			)
		)
			throw httpError("catalog_row_invalid", "Invalid catalog record", 422);
		if ("project_id" in sourceRow && String(sourceRow.project_id) !== project.projectId)
			throw httpError(
				"catalog_project_forbidden",
				"Catalog record belongs to another project",
				403,
			);
		const key = JSON.stringify(spec.keys.map((column) => sourceRow[column]));
		const hash = await requestHash(sourceRow);
		const existing = await c.env.DB.prepare(
			`SELECT ${spec.keys.join(",")} FROM billing_catalog_${batch.table} WHERE ${spec.keys.map((column) => `${column}=?`).join(" AND ")}`,
		)
			.bind(...spec.keys.map((column) => sourceRow[column]))
			.first();
		if (existing) {
			const imported = await c.env.DB.prepare(
				"SELECT source_hash FROM billing_catalog_imported_rows WHERE project_id=? AND source_table=? AND source_key=?",
			)
				.bind(project.projectId, batch.table, key)
				.first<{ source_hash: string }>();
			if (imported?.source_hash === hash) continue;
			throw httpError(
				"catalog_import_conflict",
				"Existing Billing data conflicts with imported record",
				409,
			);
		}
		const row = { ...sourceRow };
		if (batch.table === "idempotency_keys" && typeof row.path === "string")
			row.path = row.path.replace("/internal/v1/", "/internal/v1/catalog-ledger/");
		if (batch.table === "entitlement_products" || batch.table === "purchase_entitlements") {
			const parentTable = batch.table === "entitlement_products" ? "products" : "purchases";
			const parentId = batch.table === "entitlement_products" ? row.product_id : row.purchase_id;
			const owned = await c.env.DB.prepare(
				`SELECT parent.id FROM billing_catalog_${parentTable} parent JOIN billing_catalog_entitlements entitlement ON entitlement.id=? AND entitlement.project_id=parent.project_id WHERE parent.id=? AND parent.project_id=?`,
			)
				.bind(row.entitlement_id, parentId, project.projectId)
				.first();
			if (!owned)
				throw httpError(
					"catalog_relation_forbidden",
					"Catalog relation is outside this project",
					403,
				);
		}
		statements.push(
			c.env.DB.prepare(
				`INSERT INTO billing_catalog_${batch.table} (${spec.columns.join(",")}) VALUES (${spec.columns.map(() => "?").join(",")})`,
			).bind(...spec.columns.map((column) => row[column])),
			c.env.DB.prepare(
				"INSERT INTO billing_catalog_imported_rows (project_id,source_table,source_key,source_hash) VALUES (?,?,?,?)",
			).bind(project.projectId, batch.table, key, hash),
		);
	}
	statements.push(
		c.env.DB.prepare(
			"INSERT INTO billing_catalog_imports (project_id,source,source_table,source_cursor,completed_at) VALUES (?,'products',?,?,?) ON CONFLICT(project_id,source,source_table) DO UPDATE SET source_cursor=excluded.source_cursor,completed_at=excluded.completed_at",
		).bind(
			project.projectId,
			batch.table,
			JSON.stringify(batch.next_cursor),
			batch.complete ? new Date().toISOString() : null,
		),
	);
	await c.env.DB.batch(statements);
	return c.json({ data: await status(c) });
}
