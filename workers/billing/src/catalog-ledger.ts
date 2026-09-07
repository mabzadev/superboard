import { Hono } from "hono";

import { reconcileBillingState } from "../../api/src/lib/billing-jobs.js";
import type { BillingEnv } from "../../api/src/types.js";
import {
	parseEntitlement,
	parsePurchase,
	parseRefund,
	parseSubscriptionUpdate,
	parseProduct,
	record,
	requiredText,
} from "./catalog-ledger-contracts.js";
import {
	commitMutation,
	storedMutationResponse,
	errorResponse,
	httpError,
	internalAuth,
	readJson,
	type WorkerBindings,
	type WorkerContext,
	type WorkerVariables,
} from "./catalog-ledger-http.js";
import { catalogImportStatus, importCatalogBatch } from "./catalog-ledger-import.js";
type EntityRow = Record<string, unknown> & { id: string };
const app = new Hono<{ Bindings: WorkerBindings; Variables: WorkerVariables }>();
app.use("/internal/v1/catalog-ledger/*", internalAuth());
app.use("/internal/v1/catalog-ledger", internalAuth());
app.onError((error, c) => errorResponse(error, c));
app.use("/internal/v1/catalog-ledger/*", async (c, next) => {
	if (!["GET", "HEAD"].includes(c.req.method)) {
		if (!c.req.header("Idempotency-Key"))
			throw httpError("idempotency_key_required", "Idempotency-Key is required", 400);
		const replay = await storedMutationResponse(c);
		if (replay) return replay;
	}
	return next();
});
app.get("/internal/v1/catalog-ledger/migration/status", catalogImportStatus);
app.post("/internal/v1/catalog-ledger/migration/import", importCatalogBatch);
app.post("/internal/v1/catalog-ledger/reconcile", async (c) => {
	const body = record(await readJson(c.req.raw));
	if (Object.keys(body).length)
		throw httpError("reconcile_input_invalid", "Project reconciliation accepts an empty body", 422);
	const result = await reconcileBillingState(c.env as Env & BillingEnv, { projectId: project(c) });
	return commitMutation(c, {
		action: "billing.reconciled",
		entityType: "project",
		entityId: project(c),
		requestBody: body,
		data: { ...result, catalog_reconciled: true },
		statements: [
			c.env.DB.prepare(
				"UPDATE billing_catalog_subscriptions SET status='expired',auto_renew=0,updated_at=? WHERE project_id=? AND status NOT IN ('expired','refunded','cancelled') AND current_period_ends_at IS NOT NULL AND datetime(current_period_ends_at)<=datetime('now')",
			).bind(now(), project(c)),
			c.env.DB.prepare(
				"UPDATE billing_catalog_purchases SET status='expired',updated_at=? WHERE project_id=? AND status='active' AND expires_at IS NOT NULL AND datetime(expires_at)<=datetime('now')",
			).bind(now(), project(c)),
		],
	});
});
app.get("/internal/v1/catalog-ledger/products", async (c) => {
	const rows = await c.env.DB.prepare(
		"SELECT id, identifier, display_name, description, product_type, status, created_at, updated_at FROM billing_catalog_products WHERE project_id=? UNION ALL SELECT id, store_product_id AS identifier, COALESCE(display_name,store_product_id) AS display_name,description,product_type,CASE active WHEN 1 THEN 'active' ELSE 'archived' END AS status,created_at,updated_at FROM billing_products WHERE project_id=? AND id NOT IN (SELECT id FROM billing_catalog_products WHERE project_id=?) ORDER BY display_name,id",
	)
		.bind(project(c), project(c), project(c))
		.all();
	return c.json({ data: rows.results });
});
app.delete("/internal/v1/catalog-ledger/entitlements/:id", async (c) => {
	const id = c.req.param("id");
	await owned(c, "entitlements", id, "entitlement");
	return commitMutation(c, {
		action: "entitlement.archived",
		entityType: "entitlement",
		entityId: id,
		requestBody: {},
		data: { id, archived: true },
		statements: [
			c.env.DB.prepare(
				"UPDATE billing_catalog_entitlements SET active=0,updated_at=? WHERE id=? AND project_id=?",
			).bind(now(), id, project(c)),
		],
	});
});
app.get("/internal/v1/catalog-ledger/purchases", async (c) => {
	const clauses = ["p.project_id=?"];
	const values: unknown[] = [project(c)];
	addFilter(c, clauses, values, "status", "p.status");
	addFilter(c, clauses, values, "customer_id", "fc.external_customer_id");
	addFilter(c, clauses, values, "product_id", "p.product_id");
	addFilter(c, clauses, values, "store", "p.store");
	const platform = c.req.query("platform");
	if (platform) {
		clauses.push("p.store=?");
		values.push(storeForPlatform(platform));
	}
	const from = optionalDate(c.req.query("from"), "from", false);
	const to = optionalDate(c.req.query("to"), "to", true);
	if (from) {
		clauses.push("p.purchased_at>=?");
		values.push(from);
	}
	if (to) {
		clauses.push("p.purchased_at<?");
		values.push(to);
	}
	if (from && to && from >= to)
		throw httpError("purchase_range_invalid", "from must be before to", 422);
	const rows = await c.env.DB.prepare(
		`SELECT p.*, fc.external_customer_id, pr.identifier AS product_identifier, pr.display_name AS product_name FROM billing_catalog_purchases p JOIN billing_catalog_financial_customers fc ON fc.id=p.financial_customer_id AND fc.project_id=p.project_id LEFT JOIN billing_catalog_products pr ON pr.id=p.product_id AND pr.project_id=p.project_id WHERE ${clauses.join(" AND ")} ORDER BY p.purchased_at DESC LIMIT 500`,
	)
		.bind(...values)
		.all();
	return c.json({ data: rows.results });
});

app.post("/internal/v1/catalog-ledger/purchases", async (c) => {
	const body = await readJson(c.req.raw);
	const input = parsePurchase(body);
	const projection = await prepareProduct(c, input.product_id, record(body).product_snapshot);
	const productRow = projection.product;
	const existingCustomer = await c.env.DB.prepare(
		"SELECT id FROM billing_catalog_financial_customers WHERE project_id=? AND external_customer_id=?",
	)
		.bind(project(c), input.financial_customer_id)
		.first<{ id: string }>();
	const customerId = existingCustomer?.id ?? crypto.randomUUID();
	const id = crypto.randomUUID();
	const purchase = { id, customer_id: customerId, ...input, updated_at: now() };
	const entitlementRows = await c.env.DB.prepare(
		`SELECT e.id FROM billing_catalog_entitlements e JOIN billing_catalog_entitlement_products ep ON ep.entitlement_id=e.id WHERE e.project_id=? AND e.active=1 AND ep.product_id=?`,
	)
		.bind(project(c), input.product_id)
		.all<{ id: string }>();
	const statements: D1PreparedStatement[] = [...projection.statements];
	if (!existingCustomer)
		statements.push(
			c.env.DB.prepare(
				`INSERT INTO billing_catalog_financial_customers (id, project_id, external_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
			).bind(customerId, project(c), input.financial_customer_id, now(), now()),
		);
	statements.push(
		c.env.DB.prepare(
			`INSERT INTO billing_catalog_purchases (id, project_id, financial_customer_id, product_id, status, purchased_at, payload_json, store, environment, external_transaction_id, original_transaction_id, purchased_price_micros, currency, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(
			id,
			project(c),
			customerId,
			input.product_id,
			input.status,
			input.purchased_at,
			JSON.stringify(input.payload),
			input.store,
			input.environment,
			input.external_transaction_id,
			input.original_transaction_id,
			input.purchased_price_micros,
			input.currency,
			input.expires_at,
			purchase.updated_at,
		),
	);
	const entitlementIds = [
		...new Set([...entitlementRows.results.map(({ id }) => id), ...projection.entitlementIds]),
	];
	for (const entitlementId of entitlementIds)
		statements.push(
			c.env.DB.prepare(
				"INSERT INTO billing_catalog_purchase_entitlements (purchase_id, entitlement_id) VALUES (?, ?)",
			).bind(id, entitlementId),
		);
	if (productRow.product_type === "subscription") {
		const subscriptionId = crypto.randomUUID();
		statements.push(
			c.env.DB.prepare(
				`INSERT INTO billing_catalog_subscriptions (id, project_id, financial_customer_id, product_id, latest_purchase_id, store, environment, original_transaction_id, status, current_period_started_at, current_period_ends_at, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, store, environment, original_transaction_id) DO UPDATE SET latest_purchase_id=excluded.latest_purchase_id, status=excluded.status, current_period_started_at=excluded.current_period_started_at, current_period_ends_at=excluded.current_period_ends_at, updated_at=excluded.updated_at`,
			).bind(
				subscriptionId,
				project(c),
				customerId,
				input.product_id,
				id,
				input.store,
				input.environment,
				input.original_transaction_id,
				subscriptionStatus(input.status),
				input.purchased_at,
				input.expires_at,
				input.status === "cancelled" ? 0 : 1,
				now(),
				now(),
			),
		);
	}
	return commitMutation(c, {
		action: "purchase.recorded",
		entityType: "purchase",
		entityId: id,
		requestBody: body,
		status: 201,
		data: {
			...purchase,
			entitlement_ids: entitlementIds,
		},
		statements,
	});
});

app.get("/internal/v1/catalog-ledger/purchases/:id", async (c) => {
	const purchaseRow = await owned(c, "purchases", c.req.param("id"), "purchase");
	const [entitlementRows, refundRows] = await Promise.all([
		c.env.DB.prepare(
			`SELECT e.* FROM billing_catalog_entitlements e JOIN billing_catalog_purchase_entitlements pe ON pe.entitlement_id=e.id WHERE pe.purchase_id=? AND e.project_id=?`,
		)
			.bind(c.req.param("id"), project(c))
			.all(),
		c.env.DB.prepare(
			"SELECT * FROM billing_catalog_refunds WHERE purchase_id=? AND project_id=? ORDER BY requested_at DESC",
		)
			.bind(c.req.param("id"), project(c))
			.all(),
	]);
	const customer = await c.env.DB.prepare(
		"SELECT external_customer_id FROM billing_catalog_financial_customers WHERE id=? AND project_id=?",
	)
		.bind(purchaseRow.financial_customer_id, project(c))
		.first<{ external_customer_id: string }>();
	return c.json({
		data: {
			...purchaseRow,
			external_customer_id: customer?.external_customer_id ?? null,
			entitlements: entitlementRows.results,
			refunds: refundRows.results,
		},
	});
});

app.post("/internal/v1/catalog-ledger/purchases/:id/refunds", async (c) => {
	const purchaseId = c.req.param("id");
	const purchaseRow = (await owned(c, "purchases", purchaseId, "purchase")) as EntityRow & {
		purchased_price_micros: number;
		currency: string | null;
		original_transaction_id: string;
	};
	const body = await readJson(c.req.raw);
	const input = parseRefund(body);
	const id = crypto.randomUUID();
	const amount = input.amount_micros || purchaseRow.purchased_price_micros;
	const currencyCode = input.currency || purchaseRow.currency;
	const completedAt = input.status === "completed" ? (input.completed_at ?? now()) : null;
	const row = {
		id,
		purchase_id: purchaseId,
		...input,
		amount_micros: amount,
		currency: currencyCode,
		completed_at: completedAt,
		updated_at: now(),
	};
	const statements = [
		c.env.DB.prepare(
			`INSERT INTO billing_catalog_refunds (id, project_id, purchase_id, external_refund_id, status, amount_micros, currency, reason, metadata_json, requested_at, completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(
			id,
			project(c),
			purchaseId,
			input.external_refund_id,
			input.status,
			amount,
			currencyCode,
			input.reason,
			JSON.stringify(input.metadata),
			input.requested_at,
			completedAt,
			row.updated_at,
		),
	];
	if (input.status === "completed") {
		statements.push(
			c.env.DB.prepare(
				`UPDATE billing_catalog_purchases SET status='refunded', updated_at=? WHERE id=? AND project_id=?`,
			).bind(now(), purchaseId, project(c)),
		);
		statements.push(
			c.env.DB.prepare(
				`UPDATE billing_catalog_subscriptions SET status='refunded', auto_renew=0, updated_at=? WHERE project_id=? AND original_transaction_id=?`,
			).bind(now(), project(c), purchaseRow.original_transaction_id),
		);
	}
	return commitMutation(c, {
		action: "refund.created",
		entityType: "refund",
		entityId: id,
		requestBody: body,
		status: 201,
		data: row,
		statements,
	});
});

app.get("/internal/v1/catalog-ledger/refunds", async (c) => {
	const rows = await c.env.DB.prepare(
		"SELECT * FROM billing_catalog_refunds WHERE project_id=? ORDER BY requested_at DESC LIMIT 500",
	)
		.bind(project(c))
		.all();
	return c.json({ data: rows.results });
});

app.put("/internal/v1/catalog-ledger/refunds/:id", async (c) => {
	const id = c.req.param("id");
	const current = (await owned(c, "refunds", id, "refund")) as EntityRow & {
		purchase_id: string;
		status: string;
	};
	if (["completed", "rejected", "cancelled"].includes(current.status))
		throw httpError("refund_terminal", "A terminal refund cannot be changed", 409);
	const body = await readJson(c.req.raw);
	const input = parseRefund(body);
	const purchaseRow = (await owned(
		c,
		"purchases",
		current.purchase_id,
		"purchase",
	)) as EntityRow & { original_transaction_id: string };
	const completedAt = input.status === "completed" ? (input.completed_at ?? now()) : null;
	const row = { id, ...input, completed_at: completedAt, updated_at: now() };
	const statements = [
		c.env.DB.prepare(
			`UPDATE billing_catalog_refunds SET external_refund_id=?,status=?,amount_micros=?,currency=?,reason=?,metadata_json=?,requested_at=?,completed_at=?,updated_at=? WHERE id=? AND project_id=?`,
		).bind(
			input.external_refund_id,
			input.status,
			input.amount_micros,
			input.currency,
			input.reason,
			JSON.stringify(input.metadata),
			input.requested_at,
			completedAt,
			row.updated_at,
			id,
			project(c),
		),
	];
	if (input.status === "completed") {
		statements.push(
			c.env.DB.prepare(
				`UPDATE billing_catalog_purchases SET status='refunded',updated_at=? WHERE id=? AND project_id=?`,
			).bind(now(), current.purchase_id, project(c)),
			c.env.DB.prepare(
				`UPDATE billing_catalog_subscriptions SET status='refunded',auto_renew=0,updated_at=? WHERE project_id=? AND original_transaction_id=?`,
			).bind(now(), project(c), purchaseRow.original_transaction_id),
		);
	}
	return commitMutation(c, {
		action: "refund.updated",
		entityType: "refund",
		entityId: id,
		requestBody: body,
		data: row,
		statements,
	});
});

app.get("/internal/v1/catalog-ledger/customers/:customerId/entitlements", async (c) => {
	const customer = await c.env.DB.prepare(
		"SELECT id,external_customer_id FROM billing_catalog_financial_customers WHERE project_id=? AND external_customer_id=?",
	)
		.bind(project(c), c.req.param("customerId"))
		.first<{ id: string; external_customer_id: string }>();
	if (!customer) throw httpError("financial_customer_not_found", "Customer was not found", 404);
	const rows = await c.env.DB.prepare(
		`SELECT DISTINCT e.id,e.key AS identifier,e.name AS display_name,e.description,p.expires_at,p.id AS purchase_id
     FROM billing_catalog_entitlements e JOIN billing_catalog_purchase_entitlements pe ON pe.entitlement_id=e.id
     JOIN billing_catalog_purchases p ON p.id=pe.purchase_id AND p.project_id=e.project_id
     WHERE e.project_id=? AND e.active=1 AND p.financial_customer_id=? AND p.status='active'
       AND (p.expires_at IS NULL OR p.expires_at>?) ORDER BY e.name`,
	)
		.bind(project(c), customer.id, now())
		.all();
	return c.json({ data: { customer, entitlements: rows.results } });
});

app.get("/internal/v1/catalog-ledger/subscriptions", async (c) => {
	const clauses = ["s.project_id=?"];
	const values: unknown[] = [project(c)];
	addFilter(c, clauses, values, "status", "s.status");
	addFilter(c, clauses, values, "customer_id", "fc.external_customer_id");
	const rows = await c.env.DB.prepare(
		`SELECT s.*,fc.external_customer_id,p.identifier AS product_identifier,p.display_name AS product_name FROM billing_catalog_subscriptions s JOIN billing_catalog_financial_customers fc ON fc.id=s.financial_customer_id AND fc.project_id=s.project_id JOIN billing_catalog_products p ON p.id=s.product_id AND p.project_id=s.project_id WHERE ${clauses.join(" AND ")} ORDER BY s.updated_at DESC LIMIT 500`,
	)
		.bind(...values)
		.all();
	return c.json({ data: rows.results });
});

app.put("/internal/v1/catalog-ledger/subscriptions/:id", async (c) => {
	const id = c.req.param("id");
	await owned(c, "subscriptions", id, "subscription");
	const body = await readJson(c.req.raw);
	const input = parseSubscriptionUpdate(body);
	const row = { id, ...input, updated_at: now() };
	return commitMutation(c, {
		action: "subscription.updated",
		entityType: "subscription",
		entityId: id,
		requestBody: body,
		data: row,
		statements: [
			c.env.DB.prepare(
				`UPDATE billing_catalog_subscriptions SET status=?, current_period_started_at=?, current_period_ends_at=?, auto_renew=?, cancelled_at=?, updated_at=? WHERE id=? AND project_id=?`,
			).bind(
				input.status,
				input.current_period_started_at,
				input.current_period_ends_at,
				flag(input.auto_renew),
				input.cancelled_at,
				row.updated_at,
				id,
				project(c),
			),
		],
	});
});

app.get("/internal/v1/catalog-ledger/entitlements", async (c) =>
	c.json({ data: await entitlements(c) }),
);

app.post("/internal/v1/catalog-ledger/entitlements", async (c) => {
	const body = await readJson(c.req.raw);
	const input = parseEntitlement(body);
	const prepared = await Promise.all(
		input.product_ids.map((id) => prepareProduct(c, id, undefined)),
	);
	const row = {
		id: crypto.randomUUID(),
		...input,
		created_at: now(),
		updated_at: now(),
	};
	return commitMutation(c, {
		action: "entitlement.created",
		entityType: "entitlement",
		entityId: row.id,
		requestBody: body,
		status: 201,
		data: row,
		statements: [
			...prepared.flatMap((item) => item.statements),
			c.env.DB.prepare(
				`INSERT INTO billing_catalog_entitlements (id, project_id, key, name, description, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			).bind(
				row.id,
				project(c),
				row.identifier,
				row.display_name,
				row.description,
				flag(row.active),
				row.created_at,
				row.updated_at,
			),
			...input.product_ids.map((productId) =>
				c.env.DB.prepare(
					"INSERT INTO billing_catalog_entitlement_products (entitlement_id, product_id) VALUES (?, ?)",
				).bind(row.id, productId),
			),
		],
	});
});

app.get("/internal/v1/catalog-ledger/entitlements/:id", async (c) => {
	const rows = await entitlements(c, c.req.param("id"));
	if (!rows[0]) throw httpError("entitlement_not_found", "Entitlement was not found", 404);
	return c.json({ data: rows[0] });
});

app.put("/internal/v1/catalog-ledger/entitlements/:id", async (c) => {
	const id = c.req.param("id");
	await owned(c, "entitlements", id, "entitlement");
	const body = await readJson(c.req.raw);
	const input = parseEntitlement(body);
	const prepared = await Promise.all(
		input.product_ids.map((id) => prepareProduct(c, id, undefined)),
	);
	const row = { id, ...input, updated_at: now() };
	return commitMutation(c, {
		action: "entitlement.updated",
		entityType: "entitlement",
		entityId: id,
		requestBody: body,
		data: row,
		statements: [
			...prepared.flatMap((item) => item.statements),
			c.env.DB.prepare(
				`UPDATE billing_catalog_entitlements SET key=?, name=?, description=?, active=?, updated_at=? WHERE id=? AND project_id=?`,
			).bind(
				input.identifier,
				input.display_name,
				input.description,
				flag(input.active),
				row.updated_at,
				id,
				project(c),
			),
			c.env.DB.prepare(
				"DELETE FROM billing_catalog_entitlement_products WHERE entitlement_id=?",
			).bind(id),
			...input.product_ids.map((productId) =>
				c.env.DB.prepare(
					"INSERT INTO billing_catalog_entitlement_products (entitlement_id, product_id) VALUES (?, ?)",
				).bind(id, productId),
			),
		],
	});
});

app.get("/internal/v1/catalog-ledger/statistics", async (c) => {
	const range = dateRange(c);
	const clauses = ["p.project_id=?", "p.purchased_at>=?", "p.purchased_at<?"];
	const values: unknown[] = [project(c), range.from, range.to];
	addFilter(c, clauses, values, "product_id", "p.product_id");
	const platform = c.req.query("platform");
	if (platform) {
		clauses.push("p.store=?");
		values.push(storeForPlatform(platform));
	}
	const where = clauses.join(" AND ");
	const [totals, statuses, series, activeSubscriptions] = await Promise.all([
		c.env.DB.prepare(
			`SELECT COUNT(*) AS purchases, COALESCE(SUM(p.purchased_price_micros),0) AS gross_revenue_micros FROM billing_catalog_purchases p WHERE ${where} AND p.status IN ('active','expired','cancelled','refunded')`,
		)
			.bind(...values)
			.first(),
		c.env.DB.prepare(
			`SELECT p.status, COUNT(*) AS count FROM billing_catalog_purchases p WHERE ${where} GROUP BY p.status`,
		)
			.bind(...values)
			.all(),
		c.env.DB.prepare(
			`SELECT substr(p.purchased_at,1,10) AS bucket, COUNT(*) AS purchases, COALESCE(SUM(p.purchased_price_micros),0) AS revenue_micros FROM billing_catalog_purchases p WHERE ${where} GROUP BY bucket ORDER BY bucket`,
		)
			.bind(...values)
			.all(),
		c.env.DB.prepare(
			`SELECT COUNT(*) AS count FROM billing_catalog_subscriptions s WHERE s.project_id=? AND s.status IN ('trialing','active','grace_period') ${c.req.query("product_id") ? "AND s.product_id=?" : ""} ${platform ? "AND s.store=?" : ""}`,
		)
			.bind(
				project(c),
				...(c.req.query("product_id") ? [c.req.query("product_id")] : []),
				...(platform ? [storeForPlatform(platform)] : []),
			)
			.first<{ count: number }>(),
	]);
	const refundClauses = ["r.project_id=?", "r.requested_at>=?", "r.requested_at<?"];
	const refundValues: unknown[] = [project(c), range.from, range.to];
	if (c.req.query("product_id")) {
		refundClauses.push("p.product_id=?");
		refundValues.push(c.req.query("product_id"));
	}
	if (platform) {
		refundClauses.push("p.store=?");
		refundValues.push(storeForPlatform(platform));
	}
	const refunds = await c.env.DB.prepare(
		`SELECT COUNT(*) AS refunds, COALESCE(SUM(r.amount_micros),0) AS refunded_micros FROM billing_catalog_refunds r JOIN billing_catalog_purchases p ON p.id=r.purchase_id AND p.project_id=r.project_id WHERE ${refundClauses.join(" AND ")} AND r.status='completed'`,
	)
		.bind(...refundValues)
		.first();
	const breakdown = await c.env.DB.prepare(
		`SELECT
       p.product_id,
       pr.display_name AS product_name,
       CASE p.store WHEN 'apple' THEN 'ios' WHEN 'google' THEN 'android' ELSE p.store END AS platform,
       p.store,
       p.currency,
       COUNT(*) AS units_sold,
       SUM(CASE WHEN NOT EXISTS (
         SELECT 1 FROM billing_catalog_purchases first_purchase
         WHERE first_purchase.project_id=p.project_id
           AND first_purchase.financial_customer_id=p.financial_customer_id
           AND first_purchase.status IN ('active','expired','cancelled','refunded')
           AND (first_purchase.purchased_at<p.purchased_at OR (first_purchase.purchased_at=p.purchased_at AND first_purchase.id<p.id))
       ) THEN 1 ELSE 0 END) AS first_time_purchases,
       COALESCE(SUM(p.purchased_price_micros),0) AS revenue_micros,
       SUM(CASE WHEN p.status='cancelled' THEN 1 ELSE 0 END) AS cancellations
     FROM billing_catalog_purchases p
     JOIN billing_catalog_products pr ON pr.id=p.product_id AND pr.project_id=p.project_id
     WHERE ${where} AND p.status IN ('active','expired','cancelled','refunded')
     GROUP BY p.product_id,pr.display_name,p.store,p.currency
     ORDER BY revenue_micros DESC,pr.display_name,p.store,p.currency`,
	)
		.bind(...values)
		.all();
	const mergedTotals = {
		...totals,
		...refunds,
		active_subscriptions: activeSubscriptions?.count ?? 0,
		net_revenue_micros:
			Number(totals?.gross_revenue_micros ?? 0) - Number(refunds?.refunded_micros ?? 0),
	};
	return c.json({
		data: {
			range,
			filters: {
				product_id: c.req.query("product_id") ?? null,
				platform: platform ?? null,
			},
			totals: mergedTotals,
			by_status: statuses.results,
			series: series.results,
			by_product_platform: breakdown.results,
		},
	});
});

async function entitlements(c: WorkerContext, id?: string): Promise<EntityRow[]> {
	const rows = await c.env.DB.prepare(
		`SELECT id, key AS identifier, name AS display_name, description, active, created_at, updated_at FROM billing_catalog_entitlements WHERE project_id=? ${id ? "AND id=?" : ""} ORDER BY updated_at DESC`,
	)
		.bind(project(c), ...(id ? [id] : []))
		.all<EntityRow>();
	if (!rows.results.length) return [];
	const ids = rows.results.map((row) => row.id);
	const productRows = await c.env.DB.prepare(
		`SELECT ep.entitlement_id, p.* FROM billing_catalog_entitlement_products ep JOIN billing_catalog_products p ON p.id=ep.product_id AND p.project_id=? WHERE ep.entitlement_id IN (${ids.map(() => "?").join(",")}) ORDER BY p.display_name`,
	)
		.bind(project(c), ...ids)
		.all<Record<string, unknown> & { entitlement_id: string }>();
	return rows.results.map((row) => ({
		...row,
		active: Boolean(row.active),
		products: productRows.results.filter((productRow) => productRow.entitlement_id === row.id),
	}));
}

function dateRange(c: WorkerContext): {
	from: string;
	to: string;
	timezone: string;
} {
	const toInput = c.req.query("to");
	const fromInput = c.req.query("from");
	const to = toInput ? new Date(requiredText(toInput, "to")) : new Date();
	if (toInput && /^\d{4}-\d{2}-\d{2}$/.test(toInput)) to.setUTCDate(to.getUTCDate() + 1);
	const from = fromInput
		? new Date(requiredText(fromInput, "from"))
		: new Date(to.getTime() - 30 * 86_400_000);
	if (
		Number.isNaN(from.getTime()) ||
		Number.isNaN(to.getTime()) ||
		from >= to ||
		to.getTime() - from.getTime() > 366 * 86_400_000
	)
		throw httpError(
			"statistics_range_invalid",
			"Statistics range must be valid and no longer than 366 days",
			422,
		);
	return {
		from: from.toISOString(),
		to: to.toISOString(),
		timezone: c.req.query("timezone") ?? "UTC",
	};
}

async function prepareProduct(c: WorkerContext, id: string, snapshot: unknown) {
	const existing = await c.env.DB.prepare(
		"SELECT * FROM billing_catalog_products WHERE id = ? AND project_id = ?",
	)
		.bind(id, project(c))
		.first<EntityRow & { product_type: string }>();
	if (existing)
		return {
			product: existing,
			statements: [] as D1PreparedStatement[],
			entitlementIds: [] as string[],
		};
	const native = await c.env.DB.prepare(
		"SELECT store_product_id,display_name,description,product_type,active FROM billing_products WHERE id = ? AND project_id = ?",
	)
		.bind(id, project(c))
		.first<{
			store_product_id: string;
			display_name: string | null;
			description: string | null;
			product_type: string;
			active: number;
		}>();
	if (!native && snapshot === undefined)
		throw httpError("product_not_found", "Billing product or product snapshot is required", 404);
	const input = parseProduct(
		native
			? {
					identifier: native.store_product_id,
					display_name: native.display_name ?? native.store_product_id,
					description: native.description,
					product_type: native.product_type,
					status: native.active ? "active" : "archived",
				}
			: snapshot,
	);
	const productRow = { id, ...input };
	const statements = [
		c.env.DB.prepare(
			"INSERT INTO billing_catalog_products (id,project_id,identifier,display_name,description,product_type,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
		).bind(
			id,
			project(c),
			input.identifier,
			input.display_name,
			input.description,
			input.product_type,
			input.status,
			now(),
			now(),
		),
	];
	const entitlementIds: string[] = [];
	if (native) {
		const entitlements = await c.env.DB.prepare(
			"SELECT entitlement.id,entitlement.identifier,entitlement.display_name,entitlement.description FROM billing_entitlements entitlement JOIN billing_product_entitlements relation ON relation.entitlement_id = entitlement.id WHERE relation.product_id = ? AND entitlement.project_id = ? AND entitlement.active = 1",
		)
			.bind(id, project(c))
			.all<{
				id: string;
				identifier: string;
				display_name: string | null;
				description: string | null;
			}>();
		for (const entitlement of entitlements.results) {
			const existingEntitlement = await c.env.DB.prepare(
				"SELECT project_id,key FROM billing_catalog_entitlements WHERE id = ?",
			)
				.bind(entitlement.id)
				.first<{ project_id: string; key: string }>();
			if (
				existingEntitlement &&
				(existingEntitlement.project_id !== project(c) ||
					existingEntitlement.key !== entitlement.identifier)
			)
				throw httpError(
					"entitlement_projection_conflict",
					"Entitlement identity conflicts with existing Billing data",
					409,
				);
			entitlementIds.push(entitlement.id);
			statements.push(
				c.env.DB.prepare(
					"INSERT INTO billing_catalog_entitlements (id,project_id,key,name,description,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(id) DO NOTHING",
				).bind(
					entitlement.id,
					project(c),
					entitlement.identifier,
					entitlement.display_name ?? entitlement.identifier,
					entitlement.description,
					now(),
					now(),
				),
				c.env.DB.prepare(
					"INSERT INTO billing_catalog_entitlement_products (entitlement_id,product_id) VALUES (?,?) ON CONFLICT DO NOTHING",
				).bind(entitlement.id, id),
			);
		}
	}
	return { product: productRow, statements, entitlementIds };
}

app.get("/internal/v1/catalog-ledger", async (c) => {
	const [operations, balanceEntries] = await Promise.all([
		c.env.DB.prepare(
			"SELECT id,action,actor_id,entity_type,entity_id,request_id,payload_json,occurred_at,created_at FROM billing_catalog_audit_events WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 100",
		)
			.bind(project(c))
			.all(),
		c.env.DB.prepare(
			"SELECT id,customer_id,product_id,transaction_id,currency_identifier,amount,reason,created_at,expires_at FROM billing_balance_ledger WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 100",
		)
			.bind(project(c))
			.all(),
	]);
	return c.json({
		data: { operations: operations.results, balance_entries: balanceEntries.results },
	});
});

async function owned(
	c: WorkerContext,
	table:
		| "products"
		| "packages"
		| "offerings"
		| "entitlements"
		| "purchases"
		| "subscriptions"
		| "refunds",
	id: string,
	label: string,
): Promise<EntityRow> {
	const row = await c.env.DB.prepare(
		`SELECT * FROM billing_catalog_${table} WHERE id=? AND project_id=?`,
	)
		.bind(id, project(c))
		.first<EntityRow>();
	if (!row) throw httpError(`${label}_not_found`, `${title(label)} was not found`, 404);
	return row;
}

function project(c: WorkerContext): string {
	return c.get("project").projectId;
}
function flag(value: boolean): number {
	return value ? 1 : 0;
}
function now(): string {
	return new Date().toISOString();
}
function title(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
function subscriptionStatus(status: string): string {
	if (status === "pending") return "trialing";
	if (status === "failed") return "expired";
	return status;
}
function addFilter(
	c: WorkerContext,
	clauses: string[],
	values: unknown[],
	query: string,
	column: string,
): void {
	const value = c.req.query(query);
	if (value) {
		clauses.push(`${column}=?`);
		values.push(value);
	}
}
function optionalDate(
	value: string | undefined,
	name: string,
	inclusiveDate: boolean,
): string | null {
	if (!value) return null;
	const parsed = new Date(requiredText(value, name));
	if (Number.isNaN(parsed.getTime()))
		throw httpError("date_invalid", `${name} must be a valid date`, 422);
	if (inclusiveDate && /^\d{4}-\d{2}-\d{2}$/.test(value))
		parsed.setUTCDate(parsed.getUTCDate() + 1);
	return parsed.toISOString();
}

function storeForPlatform(value: string): string {
	const normalized = value.trim().toLowerCase();
	if (normalized === "ios") return "apple";
	if (normalized === "android") return "google";
	if (["apple", "google", "stripe", "manual"].includes(normalized)) return normalized;
	throw httpError(
		"platform_invalid",
		"platform must be ios, android, apple, google, stripe or manual",
		422,
	);
}

export default app;
