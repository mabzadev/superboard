import {
	createProjectContextHeaders,
	PROJECT_CONTEXT_HEADERS,
	signProjectContext,
} from "@superboard/contracts/project-context";
import { signSiteOperatorRequest } from "@superboard/contracts/site-operator";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";

import api from "../../../../../packages/plugins/supbrd-core/api/src/index.js";
import type { Env as ApiEnv } from "../../../../../packages/plugins/supbrd-core/api/src/types.js";
import billing from "../../../../../packages/plugins/supbrd-plug-commerce/billing/src/index.js";
import products from "../../../../../packages/plugins/supbrd-plug-commerce/products/src/index.js";

const stores = env as typeof env & { HEALTH_API_DB: D1Database; HEALTH_PRODUCTS_DB: D1Database };
const db = stores.HEALTH_API_DB;
const secret = "billing-ledger-runtime-secret";
const billingEnv = {
	DB: db,
	INTERNAL_API_TOKEN: secret,
	ENVIRONMENT: "development",
	CREDENTIAL_KEY_SCOPE: "billing",
} as Parameters<typeof billing.fetch>[1];
async function request(
	method: string,
	path: string,
	body?: unknown,
	projectId = 81,
	key = crypto.randomUUID(),
) {
	const context = {
		module: "billing" as const,
		method,
		pathname: path,
		projectId,
		projectRef: projectId === 81 ? "42-prod" : "43-prod",
		instanceId: projectId === 81 ? 42 : 43,
		environment: "production" as const,
		actorId: 0,
		operatorId: "billing-only-operator",
		role: "owner",
		requestId: crypto.randomUUID(),
		issuedAt: Math.floor(Date.now() / 1000),
	};
	const headers = new Headers({
		"Content-Type": "application/json",
		"Idempotency-Key": key,
		[PROJECT_CONTEXT_HEADERS.token]: secret,
		[PROJECT_CONTEXT_HEADERS.projectId]: String(projectId),
		[PROJECT_CONTEXT_HEADERS.projectRef]: context.projectRef,
		[PROJECT_CONTEXT_HEADERS.instanceId]: String(context.instanceId),
		[PROJECT_CONTEXT_HEADERS.environment]: "production",
		[PROJECT_CONTEXT_HEADERS.actorId]: "0",
		[PROJECT_CONTEXT_HEADERS.operatorId]: context.operatorId,
		[PROJECT_CONTEXT_HEADERS.role]: "owner",
		[PROJECT_CONTEXT_HEADERS.requestId]: context.requestId,
		[PROJECT_CONTEXT_HEADERS.issuedAt]: String(context.issuedAt),
		[PROJECT_CONTEXT_HEADERS.version]: "1",
		[PROJECT_CONTEXT_HEADERS.signature]: await signProjectContext(context, secret),
	});
	const init: RequestInit = { method, headers };
	if (body !== undefined) init.body = JSON.stringify(body);
	return billing.fetch(new Request(`https://billing.internal${path}`, init), billingEnv);
}

test("Billing owns purchase/refund/subscription operations when Products has no binding", async () => {
	await db.batch([
		db.prepare(
			"INSERT INTO instances (id,uri_scheme,api_key) VALUES (42,'billing-alone','billing-test-key'),(43,'other-billing','other-billing-key')",
		),
		db.prepare(
			"INSERT INTO projects (id,instance_id,is_test,name,identifier) VALUES (81,42,0,'Billing','billing-prod'),(83,43,0,'Other','other-billing-prod')",
		),
		db.prepare(
			"INSERT INTO billing_products (id,project_id,store,store_product_id,product_type,display_name) VALUES ('native-product','81','apple','app.pro.monthly','subscription','Pro monthly')",
		),
	]);
	const catalog = await request("GET", "/internal/v1/catalog-ledger/products");
	expect(catalog.status).toBe(200);
	expect(await catalog.json()).toMatchObject({
		data: expect.arrayContaining([
			expect.objectContaining({ id: "native-product", display_name: "Pro monthly" }),
		]),
	});
	const entitlement = await request("POST", "/internal/v1/catalog-ledger/entitlements", {
		identifier: "pro",
		display_name: "Pro",
		active: true,
		product_ids: ["native-product"],
	});
	expect(entitlement.status, await entitlement.clone().text()).toBe(201);
	expect(await (await request("GET", "/internal/v1/catalog-ledger/entitlements")).text()).toContain(
		'"identifier":"pro"',
	);
	const input = {
		financial_customer_id: "customer-a",
		product_id: "native-product",
		store: "apple",
		environment: "production",
		external_transaction_id: "transaction-1",
		purchased_price_micros: 9_990_000,
		currency: "EUR",
		expires_at: "2099-01-01T00:00:00Z",
	};
	const result = await request(
		"POST",
		"/internal/v1/catalog-ledger/purchases",
		input,
		81,
		"billing-only-create",
	);
	expect(result.status).toBe(201);
	const created = (await result.json()) as { data: { id: string } };
	const replay = await request(
		"POST",
		"/internal/v1/catalog-ledger/purchases",
		input,
		81,
		"billing-only-create",
	);
	expect(await replay.json()).toEqual(created);
	expect(
		await (await request("GET", "/internal/v1/catalog-ledger/purchases")).json(),
	).toMatchObject({ data: [{ id: created.data.id, product_name: "Pro monthly" }] });
	const subscriptions = (await (
		await request("GET", "/internal/v1/catalog-ledger/subscriptions")
	).json()) as { data: Array<{ id: string; status: string }> };
	expect(subscriptions.data).toHaveLength(1);
	expect(
		(
			await request(
				"PUT",
				`/internal/v1/catalog-ledger/subscriptions/${subscriptions.data[0]!.id}`,
				{ status: "cancelled", auto_renew: false },
			)
		).status,
	).toBe(200);
	const refund = await request(
		"POST",
		`/internal/v1/catalog-ledger/purchases/${created.data.id}/refunds`,
		{ status: "completed", reason: "Customer request" },
	);
	expect(refund.status).toBe(201);
	expect(
		await (await request("GET", `/internal/v1/catalog-ledger/purchases/${created.data.id}`)).json(),
	).toMatchObject({ data: { status: "refunded" } });
	expect(
		(
			await request(
				"GET",
				`/internal/v1/catalog-ledger/purchases/${created.data.id}`,
				undefined,
				83,
			)
		).status,
	).toBe(404);
	expect(
		await db
			.prepare("SELECT actor_id FROM billing_catalog_audit_events WHERE action='purchase.recorded'")
			.first(),
	).toEqual({ actor_id: "billing-only-operator" });
	const statistics = await request("GET", "/internal/v1/catalog-ledger/statistics");
	expect(statistics.status, await statistics.clone().text()).toBe(200);
	expect(await statistics.json()).toMatchObject({
		data: { totals: { purchases: 1, refunded_micros: 9_990_000 } },
	});
});

test("Billing reconciliation only updates the selected project", async () => {
	await db
		.prepare(
			"INSERT INTO billing_subscriptions (id,project_id,store,environment,original_transaction_id,status,expires_at) VALUES ('expired-own','81','apple','production','own-tx','active','2000-01-01'),('expired-other','83','apple','production','other-tx','active','2000-01-01')",
		)
		.run();
	const response = await request(
		"POST",
		"/internal/v1/catalog-ledger/reconcile",
		{},
		81,
		"reconcile-own-project",
	);
	expect(response.status).toBe(200);
	expect(
		await db
			.prepare(
				"SELECT id,status FROM billing_subscriptions WHERE id IN ('expired-own','expired-other') ORDER BY id",
			)
			.all(),
	).toMatchObject({
		results: [
			{ id: "expired-other", status: "active" },
			{ id: "expired-own", status: "expired" },
		],
	});
	const ledger = await request("GET", "/internal/v1/catalog-ledger");
	expect(await ledger.json()).toMatchObject({
		data: {
			operations: expect.arrayContaining([
				expect.objectContaining({
					action: "billing.reconciled",
					actor_id: "billing-only-operator",
				}),
			]),
			balance_entries: [],
		},
	});
});

const productsEnv = { DB: stores.HEALTH_PRODUCTS_DB, INTERNAL_API_TOKEN: secret } as Parameters<
	typeof products.fetch
>[1];
async function sourceRequest(method: string, path: string, body?: unknown, projectId = 81) {
	const headers = await createProjectContextHeaders(
		{
			module: "products",
			method,
			pathname: path,
			projectId,
			projectRef: projectId === 81 ? "42-prod" : "43-prod",
			instanceId: projectId === 81 ? 42 : 43,
			environment: "production",
			actorId: 0,
			operatorId: "billing-only-operator",
			role: "owner",
			requestId: crypto.randomUUID(),
			issuedAt: Math.floor(Date.now() / 1000),
		},
		secret,
	);
	headers.set("Content-Type", "application/json");
	headers.set("Idempotency-Key", crypto.randomUUID());
	return products.fetch(
		new Request(`https://products.internal${path}`, {
			method,
			headers,
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		}),
		productsEnv,
	);
}

test("Billing resumes a real paginated Products transfer after an unavailable source and preserves historical purchases", async () => {
	const source = stores.HEALTH_PRODUCTS_DB;
	await source.batch(
		Array.from({ length: 23 }, (_, index) =>
			source
				.prepare(
					"INSERT INTO products(id,project_id,identifier,display_name,product_type) VALUES (?, '81', ?, ?, 'non_consumable')",
				)
				.bind(
					`legacy-product-${String(index).padStart(2, "0")}`,
					`legacy-${index}`,
					`Legacy product ${index}`,
				),
		),
	);
	await source.batch([
		source.prepare(
			"INSERT INTO financial_customers(id,project_id,external_customer_id) VALUES ('legacy-customer','81','historic-customer')",
		),
		source.prepare(
			"INSERT INTO purchases(id,project_id,financial_customer_id,product_id,status,purchased_at,store,environment,external_transaction_id,purchased_price_micros,currency) VALUES ('historic-purchase','81','legacy-customer','legacy-product-00','active','2024-01-01','manual','production','historic-transaction',4990000,'EUR')",
		),
	]);
	let sourceUnavailable = true;
	const gatewayEnv = {
		DB: db,
		SUPERBOARD_TARGET: "billing-alone",
		SITE_OPERATOR_BRIDGE_TOKEN: "billing-migration-bridge",
		MODULE_INTERNAL_TOKEN: secret,
		BILLING: { fetch: (forwarded: Request) => billing.fetch(forwarded, billingEnv) },
		PRODUCTS_MODULE: {
			fetch: (forwarded: Request) => {
				if (sourceUnavailable) throw new Error("source connection lost");
				return products.fetch(forwarded, productsEnv);
			},
		},
	} as unknown as ApiEnv;
	const migrate = async () => {
		const input = new Request(
			"https://api.internal/api/v1/billing/projects/42-prod/ledger/migrate-products",
			{ method: "POST" },
		);
		const headers = await signSiteOperatorRequest(
			input,
			{ instance_id: "billing-alone", operator_id: "billing-only-operator", role: 50 },
			"billing-migration-bridge",
		);
		return api.fetch(new Request(input, { headers }), gatewayEnv);
	};
	expect((await migrate()).status).toBe(503);
	sourceUnavailable = false;
	const first = await migrate();
	expect(first.status, await first.clone().text()).toBe(200);
	expect(await first.json()).toMatchObject({ data: { complete: false } });
	expect((await sourceRequest("POST", "/internal/v1/purchases", {})).status).toBe(503);
	expect((await sourceRequest("GET", "/internal/v1/purchases")).status).toBe(200);
	sourceUnavailable = true;
	expect((await migrate()).status).toBe(503);
	sourceUnavailable = false;
	let complete = false;
	for (let attempt = 0; attempt < 5 && !complete; attempt++) {
		const response = await migrate();
		expect(response.status, await response.clone().text()).toBe(200);
		complete = (await response.json()).data.complete;
	}
	expect(complete).toBe(true);
	expect(await (await migrate()).json()).toMatchObject({ data: { complete: true } });
	const purchase = await request("GET", "/internal/v1/catalog-ledger/purchases/historic-purchase");
	expect(purchase.status, await purchase.clone().text()).toBe(200);
	expect(await purchase.json()).toMatchObject({
		data: { id: "historic-purchase", purchased_at: "2024-01-01", purchased_price_micros: 4990000 },
	});
	expect(
		await (await request("GET", "/internal/v1/catalog-ledger/purchases")).json(),
	).toMatchObject({
		data: expect.arrayContaining([
			expect.objectContaining({ id: "historic-purchase", product_name: "Legacy product 0" }),
		]),
	});
	expect(
		await source
			.prepare("SELECT status FROM products_billing_ledger_authority WHERE project_id='81'")
			.first(),
	).toEqual({ status: "active" });
	expect(
		await db
			.prepare(
				"SELECT COUNT(*) AS count FROM billing_catalog_products WHERE id LIKE 'legacy-product-%'",
			)
			.first(),
	).toEqual({ count: 23 });
	expect(
		(await request("GET", "/internal/v1/catalog-ledger/purchases/historic-purchase", undefined, 83))
			.status,
	).toBe(404);
});

test("Billing rejects conflicting legacy records without replacing the current catalog or advancing the import", async () => {
	await stores.HEALTH_PRODUCTS_DB.prepare(
		"INSERT INTO products(id,project_id,identifier,display_name,product_type) VALUES ('conflict-product','83','conflict','Legacy value','non_consumable')",
	).run();
	await db
		.prepare(
			"INSERT INTO billing_catalog_products(id,project_id,identifier,display_name,product_type) VALUES ('conflict-product','83','conflict','Billing value','non_consumable')",
		)
		.run();
	const exported = await sourceRequest(
		"POST",
		"/internal/v1/billing-ledger/export",
		{ table: "products", cursor: [] },
		83,
	);
	expect(exported.status).toBe(200);
	const response = await request(
		"POST",
		"/internal/v1/catalog-ledger/migration/import",
		(await exported.json()).data,
		83,
	);
	expect(response.status, await response.clone().text()).toBe(409);
	expect(await response.json()).toMatchObject({ error: { code: "catalog_import_conflict" } });
	expect(
		await (
			await request("GET", "/internal/v1/catalog-ledger/migration/status", undefined, 83)
		).json(),
	).toMatchObject({ data: { table: "products", cursor: [], complete: false } });
	expect(
		await db
			.prepare("SELECT display_name FROM billing_catalog_products WHERE id='conflict-product'")
			.first(),
	).toEqual({ display_name: "Billing value" });
});

test("Billing refuses an oversized migration status before exporting Products data", async () => {
	await db.batch([
		db.prepare(
			"INSERT INTO instances(id,uri_scheme,api_key) VALUES(42,'billing-alone','billing-test-key') ON CONFLICT(id) DO NOTHING",
		),
		db.prepare(
			"INSERT INTO projects(id,instance_id,is_test,name,identifier) VALUES(81,42,0,'Billing','billing-prod') ON CONFLICT(id) DO NOTHING",
		),
	]);
	let sourceCalled = false;
	const gatewayEnv = {
		DB: db,
		SUPERBOARD_TARGET: "billing-alone",
		SITE_OPERATOR_BRIDGE_TOKEN: "billing-migration-bridge",
		MODULE_INTERNAL_TOKEN: secret,
		BILLING: {
			fetch: async () =>
				Response.json({
					data: { complete: false, table: "products", cursor: [], padding: "x".repeat(32768) },
				}),
		},
		PRODUCTS_MODULE: {
			fetch: async () => {
				sourceCalled = true;
				return Response.json({ error: { code: "unexpected_export" } }, { status: 599 });
			},
		},
	} as unknown as ApiEnv;
	const input = new Request(
		"https://api.internal/api/v1/billing/projects/42-prod/ledger/migrate-products",
		{ method: "POST" },
	);
	const headers = await signSiteOperatorRequest(
		input,
		{ instance_id: "billing-alone", operator_id: "billing-only-operator", role: 50 },
		"billing-migration-bridge",
	);
	const response = await api.fetch(new Request(input, { headers }), gatewayEnv);
	expect(response.status).toBe(503);
	expect(await response.json()).toMatchObject({ error: { code: "module_response_invalid" } });
	expect(sourceCalled).toBe(false);
});
