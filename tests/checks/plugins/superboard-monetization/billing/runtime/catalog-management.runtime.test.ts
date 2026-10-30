import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { beforeAll, expect, test } from "vitest";

import { offeringsForCustomer } from "../../../../../../packages/plugins/superboard-core/api/src/lib/billing.js";
import worker from "../../../../../../packages/plugins/superboard-monetization/billing/src/index.js";
import { billingTestEnv as testEnv, createExecutionContext } from "./apply-migrations.js";

async function request(method: string, resource: string, body?: unknown) {
	const path = `/internal/v1/admin/billing/9-test${resource}`;
	const headers = await createProjectContextHeaders(
		{
			module: "billing",
			method,
			pathname: path,
			projectId: 91,
			projectRef: "9-test",
			instanceId: 9,
			environment: "test",
			actorId: 0,
			operatorId: "catalog-operator",
			role: "owner",
			requestId: crypto.randomUUID(),
			issuedAt: Math.floor(Date.now() / 1000),
		},
		"billing-runtime-internal-token",
	);
	headers.set("Content-Type", "application/json");
	return worker.fetch!(
		new Request(`https://billing.internal${path}`, {
			method,
			headers,
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		}) as Request<unknown, IncomingRequestCfProperties>,
		{ ...testEnv, CREDENTIAL_KEY_SCOPE: "billing" },
		createExecutionContext(),
	);
}

beforeAll(async () => {
	await testEnv.DB.batch([
		testEnv.DB.prepare(
			"INSERT INTO instances(id,api_key,uri_scheme) VALUES(9,'catalog-test','catalog-test')",
		),
		testEnv.DB.prepare(
			"INSERT INTO projects(id,instance_id,is_test,name,identifier) VALUES(91,9,1,'Catalog','catalog-test')",
		),
	]);
});

test("editing a multi-platform package changes the products returned to mobile clients", async () => {
	const ids: string[] = [];
	for (const store of ["apple", "google"]) {
		const response = await request("POST", "/products", {
			store,
			store_product_id: `pro.${store}`,
			product_type: "subscription",
			display_name: "Pro",
		});
		expect(response.status).toBe(201);
		ids.push((await response.json<{ id: string }>()).id);
	}
	const offering = await request("POST", "/offerings", {
		identifier: "main",
		display_name: "Main",
		is_current: true,
	});
	expect(offering.status).toBe(201);
	const offeringId = (await offering.json<{ id: string }>()).id;
	const pkg = await request("POST", `/offerings/${offeringId}/packages`, {
		identifier: "monthly",
		package_type: "monthly",
		product_ids: ids,
	});
	expect(pkg.status).toBe(201);
	const packageId = (await pkg.json<{ id: string }>()).id;
	for (const [platform, store] of [
		["ios", "apple"],
		["android", "google"],
	]) {
		expect(await offeringsForCustomer(testEnv.DB, "91", platform!, "sandbox")).toMatchObject({
			current: {
				identifier: "main",
				packages: [{ identifier: "monthly", product: { store_product_id: `pro.${store}` } }],
			},
		});
	}
	const changed = await request("PATCH", `/offerings/${offeringId}/packages/${packageId}`, {
		identifier: "annual",
		package_type: "annual",
		position: 1,
		product_ids: [ids[0]],
	});
	expect(changed.status).toBe(200);
	expect(await offeringsForCustomer(testEnv.DB, "91", "ios", "sandbox")).toMatchObject({
		current: { packages: [{ identifier: "annual" }] },
	});
	expect(await offeringsForCustomer(testEnv.DB, "91", "android", "sandbox")).toMatchObject({
		current: { packages: [] },
	});
	const removed = await request("DELETE", `/offerings/${offeringId}/packages/${packageId}`);
	expect(removed.status).toBe(200);
	expect(await offeringsForCustomer(testEnv.DB, "91", "ios", "sandbox")).toMatchObject({
		current: { packages: [] },
	});
	expect(
		await testEnv.DB.prepare(
			"SELECT COUNT(*) AS count FROM billing_products WHERE project_id='91'",
		).first(),
	).toEqual({ count: 2 });
});

test("a rejected offering creation preserves the current offering", async () => {
	const first = await request("POST", "/offerings", {
		identifier: "stable",
		display_name: "Stable",
		is_current: true,
	});
	expect(first.status).toBe(201);
	const duplicate = await request("POST", "/offerings", {
		identifier: "stable",
		display_name: "Duplicate",
		is_current: true,
	});
	expect(duplicate.status).toBe(422);
	expect(
		await testEnv.DB.prepare(
			"SELECT is_current FROM billing_offerings WHERE project_id='91' AND identifier='stable'",
		).first(),
	).toEqual({ is_current: 1 });
});

test("attaching and detaching an entitlement updates an existing verified purchaser", async () => {
	const { applyVerifiedPurchase, customerInfo } =
		await import("../../../../../../packages/plugins/superboard-core/api/src/lib/billing.js");
	const { resolveSdkCustomer } =
		await import("../../../../../../packages/plugins/superboard-core/api/src/lib/billing-identity.js");
	const customer = await resolveSdkCustomer(testEnv, {
		projectId: "91",
		anonymousId: "$superboard_anon_catalog",
	});
	const product = await request("POST", "/products", {
		store: "apple",
		store_product_id: "catalog.lifetime",
		product_type: "non_consumable",
		display_name: "Lifetime",
	});
	const productId = (await product.json<{ id: string }>()).id;
	await applyVerifiedPurchase(testEnv, {
		projectId: "91",
		customerId: String(customer.customer.id),
		store: "apple",
		environment: "sandbox",
		storeProductId: "catalog.lifetime",
		productType: "non_consumable",
		storeTransactionId: "catalog-lifetime-tx",
		originalTransactionId: "catalog-lifetime-tx",
		eventType: "PURCHASED",
		status: "active",
		purchasedAt: "2026-09-01T00:00:00Z",
		rawPayload: {},
	});
	const created = await request("POST", "/entitlements", {
		identifier: "catalog_pro",
		display_name: "Catalog Pro",
		product_ids: [productId],
	});
	expect(created.status).toBe(201);
	const id = (await created.json<{ id: string }>()).id;
	expect(await customerInfo(testEnv.DB, "91", String(customer.customer.id))).toMatchObject({
		entitlements: { catalog_pro: { is_active: true } },
	});
	const detached = await request("PATCH", `/entitlements/${id}`, { product_ids: [] });
	expect(detached.status).toBe(200);
	expect(await customerInfo(testEnv.DB, "91", String(customer.customer.id))).toMatchObject({
		entitlements: { catalog_pro: { is_active: false } },
	});
});

test("an expired promotional grant cannot hide an active purchase entitlement", async () => {
	const { customerInfo } =
		await import("../../../../../../packages/plugins/superboard-core/api/src/lib/billing.js");
	await testEnv.DB.batch([
		testEnv.DB.prepare(
			"INSERT INTO billing_customers(id,project_id,primary_app_user_id) VALUES('source-customer','91','source-user')",
		),
		testEnv.DB.prepare(
			"INSERT INTO billing_entitlements(id,project_id,identifier,display_name) VALUES('source-access','91','source_access','Access')",
		),
		testEnv.DB.prepare(
			"INSERT INTO billing_customer_entitlements(project_id,customer_id,entitlement_id,source,status,verification) VALUES('91','source-customer','source-access','purchase','active','verified'),('91','source-customer','source-access','promotional','revoked','admin')",
		),
	]);
	expect(await customerInfo(testEnv.DB, "91", "source-customer")).toMatchObject({
		entitlements: { source_access: { is_active: true } },
	});
	await request("PATCH", "/entitlements/source-access", { active: false });
	expect(await customerInfo(testEnv.DB, "91", "source-customer")).toMatchObject({
		entitlements: { source_access: { is_active: false } },
	});
});

test("customer context stores bounded SDK details without overwriting application attributes", async () => {
	const { resolveSdkCustomer } =
		await import("../../../../../../packages/plugins/superboard-core/api/src/lib/billing-identity.js");
	const { billingClientContextFromRequest } =
		await import("../../../../../../packages/plugins/superboard-core/api/src/lib/billing-client-context.js");
	const clientContext = billingClientContextFromRequest(
		new Request("https://sdk.example.test/purchases/v2/customer-info", {
			headers: {
				"CF-IPCountry": "CH",
				"X-SuperBoard-Language": "fr-CH",
				PLATFORM: "web",
				"X-SuperBoard-App-Version": "2.3.0",
				"X-SuperBoard-SDK-Version": "0.1.0",
			},
		}),
	);
	const params = { projectId: "91", anonymousId: "$superboard_anon_context", clientContext };
	const result = await resolveSdkCustomer(testEnv, params);
	await testEnv.DB.prepare(
		"UPDATE billing_customers SET attributes=json_set(attributes,'$.tier','gold') WHERE id=?",
	)
		.bind(result.customer.id)
		.run();
	await resolveSdkCustomer(testEnv, { ...params, clientContext: { app_version: "2.4.0" } });
	const stored = await testEnv.DB.prepare("SELECT attributes FROM billing_customers WHERE id=?")
		.bind(result.customer.id)
		.first<{ attributes: string }>();
	expect(JSON.parse(stored!.attributes)).toMatchObject({
		tier: "gold",
		sdk_context: {
			country: "CH",
			language: "fr-CH",
			platform: "web",
			app_version: "2.4.0",
			sdk_version: "0.1.0",
		},
	});
});

test("a plan change removes the old plan access while granting the replacement", async () => {
	const { applyVerifiedPurchase, customerInfo } =
		await import("../../../../../../packages/plugins/superboard-core/api/src/lib/billing.js");
	const { resolveSdkCustomer } =
		await import("../../../../../../packages/plugins/superboard-core/api/src/lib/billing-identity.js");
	const customer = await resolveSdkCustomer(testEnv, {
		projectId: "91",
		anonymousId: "$superboard_anon_plan_change",
	});
	for (const name of ["silver", "gold"]) {
		const product = await request("POST", "/products", {
			store: "apple",
			store_product_id: `plan.${name}`,
			product_type: "subscription",
			display_name: name,
		});
		const id = (await product.json<{ id: string }>()).id;
		await request("POST", "/entitlements", {
			identifier: `plan_${name}`,
			display_name: name,
			product_ids: [id],
		});
	}
	const purchase = {
		projectId: "91",
		customerId: String(customer.customer.id),
		store: "apple" as const,
		environment: "sandbox" as const,
		productType: "subscription" as const,
		originalTransactionId: "plan-change-chain",
		eventType: "PURCHASED",
		status: "active" as const,
		purchasedAt: "2026-09-01T00:00:00Z",
		expiresAt: "2099-01-01T00:00:00Z",
		rawPayload: {},
	};
	await applyVerifiedPurchase(testEnv, {
		...purchase,
		storeProductId: "plan.silver",
		storeTransactionId: "plan-silver",
		eventOccurredAt: "2026-09-01T00:00:00Z",
	});
	await applyVerifiedPurchase(testEnv, {
		...purchase,
		storeProductId: "plan.gold",
		storeTransactionId: "plan-gold",
		eventOccurredAt: "2026-09-02T00:00:00Z",
	});
	expect(await customerInfo(testEnv.DB, "91", String(customer.customer.id))).toMatchObject({
		entitlements: { plan_silver: { is_active: false }, plan_gold: { is_active: true } },
	});
});

test("a consumable explicitly attached to an entitlement grants access until its purchase is refunded", async () => {
	const { applyVerifiedPurchase, customerInfo } =
		await import("../../../../../../packages/plugins/superboard-core/api/src/lib/billing.js");
	const { resolveSdkCustomer } =
		await import("../../../../../../packages/plugins/superboard-core/api/src/lib/billing-identity.js");
	const customer = await resolveSdkCustomer(testEnv, {
		projectId: "91",
		anonymousId: "$superboard_anon_consumable_access",
	});
	const product = await request("POST", "/products", {
		store: "apple",
		store_product_id: "consumable.unlock",
		product_type: "consumable",
		display_name: "Unlock",
	});
	const id = (await product.json<{ id: string }>()).id;
	await request("POST", "/entitlements", {
		identifier: "consumable_access",
		display_name: "Access",
		product_ids: [id],
	});
	const purchase = {
		projectId: "91",
		customerId: String(customer.customer.id),
		store: "apple" as const,
		environment: "sandbox" as const,
		productType: "consumable" as const,
		storeProductId: "consumable.unlock",
		originalTransactionId: "consumable-chain",
		storeTransactionId: "consumable-purchase",
		eventType: "PURCHASED",
		status: "active" as const,
		purchasedAt: "2026-09-01T00:00:00Z",
		eventOccurredAt: "2026-09-01T00:00:00Z",
		rawPayload: {},
	};
	await applyVerifiedPurchase(testEnv, purchase);
	expect(await customerInfo(testEnv.DB, "91", String(customer.customer.id))).toMatchObject({
		entitlements: { consumable_access: { is_active: true, expires_at: null } },
	});
	await applyVerifiedPurchase(testEnv, {
		...purchase,
		eventType: "REFUNDED",
		status: "refunded",
		eventOccurredAt: "2026-09-02T00:00:00Z",
	});
	expect(await customerInfo(testEnv.DB, "91", String(customer.customer.id))).toMatchObject({
		entitlements: { consumable_access: { is_active: false } },
	});
});
