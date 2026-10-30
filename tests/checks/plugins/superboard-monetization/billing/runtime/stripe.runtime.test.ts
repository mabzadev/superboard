import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

import { customerInfo } from "../../../../../../packages/plugins/superboard-core/api/src/lib/billing.js";
import {
	configureStripe,
	createStripeCheckout,
	processStripeWebhook,
	verifyStripeSignature,
} from "../../../../../../packages/plugins/superboard-core/api/src/lib/stripe-billing.js";
import { billingTestEnv as testEnv } from "./apply-migrations.js";
const secret = "whsec_runtime_fixture";
async function sign(payload: string, time = Math.floor(Date.now() / 1000)) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signed = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(`${time}.${payload}`),
	);
	return `t=${time},v1=${Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
beforeAll(async () => {
	await testEnv.DB.batch([
		testEnv.DB.prepare(
			"INSERT INTO instances(id,api_key,uri_scheme) VALUES(7,'stripe-fixture','stripe-fixture')",
		),
		testEnv.DB.prepare(
			"INSERT INTO projects(id,instance_id,is_test,name,identifier) VALUES(71,7,1,'Stripe','stripe-fixture')",
		),
		testEnv.DB.prepare(
			"INSERT INTO billing_customers(id,project_id,primary_app_user_id) VALUES('stripe-customer','71','web-user')",
		),
		testEnv.DB.prepare(
			"INSERT INTO billing_products(id,project_id,store,environment,store_product_id,product_type,display_name) VALUES('stripe-product','71','stripe','sandbox','price_fixture','subscription','Web premium')",
		),
		testEnv.DB.prepare(
			"INSERT INTO billing_entitlements(id,project_id,identifier,display_name) VALUES('stripe-access','71','premium','Premium')",
		),
		testEnv.DB.prepare(
			"INSERT INTO billing_product_entitlements(product_id,entitlement_id) VALUES('stripe-product','stripe-access')",
		),
	]);
	await configureStripe(testEnv, "71", "sandbox", {
		secret_key: "sk_test_fixture",
		webhook_secret: secret,
		application_origin: "https://app.example.test",
	});
});
const replies: Array<{ path: string; method: string; body: unknown }> = [];
function mockStripe(path: string, body: unknown, count = 1, method = "GET") {
	for (let i = 0; i < count; i++) replies.push({ path, body, method });
}
beforeEach(() => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string, init?: RequestInit) => {
			const next = replies.shift();
			expect(next).toBeDefined();
			expect(input).toBe(`https://api.stripe.com${next?.path}`);
			expect(init?.method || "GET").toBe(next?.method);
			return Response.json(next?.body);
		}),
	);
});
afterEach(() => {
	vi.unstubAllGlobals();
	expect(replies).toHaveLength(0);
});

test("rejects altered and stale Stripe webhook bodies", async () => {
	const payload = '{"id":"evt_fixture"}';
	await expect(
		verifyStripeSignature(payload, await sign(payload), secret),
	).resolves.toBeUndefined();
	await expect(
		verifyStripeSignature(payload + " ", await sign(payload), secret),
	).rejects.toMatchObject({ code: "stripe_signature_invalid" });
	await expect(
		verifyStripeSignature(payload, await sign(payload, 1), secret),
	).rejects.toMatchObject({ code: "stripe_signature_invalid" });
});

test("checkout persists before Stripe, retries idempotently, and rejects foreign return origins", async () => {
	const input = {
		product_id: "stripe-product",
		success_url: "https://app.example.test/success",
		cancel_url: "https://app.example.test/cancel",
	};
	await expect(
		createStripeCheckout(
			testEnv,
			"71",
			"stripe-customer",
			"sandbox",
			{ ...input, success_url: "https://attacker.example/success" },
			"checkout-test",
		),
	).rejects.toMatchObject({ code: "stripe_return_url_invalid" });
	mockStripe(
		"/v1/checkout/sessions",
		{
			id: "cs_fixture",
			url: "https://checkout.stripe.com/c/pay/cs_fixture",
			customer: "cus_fixture",
			expires_at: 2_000_000_000,
		},
		1,
		"POST",
	);
	const first = await createStripeCheckout(
		testEnv,
		"71",
		"stripe-customer",
		"sandbox",
		input,
		"checkout-test",
	);
	expect(
		await createStripeCheckout(testEnv, "71", "stripe-customer", "sandbox", input, "checkout-test"),
	).toEqual(first);
	await expect(
		createStripeCheckout(
			testEnv,
			"71",
			"stripe-customer",
			"sandbox",
			{ ...input, cancel_url: "https://app.example.test/other" },
			"checkout-test",
		),
	).rejects.toMatchObject({ code: "checkout_idempotency_conflict" });
	expect(
		await testEnv.DB.prepare(
			"SELECT COUNT(*) AS count FROM billing_checkout_sessions WHERE project_id='71'",
		).first(),
	).toEqual({ count: 1 });
});

test("verified Stripe subscription changes grant and revoke the same mobile entitlement without duplicate transactions", async () => {
	const event = {
		id: "evt_active",
		type: "customer.subscription.updated",
		livemode: false,
		created: Math.floor(Date.now() / 1000),
		data: { object: { id: "sub_fixture" } },
	};
	const subscription = {
		id: "sub_fixture",
		livemode: false,
		status: "active",
		current_period_start: 1_700_000_000,
		current_period_end: 4_000_000_000,
		cancel_at_period_end: false,
		metadata: {
			superboard_project_id: "71",
			superboard_customer_id: "stripe-customer",
			superboard_product_id: "stripe-product",
		},
		items: { data: [{ price: { id: "price_fixture" } }] },
	};
	mockStripe("/v1/subscriptions/sub_fixture", subscription, 2);
	const payload = JSON.stringify(event),
		signature = await sign(payload);
	await processStripeWebhook(testEnv, "71", "sandbox", payload, signature);
	await processStripeWebhook(testEnv, "71", "sandbox", payload, signature);
	expect(await customerInfo(testEnv.DB, "71", "stripe-customer")).toMatchObject({
		entitlements: { premium: { is_active: true } },
	});
	expect(
		await testEnv.DB.prepare(
			"SELECT COUNT(*) AS count FROM billing_transactions WHERE project_id='71'",
		).first(),
	).toEqual({ count: 1 });
	mockStripe("/v1/subscriptions/sub_fixture", { ...subscription, status: "canceled" });
	const cancelled = JSON.stringify({ ...event, id: "evt_expired", created: event.created + 1 });
	await processStripeWebhook(testEnv, "71", "sandbox", cancelled, await sign(cancelled));
	expect(await customerInfo(testEnv.DB, "71", "stripe-customer")).toMatchObject({
		entitlements: { premium: { is_active: false } },
	});
});

test("the Stripe expansion migration can be retried without losing existing purchases", async () => {
	const migration = testEnv.TEST_MIGRATIONS.find(
		(item) => item.name === "0070_stripe_web_purchases.sql",
	);
	expect(migration).toBeDefined();
	const before = await testEnv.DB.prepare(
		"SELECT id,status FROM billing_transactions WHERE project_id='71' ORDER BY id",
	).all();
	for (let attempt = 0; attempt < 2; attempt++)
		await testEnv.DB.batch(migration!.queries.map((query) => testEnv.DB.prepare(query)));
	expect(
		await testEnv.DB.prepare(
			"SELECT id,status FROM billing_transactions WHERE project_id='71' ORDER BY id",
		).all(),
	).toMatchObject({ results: before.results });
});

test("a refunded current Stripe invoice revokes access even while the subscription remains active", async () => {
	mockStripe("/v1/invoices/in_refunded", { id: "in_refunded", subscription: "sub_fixture" });
	mockStripe("/v1/subscriptions/sub_fixture", {
		id: "sub_fixture",
		livemode: false,
		status: "active",
		current_period_start: 1_700_000_000,
		current_period_end: 4_000_000_000,
		latest_invoice: "in_refunded",
		metadata: {
			superboard_project_id: "71",
			superboard_customer_id: "stripe-customer",
			superboard_product_id: "stripe-product",
		},
		items: { data: [{ price: { id: "price_fixture" } }] },
	});
	mockStripe("/v1/invoices/in_refunded?expand[]=charge", { charge: { refunded: true } });
	const payload = JSON.stringify({
		id: "evt_refunded",
		type: "charge.refunded",
		livemode: false,
		created: Math.floor(Date.now() / 1000) + 2,
		data: {
			object: {
				id: "ch_refunded",
				invoice: "in_refunded",
				payment_intent: "pi_refunded",
				refunded: true,
			},
		},
	});
	await processStripeWebhook(testEnv, "71", "sandbox", payload, await sign(payload));
	expect(await customerInfo(testEnv.DB, "71", "stripe-customer")).toMatchObject({
		entitlements: { premium: { is_active: false } },
	});
});
