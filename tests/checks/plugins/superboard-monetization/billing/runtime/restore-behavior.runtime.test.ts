import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
	processGoogleBillingNotification,
	reconcileStoreSubscription,
} from "../../../../../../packages/plugins/superboard-core/api/src/lib/billing-jobs.js";
import { identifyCustomer } from "../../../../../../packages/plugins/superboard-core/api/src/lib/billing.js";
import { encryptCredential } from "../../../../../../packages/plugins/superboard-core/api/src/lib/secrets.js";
import iapRoutes from "../../../../../../packages/plugins/superboard-core/api/src/routes/iap.js";
import worker from "../../../../../../packages/plugins/superboard-monetization/billing/src/index.js";
import { billingTestEnv as testEnv, createExecutionContext } from "./apply-migrations.js";

const projectId = "421";
const productionProjectId = "422";
const projectRef = "42-test";
const weekly = "restore.weekly";
const lifetime = "restore.lifetime";
const googlePurchases = new Map<string, Record<string, unknown>>();
const billingEnv = { ...testEnv, CREDENTIAL_KEY_SCOPE: "billing" };
let serviceAccount = "";

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

async function admin(method: string, path: string, body?: unknown, role = "owner") {
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
			role,
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

async function customer(id: string, anonymous = false, project = projectId) {
	const appUserId = anonymous ? `$superboard_anon_${id}` : `user-${id}`;
	await testEnv.DB.batch([
		testEnv.DB.prepare(
			"INSERT INTO billing_customers (id, project_id, primary_app_user_id, anonymous) VALUES (?, ?, ?, ?)",
		).bind(id, project, appUserId, anonymous ? 1 : 0),
		testEnv.DB.prepare(
			"INSERT INTO billing_customer_aliases (project_id, customer_id, app_user_id, alias_type) VALUES (?, ?, ?, ?)",
		).bind(project, id, appUserId, anonymous ? "anonymous" : "identified"),
	]);
	return appUserId;
}

function subscriptionReceipt(token: string, owner: string | null, active = true, sandbox = true) {
	googlePurchases.set(token, {
		subscriptionState: active ? "SUBSCRIPTION_STATE_ACTIVE" : "SUBSCRIPTION_STATE_EXPIRED",
		...(sandbox ? { testPurchase: {} } : {}),
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

const buy = (
	customerId: string,
	token: string,
	productId = weekly,
	environment = "sandbox",
	project = projectId,
) =>
	send("/internal/v1/receipts/verify", {
		project_id: project,
		customer_id: customerId,
		store: "google",
		environment,
		purchase_token: token,
		product_id: productId,
	});

const restore = (
	customerId: string,
	token: string,
	productId = weekly,
	environment = "sandbox",
	project = projectId,
) =>
	send("/internal/v1/receipts/restore", {
		project_id: project,
		customer_id: customerId,
		environment,
		google_purchases: [{ purchase_token: token, product_id: productId }],
	});

async function chainOwners(token: string, project = projectId) {
	const rows = await testEnv.DB.prepare(
		`SELECT customer_id FROM billing_subscriptions WHERE project_id = ? AND original_transaction_id = ?
		 UNION SELECT customer_id FROM billing_transactions WHERE project_id = ? AND original_transaction_id = ?`,
	)
		.bind(project, token, project, token)
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

async function coinBalances(...customerIds: string[]) {
	const rows = await testEnv.DB.prepare(
		`SELECT customer_id, SUM(amount) AS amount FROM billing_balance_ledger
		 WHERE project_id = ? AND currency_identifier = 'coins' GROUP BY customer_id ORDER BY customer_id`,
	)
		.bind(projectId)
		.all<{ customer_id: string; amount: number }>();
	return rows.results.filter((row) => customerIds.includes(row.customer_id));
}

async function expectReceiptInUse(response: Response) {
	expect(response.status).toBe(409);
	expect(await response.json()).toMatchObject({ code: "receipt_already_in_use", retryable: false });
}

describe("RevenueCat restore behavior in the Billing runtime", () => {
	beforeAll(async () => {
		const { privateKey } = await generateKeyPair("RS256", { extractable: true });
		serviceAccount = JSON.stringify({
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
				`INSERT INTO billing_products (id, project_id, store, environment, store_product_id, product_type, metadata)
				 VALUES ('restore-coins', ?, 'google', 'sandbox', 'restore.coins', 'consumable', ?)`,
			).bind(projectId, JSON.stringify({ currency_identifier: "coins", credit_amount: 5 })),
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

	it("applies the sandbox restore behavior to sandbox purchases only, when one is set", async () => {
		const saved = await admin("PUT", `/internal/v1/admin/billing/${projectRef}/settings`, {
			purchases_enabled: true,
			restore_behavior: "block",
			sandbox_restore_behavior: "transfer",
		});
		expect(saved.status).toBe(200);
		expect(await saved.json()).toMatchObject({
			restore_behavior: "block",
			sandbox_restore_behavior: "transfer",
		});
		await testEnv.DB.prepare(
			`INSERT INTO billing_products (id, project_id, store, environment, store_product_id, product_type)
			 VALUES ('restore-weekly-production', ?, 'google', 'production', ?, 'subscription')`,
		)
			.bind(projectId, weekly)
			.run();
		await customer("sandbox-owner");
		await customer("sandbox-restorer");
		subscriptionReceipt("sandbox-token", "sandbox-owner");
		expect((await buy("sandbox-owner", "sandbox-token")).status).toBe(200);
		expect((await restore("sandbox-restorer", "sandbox-token")).status).toBe(200);
		expect(await chainOwners("sandbox-token")).toEqual(["sandbox-restorer"]);

		await customer("production-owner");
		await customer("production-restorer");
		subscriptionReceipt("production-token", "production-owner", true, false);
		expect((await buy("production-owner", "production-token", weekly, "production")).status).toBe(
			200,
		);
		await expectReceiptInUse(
			await restore("production-restorer", "production-token", weekly, "production"),
		);
		expect(await chainOwners("production-token")).toEqual(["production-owner"]);

		expect(await setRestoreBehavior("block")).toBe("block");
		const overview = await admin("GET", `/internal/v1/admin/billing/${projectRef}`);
		expect((await overview.json<{ settings: Record<string, unknown> }>()).settings).toMatchObject({
			restore_behavior: "block",
			sandbox_restore_behavior: "transfer",
		});

		const cleared = await admin("PUT", `/internal/v1/admin/billing/${projectRef}/settings`, {
			purchases_enabled: true,
			restore_behavior: "block",
			sandbox_restore_behavior: null,
		});
		expect(await cleared.json()).toMatchObject({ sandbox_restore_behavior: null });
		await customer("cleared-owner");
		await customer("cleared-restorer");
		subscriptionReceipt("cleared-token", "cleared-owner");
		expect((await buy("cleared-owner", "cleared-token")).status).toBe(200);
		await expectReceiptInUse(await restore("cleared-restorer", "cleared-token"));
		expect(await chainOwners("cleared-token")).toEqual(["cleared-owner"]);
	});

	it("transfers a customer's purchases to another App User ID from the customer profile", async () => {
		await storeLegacySetting("block");
		const sourceAppUserId = await customer("manual-source");
		const targetAppUserId = await customer("manual-target");
		subscriptionReceipt("manual-subscription", "manual-source");
		lifetimeReceipt("manual-coins", "manual-source");
		expect((await buy("manual-source", "manual-subscription")).status).toBe(200);
		expect((await buy("manual-source", "manual-coins", "restore.coins")).status).toBe(200);
		const transferPath = `/internal/v1/admin/purchases/projects/${projectRef}/customers/manual-source/transfer`;

		expect(
			(await admin("POST", transferPath, { target_customer_id: "manual-target" }, "member")).status,
		).toBe(403);
		expect(
			(await admin("POST", transferPath, { target_customer_id: "manual-missing" })).status,
		).toBe(404);
		expect(
			(await admin("POST", transferPath, { target_customer_id: "manual-source" })).status,
		).toBe(422);
		expect(await chainOwners("manual-subscription")).toEqual(["manual-source"]);

		const transferred = await admin("POST", transferPath, { target_customer_id: "manual-target" });

		expect(transferred.status).toBe(200);
		expect(await transferred.json()).toEqual({ customer_id: "manual-target", transferred: 2 });
		expect(await chainOwners("manual-subscription")).toEqual(["manual-target"]);
		expect(await chainOwners("manual-coins")).toEqual(["manual-target"]);
		expect(await premiumActive("manual-source")).toBe(false);
		expect(await premiumActive("manual-target")).toBe(true);
		const events = await transferEvents("manual-source", "manual-target");
		expect(events.map((event) => event.customer_id)).toEqual(["manual-source", "manual-target"]);
		for (const event of events)
			expect(JSON.parse(event.payload)).toMatchObject({
				transferred_from: [sourceAppUserId],
				transferred_to: [targetAppUserId],
				store: "google",
				environment: "sandbox",
			});
		const webhooks = await testEnv.DB.prepare(
			`SELECT customer_id, payload FROM billing_webhook_deliveries
			 WHERE endpoint_id = 'restore-transfer-endpoint' AND customer_id IN ('manual-source', 'manual-target')`,
		).all<{ customer_id: string; payload: string }>();
		expect(webhooks.results.map((webhook) => webhook.customer_id)).toEqual(["manual-target"]);
		expect(JSON.parse(webhooks.results[0]?.payload ?? "{}")).toMatchObject({
			type: "TRANSFER",
			transferred_from: [sourceAppUserId],
			transferred_to: [targetAppUserId],
		});
		expect(await coinBalances("manual-source", "manual-target")).toEqual([
			{ customer_id: "manual-source", amount: 5 },
		]);
		const audit = await testEnv.DB.prepare(
			`SELECT resource_id, metadata FROM billing_admin_audit_logs
			 WHERE project_id = ? AND action = 'customer.purchases_transferred'`,
		)
			.bind(projectId)
			.first<{ resource_id: string; metadata: string }>();
		expect(audit?.resource_id).toBe("manual-source");
		expect(JSON.parse(audit?.metadata ?? "{}")).toEqual({
			target_customer_id: "manual-target",
			transferred: 2,
		});

		expect((await restore("manual-target", "manual-subscription")).status).toBe(200);
		await expectReceiptInUse(await restore("manual-source", "manual-subscription"));
		expect(await chainOwners("manual-subscription")).toEqual(["manual-target"]);
	});

	it("leaves virtual currency granted by a transferred consumable with the customer who received it", async () => {
		expect(await setRestoreBehavior("transfer")).toBe("transfer");
		await customer("coins-owner");
		await customer("coins-buyer");
		lifetimeReceipt("coins-token", "coins-owner");
		expect((await buy("coins-owner", "coins-token", "restore.coins")).status).toBe(200);

		expect((await buy("coins-buyer", "coins-token", "restore.coins")).status).toBe(200);

		expect(await chainOwners("coins-token")).toEqual(["coins-buyer"]);
		expect(await coinBalances("coins-owner", "coins-buyer")).toEqual([
			{ customer_id: "coins-owner", amount: 5 },
		]);
	});

	it("records an alias in the customer history when an anonymous App User ID is merged", async () => {
		expect(await setRestoreBehavior("transfer")).toBe("transfer");
		const anonymousAppUserId = await customer("alias-anonymous", true);
		const restorerAppUserId = await customer("alias-restorer");
		subscriptionReceipt("alias-token", "alias-anonymous");
		expect((await buy("alias-anonymous", "alias-token")).status).toBe(200);
		expect((await restore("alias-restorer", "alias-token")).status).toBe(200);

		const history = await admin(
			"GET",
			`/internal/v1/admin/purchases/projects/${projectRef}/customers/alias-restorer`,
		);
		const detail = await history.json<{ events: Array<{ event_type: string; payload: string }> }>();
		expect(
			detail.events
				.filter((event) => event.event_type === "aliased")
				.map((event) => JSON.parse(event.payload)),
		).toEqual([{ alias: anonymousAppUserId, app_user_id: restorerAppUserId }]);

		const loginAppUserId = await customer("alias-login", true);
		const identified = await identifyCustomer(
			testEnv.DB,
			projectId,
			loginAppUserId,
			"user-alias-login",
		);
		const loginEvents = await testEnv.DB.prepare(
			"SELECT payload FROM billing_events WHERE customer_id = ? AND event_type = 'aliased'",
		)
			.bind(String(identified?.id))
			.all<{ payload: string }>();
		expect(loginEvents.results.map((event) => JSON.parse(event.payload))).toEqual([
			{ alias: loginAppUserId, app_user_id: "user-alias-login" },
		]);
	});

	it("keeps a transferred purchase with its new owner when the legacy Google webhook names the previous owner", async () => {
		await testEnv.DB.batch([
			testEnv.DB.prepare(
				"INSERT INTO projects (id, name, identifier, instance_id, is_test) VALUES (422, 'Restore production', 'restore-production', 42, 0)",
			),
			testEnv.DB.prepare(
				`INSERT INTO billing_products (id, project_id, store, environment, store_product_id, product_type)
				 VALUES ('legacy-weekly', ?, 'google', 'production', ?, 'subscription')`,
			).bind(productionProjectId, weekly),
		]);
		await customer("legacy-owner", false, productionProjectId);
		await customer("legacy-restorer", false, productionProjectId);
		subscriptionReceipt("legacy-token", "legacy-owner", true, false);
		const production = ["production", productionProjectId] as const;
		expect((await buy("legacy-owner", "legacy-token", weekly, ...production)).status).toBe(200);
		expect((await restore("legacy-restorer", "legacy-token", weekly, ...production)).status).toBe(
			200,
		);
		googlePurchases.set("legacy-token", {
			...googlePurchases.get("legacy-token"),
			latestOrderId: "GPA.legacy-token..1",
		});

		const notified = await iapRoutes.request(
			"/google/42",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Goog-Channel-Token": "legacy-channel-token",
				},
				body: JSON.stringify({
					packageName: "com.superboard.restore",
					subscriptionNotification: {
						notificationType: "SUBSCRIPTION_RENEWED",
						purchaseToken: "legacy-token",
						subscriptionId: weekly,
					},
				}),
			},
			{
				...billingEnv,
				GOOGLE_PUBSUB_VERIFICATION_TOKEN: "legacy-channel-token",
				GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: serviceAccount,
			},
		);

		expect(notified.status).toBe(200);
		const renewal = await testEnv.DB.prepare(
			"SELECT customer_id FROM billing_transactions WHERE project_id = ? AND store_transaction_id = ?",
		)
			.bind(productionProjectId, "GPA.legacy-token..1")
			.first<{ customer_id: string }>();
		expect(renewal?.customer_id).toBe("legacy-restorer");
		expect(await chainOwners("legacy-token", productionProjectId)).toEqual(["legacy-restorer"]);
	});
});
