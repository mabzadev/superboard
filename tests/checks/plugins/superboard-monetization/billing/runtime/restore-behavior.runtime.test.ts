import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
	processGoogleBillingNotification,
	reconcileStoreSubscription,
} from "../../../../../../packages/plugins/superboard-core/api/src/lib/billing-jobs.js";
import { encryptCredential } from "../../../../../../packages/plugins/superboard-core/api/src/lib/secrets.js";
import worker from "../../../../../../packages/plugins/superboard-monetization/billing/src/index.js";
import { billingTestEnv as testEnv, createExecutionContext } from "./apply-migrations.js";

const projectId = "421";
const projectRef = "42-test";
const weekly = "restore.weekly";
const lifetime = "restore.lifetime";
const googlePurchases = new Map<string, Record<string, unknown>>();
const billingEnv = { ...testEnv, CREDENTIAL_KEY_SCOPE: "billing" };

type TransferEvent = { customer_id: string; event_type: string; payload: string };

async function send(path: string, body: unknown) {
	return worker.fetch!(
		new Request(`https://billing.internal${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}) as Request<unknown, IncomingRequestCfProperties>,
		billingEnv,
		createExecutionContext(),
	);
}

async function admin(method: string, path: string, body?: unknown) {
	const headers = await createProjectContextHeaders(
		{
			module: "billing",
			method,
			pathname: path,
			projectId: Number(projectId),
			projectRef,
			instanceId: 42,
			environment: "test",
			actorId: 0,
			operatorId: "restore-operator",
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
		billingEnv,
		createExecutionContext(),
	);
}

async function setRestoreBehavior(value: string) {
	const response = await admin("PUT", `/internal/v1/admin/billing/${projectRef}/settings`, {
		purchases_enabled: true,
		restore_behavior: value,
	});
	expect(response.status).toBe(200);
	return (await response.json<{ restore_behavior: string }>()).restore_behavior;
}

async function storeLegacySetting(value: string) {
	await testEnv.DB.prepare(
		`INSERT INTO billing_project_settings (project_id, restore_behavior, purchases_enabled)
		 VALUES (?, ?, 1)
		 ON CONFLICT(project_id) DO UPDATE SET restore_behavior = excluded.restore_behavior`,
	)
		.bind(projectId, value)
		.run();
}

async function customer(id: string, anonymous = false) {
	const appUserId = anonymous ? `$superboard_anon_${id}` : `user-${id}`;
	await testEnv.DB.batch([
		testEnv.DB.prepare(
			"INSERT INTO billing_customers (id, project_id, primary_app_user_id, anonymous) VALUES (?, ?, ?, ?)",
		).bind(id, projectId, appUserId, anonymous ? 1 : 0),
		testEnv.DB.prepare(
			"INSERT INTO billing_customer_aliases (project_id, customer_id, app_user_id, alias_type) VALUES (?, ?, ?, ?)",
		).bind(projectId, id, appUserId, anonymous ? "anonymous" : "identified"),
	]);
	return appUserId;
}

function subscriptionReceipt(token: string, owner: string | null, active = true) {
	googlePurchases.set(token, {
		subscriptionState: active ? "SUBSCRIPTION_STATE_ACTIVE" : "SUBSCRIPTION_STATE_EXPIRED",
		testPurchase: {},
		latestOrderId: `GPA.${token}`,
		startTime: "2026-10-01T00:00:00.000Z",
		acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
		...(owner ? { externalAccountIdentifiers: { obfuscatedExternalAccountId: owner } } : {}),
		lineItems: [
			{
				productId: weekly,
				expiryTime: active ? "2030-01-01T00:00:00.000Z" : "2026-10-08T00:00:00.000Z",
				autoRenewingPlan: { autoRenewEnabled: active },
			},
		],
	});
}

function lifetimeReceipt(token: string, owner: string | null) {
	googlePurchases.set(token, {
		purchaseState: 0,
		purchaseType: 0,
		orderId: `GPA.${token}`,
		purchaseTimeMillis: "1790000000000",
		acknowledgementState: 1,
		...(owner ? { obfuscatedExternalAccountId: owner } : {}),
	});
}

const buy = (customerId: string, token: string, productId = weekly) =>
	send("/internal/v1/receipts/verify", {
		project_id: projectId,
		customer_id: customerId,
		store: "google",
		environment: "sandbox",
		purchase_token: token,
		product_id: productId,
	});

const restore = (customerId: string, token: string, productId = weekly) =>
	send("/internal/v1/receipts/restore", {
		project_id: projectId,
		customer_id: customerId,
		environment: "sandbox",
		google_purchases: [{ purchase_token: token, product_id: productId }],
	});

async function chainOwners(token: string) {
	const rows = await testEnv.DB.prepare(
		`SELECT customer_id FROM billing_subscriptions WHERE project_id = ? AND original_transaction_id = ?
		 UNION SELECT customer_id FROM billing_transactions WHERE project_id = ? AND original_transaction_id = ?`,
	)
		.bind(projectId, token, projectId, token)
		.all<{ customer_id: string | null }>();
	return rows.results.map((row) => row.customer_id).sort();
}

async function premiumActive(customerId: string) {
	const row = await testEnv.DB.prepare(
		`SELECT status, expires_at FROM billing_customer_entitlements
		 WHERE customer_id = ? AND entitlement_id = 'restore-premium' AND source = 'purchase'`,
	)
		.bind(customerId)
		.first<{ status: string; expires_at: string | null }>();
	return Boolean(
		row &&
		["active", "trialing"].includes(row.status) &&
		(!row.expires_at || Date.parse(row.expires_at) > Date.now()),
	);
}

async function transferEvents(...customerIds: string[]) {
	const rows = await testEnv.DB.prepare(
		`SELECT customer_id, event_type, payload FROM billing_events
		 WHERE project_id = ? AND event_type = 'transferred' ORDER BY customer_id`,
	)
		.bind(projectId)
		.all<TransferEvent>();
	return rows.results.filter((row) => customerIds.includes(row.customer_id));
}

async function expectReceiptInUse(response: Response) {
	expect(response.status).toBe(409);
	expect(await response.json()).toMatchObject({ code: "receipt_already_in_use", retryable: false });
}

describe("RevenueCat restore behavior in the Billing runtime", () => {
	beforeAll(async () => {
		const { privateKey } = await generateKeyPair("RS256", { extractable: true });
		const serviceAccount = JSON.stringify({
			client_email: "billing@restore.test",
			private_key: await exportPKCS8(privateKey),
			token_uri: "https://oauth2.restore.test/token",
		});
		const credential = await encryptCredential(billingEnv, serviceAccount);
		await testEnv.DB.batch([
			testEnv.DB.prepare(
				"INSERT INTO instances (id, api_key, uri_scheme) VALUES (42, 'restore-instance', 'restore-app')",
			),
			testEnv.DB.prepare(
				"INSERT INTO projects (id, name, identifier, instance_id, is_test) VALUES (421, 'Restore', 'restore-project', 42, 1)",
			),
			testEnv.DB.prepare(
				"INSERT INTO applications (id, platform, instance_id) VALUES (4201, 'android', 42)",
			),
			testEnv.DB.prepare(
				"INSERT INTO android_configurations (application_id, identifier) VALUES (4201, 'com.superboard.restore')",
			),
			testEnv.DB.prepare(
				"INSERT INTO android_server_api_keys (instance_id, encrypted_key, billing_encrypted_key) VALUES ('42', ?, ?)",
			).bind(credential, credential),
			testEnv.DB.prepare(
				`INSERT INTO billing_products (id, project_id, store, environment, store_product_id, product_type)
				 VALUES ('restore-weekly', ?, 'google', 'sandbox', ?, 'subscription'),
				        ('restore-lifetime', ?, 'google', 'sandbox', ?, 'non_consumable')`,
			).bind(projectId, weekly, projectId, lifetime),
			testEnv.DB.prepare(
				"INSERT INTO billing_entitlements (id, project_id, identifier, display_name) VALUES ('restore-premium', ?, 'premium', 'Premium')",
			).bind(projectId),
			testEnv.DB.prepare(
				`INSERT INTO billing_product_entitlements (product_id, entitlement_id)
				 VALUES ('restore-weekly', 'restore-premium'), ('restore-lifetime', 'restore-premium')`,
			),
			testEnv.DB.prepare(
				`INSERT INTO billing_webhook_endpoints (
				  id, project_id, name, url, signing_secret_encrypted, environments, event_types, active
				) VALUES (
				  'restore-transfer-endpoint', ?, 'Transfers', 'https://hooks.restore.test/transfer',
				  'env:SUPERBOARD_ENTITLEMENT_WEBHOOK_SECRET', '["sandbox"]', '["TRANSFER"]', 1
				)`,
			).bind(projectId),
		]);
	});

	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = input instanceof Request ? input.url : String(input);
				if (url === "https://oauth2.restore.test/token")
					return Response.json({ access_token: "restore-access", expires_in: 3600 });
				const token = decodeURIComponent(url.split("/tokens/")[1] ?? "");
				const purchase = googlePurchases.get(token);
				return purchase ? Response.json(purchase) : Response.json({}, { status: 404 });
			}),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("transfers a restored subscription to the new App User ID by default and records the transfer", async () => {
		const ownerAppUserId = await customer("default-owner");
		const restorerAppUserId = await customer("default-restorer");
		subscriptionReceipt("default-token", "default-owner");
		expect((await buy("default-owner", "default-token")).status).toBe(200);
		expect(await premiumActive("default-owner")).toBe(true);

		const restored = await restore("default-restorer", "default-token");

		expect(restored.status).toBe(200);
		expect(await chainOwners("default-token")).toEqual(["default-restorer"]);
		expect(await premiumActive("default-owner")).toBe(false);
		expect(await premiumActive("default-restorer")).toBe(true);
		const events = await transferEvents("default-owner", "default-restorer");
		expect(events.map((event) => event.customer_id)).toEqual(["default-owner", "default-restorer"]);
		for (const event of events)
			expect(JSON.parse(event.payload)).toMatchObject({
				transferred_from: [ownerAppUserId],
				transferred_to: [restorerAppUserId],
				store: "google",
				environment: "sandbox",
			});
		const webhook = await testEnv.DB.prepare(
			"SELECT customer_id, payload FROM billing_webhook_deliveries WHERE endpoint_id = 'restore-transfer-endpoint'",
		).first<{ customer_id: string; payload: string }>();
		expect(webhook?.customer_id).toBe("default-restorer");
		expect(JSON.parse(webhook!.payload)).toMatchObject({
			type: "TRANSFER",
			transferred_from: [ownerAppUserId],
			transferred_to: [restorerAppUserId],
		});

		const history = await admin(
			"GET",
			`/internal/v1/admin/purchases/projects/${projectRef}/customers/default-owner`,
		);
		expect(history.status).toBe(200);
		const detail = await history.json<{ events: Array<{ event_type: string; payload: string }> }>();
		expect(
			detail.events
				.filter((event) => event.event_type === "transferred")
				.map((event) => JSON.parse(event.payload)),
		).toEqual([expect.objectContaining({ transferred_to: [restorerAppUserId] })]);

		const replay = await restore("default-restorer", "default-token");
		expect(replay.status).toBe(200);
		expect(await transferEvents("default-owner", "default-restorer")).toHaveLength(2);

		const erased = await worker.fetch!(
			new Request("https://billing.internal/internal/v1/customers/erase", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-internal-token": "billing-runtime-internal-token",
				},
				body: JSON.stringify({ project_id: projectId, application_user_id: ownerAppUserId }),
			}) as Request<unknown, IncomingRequestCfProperties>,
			billingEnv,
			createExecutionContext(),
		);
		expect(erased.status).toBe(200);
		for (const event of await transferEvents("default-owner", "default-restorer"))
			expect(event.payload).not.toContain(ownerAppUserId);
	});

	it("keeps a transferred subscription with its new owner when the store sends a renewal", async () => {
		await customer("renewal-owner");
		await customer("renewal-restorer");
		subscriptionReceipt("renewal-token", "renewal-owner");
		expect((await buy("renewal-owner", "renewal-token")).status).toBe(200);
		expect((await restore("renewal-restorer", "renewal-token")).status).toBe(200);
		googlePurchases.set("renewal-token", {
			...googlePurchases.get("renewal-token"),
			latestOrderId: "GPA.renewal-token..1",
		});

		await processGoogleBillingNotification(billingEnv, {
			eventId: "renewal-notification",
			projectId,
			purchaseToken: "renewal-token",
			productId: weekly,
			productType: "subscription",
			eventType: "SUBSCRIPTION_RENEWED",
			eventOccurredAt: new Date().toISOString(),
			environment: "sandbox",
		});

		expect(await chainOwners("renewal-token")).toEqual(["renewal-restorer"]);
		expect(await premiumActive("renewal-restorer")).toBe(true);
		expect(await premiumActive("renewal-owner")).toBe(false);
		const subscription = await testEnv.DB.prepare(
			"SELECT id FROM billing_subscriptions WHERE project_id = ? AND original_transaction_id = 'renewal-token'",
		)
			.bind(projectId)
			.first<{ id: string }>();
		await expect(reconcileStoreSubscription(billingEnv, subscription!.id)).resolves.toMatchObject({
			store: "google",
		});
		expect(await chainOwners("renewal-token")).toEqual(["renewal-restorer"]);
		expect(await transferEvents("renewal-owner", "renewal-restorer")).toHaveLength(2);
	});

	it("applies the setting when a new purchase uses a receipt owned by another App User ID", async () => {
		expect(await setRestoreBehavior("transfer")).toBe("transfer");
		await customer("purchase-owner");
		await customer("purchase-buyer");
		lifetimeReceipt("purchase-token", "purchase-owner");
		expect((await buy("purchase-owner", "purchase-token", lifetime)).status).toBe(200);
		expect(await premiumActive("purchase-owner")).toBe(true);

		const bought = await buy("purchase-buyer", "purchase-token", lifetime);

		expect(bought.status).toBe(200);
		expect(await chainOwners("purchase-token")).toEqual(["purchase-buyer"]);
		expect(await premiumActive("purchase-owner")).toBe(false);
		expect(await premiumActive("purchase-buyer")).toBe(true);
		expect(await transferEvents("purchase-owner", "purchase-buyer")).toHaveLength(2);
	});

	it("transfers only when the current owner has no active subscription", async () => {
		expect(await setRestoreBehavior("transfer_if_no_active_subscriptions")).toBe(
			"transfer_if_no_active_subscriptions",
		);
		const overview = await admin("GET", `/internal/v1/admin/billing/${projectRef}`);
		expect(
			(await overview.json<{ settings: { restore_behavior: string } }>()).settings,
		).toMatchObject({ restore_behavior: "transfer_if_no_active_subscriptions" });
		await customer("active-owner");
		await customer("active-restorer");
		subscriptionReceipt("active-token", "active-owner");
		expect((await buy("active-owner", "active-token")).status).toBe(200);

		await expectReceiptInUse(await restore("active-restorer", "active-token"));
		await expectReceiptInUse(await buy("active-restorer", "active-token"));
		expect(await chainOwners("active-token")).toEqual(["active-owner"]);
		expect(await premiumActive("active-owner")).toBe(true);
		expect(await premiumActive("active-restorer")).toBe(false);
		expect(await transferEvents("active-owner", "active-restorer")).toEqual([]);

		await customer("lapsed-owner");
		await customer("lapsed-restorer");
		subscriptionReceipt("lapsed-subscription", "lapsed-owner", false);
		lifetimeReceipt("lapsed-lifetime", "lapsed-owner");
		expect((await buy("lapsed-owner", "lapsed-subscription")).status).toBe(200);
		expect((await buy("lapsed-owner", "lapsed-lifetime", lifetime)).status).toBe(200);

		expect((await restore("lapsed-restorer", "lapsed-lifetime", lifetime)).status).toBe(200);
		expect(await chainOwners("lapsed-lifetime")).toEqual(["lapsed-restorer"]);
		expect(await premiumActive("lapsed-restorer")).toBe(true);
		expect(await premiumActive("lapsed-owner")).toBe(false);
	});

	it("aliases an anonymous owner with the new App User ID instead of applying the setting", async () => {
		await storeLegacySetting("block");
		const anonymousAppUserId = await customer("anonymous-owner", true);
		await customer("anonymous-restorer");
		subscriptionReceipt("anonymous-token", "anonymous-owner");
		expect((await buy("anonymous-owner", "anonymous-token")).status).toBe(200);

		const restored = await restore("anonymous-restorer", "anonymous-token");

		expect(restored.status).toBe(200);
		expect(await chainOwners("anonymous-token")).toEqual(["anonymous-restorer"]);
		expect(await premiumActive("anonymous-restorer")).toBe(true);
		const merged = await testEnv.DB.prepare("SELECT id FROM billing_customers WHERE id = ?")
			.bind("anonymous-owner")
			.first();
		expect(merged).toBeNull();
		const alias = await testEnv.DB.prepare(
			"SELECT customer_id FROM billing_customer_aliases WHERE project_id = ? AND app_user_id = ?",
		)
			.bind(projectId, anonymousAppUserId)
			.first<{ customer_id: string }>();
		expect(alias?.customer_id).toBe("anonymous-restorer");
		const restorer = await testEnv.DB.prepare(
			"SELECT primary_app_user_id, anonymous FROM billing_customers WHERE id = 'anonymous-restorer'",
		).first();
		expect(restorer).toEqual({ primary_app_user_id: "user-anonymous-restorer", anonymous: 0 });
		expect(await transferEvents("anonymous-owner", "anonymous-restorer")).toEqual([]);
	});

	it("keeps purchases with the original App User ID when the legacy block setting is stored", async () => {
		await storeLegacySetting("block");
		await customer("keep-owner");
		await customer("keep-restorer");
		await customer("keep-anonymous", true);
		subscriptionReceipt("keep-token", "keep-owner");
		expect((await buy("keep-owner", "keep-token")).status).toBe(200);

		await expectReceiptInUse(await restore("keep-restorer", "keep-token"));
		await expectReceiptInUse(await buy("keep-restorer", "keep-token"));
		await expectReceiptInUse(await restore("keep-anonymous", "keep-token"));
		expect(await chainOwners("keep-token")).toEqual(["keep-owner"]);
		expect(await premiumActive("keep-owner")).toBe(true);
		expect(await premiumActive("keep-restorer")).toBe(false);

		await customer("keep-unsynced-owner");
		subscriptionReceipt("keep-unsynced-token", "keep-unsynced-owner");
		await expectReceiptInUse(await restore("keep-restorer", "keep-unsynced-token"));

		subscriptionReceipt("keep-unowned-token", null);
		expect((await restore("keep-restorer", "keep-unowned-token")).status).toBe(200);
		expect(await chainOwners("keep-unowned-token")).toEqual(["keep-restorer"]);
		expect(await premiumActive("keep-restorer")).toBe(true);
	});

	it("reads a missing or unknown stored setting as a transfer", async () => {
		expect(await setRestoreBehavior("share_between_ids")).toBe("transfer");
		await testEnv.DB.prepare("DELETE FROM billing_project_settings WHERE project_id = ?")
			.bind(projectId)
			.run();
		await customer("missing-owner");
		await customer("missing-restorer");
		lifetimeReceipt("missing-token", "missing-owner");
		expect((await buy("missing-owner", "missing-token", lifetime)).status).toBe(200);

		expect((await restore("missing-restorer", "missing-token", lifetime)).status).toBe(200);
		expect(await chainOwners("missing-token")).toEqual(["missing-restorer"]);
	});
});
