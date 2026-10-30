import type { BillingEnv } from "../types.js";
import { applyVerifiedPurchase, type BillingEnvironment, type BillingStatus } from "./billing.js";
import { readTextLimited } from "./http-limits.js";
import { purchasesError } from "./purchases-v2.js";
import { decryptCredential, encryptCredential, scopedStoreCredential } from "./secrets.js";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
	return value && typeof value === "object" && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: {};
}
function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}
function id(value: unknown): string {
	return text(value) || text(object(value).id);
}
function timestamp(value: unknown): string | null {
	return typeof value === "number" && Number.isFinite(value)
		? new Date(value * 1000).toISOString()
		: null;
}
function micros(amount: unknown, currency: string): number {
	const decimals =
		new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
			.maximumFractionDigits ?? 2;
	const result = Number(amount ?? 0) * 10 ** (6 - decimals);
	if (!Number.isSafeInteger(result) || result < 0)
		throw purchasesError("stripe_amount_invalid", "Stripe amount is invalid");
	return result;
}
function origin(value: unknown): string {
	const url = new URL(text(value));
	if (
		url.username ||
		url.password ||
		(url.protocol !== "https:" &&
			!(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
	)
		throw purchasesError("stripe_origin_invalid", "Use an HTTPS application origin");
	return url.origin;
}
function returnUrl(value: unknown, allowed: string): string {
	const url = new URL(text(value));
	if (url.origin !== allowed || url.username || url.password)
		throw purchasesError(
			"stripe_return_url_invalid",
			"Return URL must use the configured application origin",
		);
	return url.href;
}

async function stripeRequest(
	key: string,
	path: string,
	body?: URLSearchParams,
	idempotencyKey?: string,
): Promise<ObjectValue> {
	const response = await fetch(`https://api.stripe.com/v1/${path}`, {
		method: body ? "POST" : "GET",
		headers: {
			Authorization: `Bearer ${key}`,
			"Stripe-Version": "2024-06-20",
			...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
			...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
		},
		body: body?.toString(),
		redirect: "error",
		signal: AbortSignal.timeout(20_000),
	});
	if (!response.ok)
		throw purchasesError(
			"stripe_request_failed",
			"Stripe request failed. Check the connection and try again.",
			502,
			true,
		);
	return object(
		JSON.parse(await readTextLimited(response, 1_048_576, "Stripe response too large")),
	);
}

export async function configureStripe(
	env: BillingEnv,
	projectId: string,
	environment: BillingEnvironment,
	input: ObjectValue,
) {
	const secret = text(input.secret_key).trim();
	const signing = text(input.webhook_secret).trim();
	if (
		!secret.startsWith(environment === "sandbox" ? "sk_test_" : "sk_live_") ||
		!signing.startsWith("whsec_")
	)
		throw purchasesError(
			"stripe_credentials_invalid",
			"Use the Stripe secret key for this environment and its webhook signing secret",
		);
	const allowedOrigin = origin(input.application_origin);
	const encrypted = await encryptCredential(
		env,
		JSON.stringify({ secret_key: secret, webhook_secret: signing }),
	);
	const billing = env.CREDENTIAL_KEY_SCOPE === "billing";
	await env.DB.prepare(`INSERT INTO billing_store_connections(id,project_id,provider,environment,display_name,status,configuration_encrypted,billing_configuration_encrypted,public_configuration)
		VALUES(?,?,'stripe',?,'Stripe','configured',?,?,?) ON CONFLICT(project_id,provider,environment) DO UPDATE SET
		configuration_encrypted=excluded.configuration_encrypted,billing_configuration_encrypted=excluded.billing_configuration_encrypted,
		public_configuration=excluded.public_configuration,status='configured',last_tested_at=NULL,updated_at=datetime('now')`)
		.bind(
			crypto.randomUUID(),
			projectId,
			environment,
			billing ? null : encrypted,
			billing ? encrypted : null,
			JSON.stringify({ application_origin: allowedOrigin }),
		)
		.run();
	return { configured: true, environment, application_origin: allowedOrigin };
}

export async function stripeConnectionStatus(
	env: BillingEnv,
	projectId: string,
	environment: BillingEnvironment,
) {
	const row = await env.DB.prepare(
		"SELECT id,status,public_configuration,last_tested_at,configuration_encrypted,billing_configuration_encrypted FROM billing_store_connections WHERE project_id=? AND provider='stripe' AND environment=?",
	)
		.bind(projectId, environment)
		.first<{
			id: string;
			status: string;
			public_configuration: string;
			last_tested_at: string | null;
			configuration_encrypted: string | null;
			billing_configuration_encrypted: string | null;
		}>();
	return {
		webhook_path: `/api/v2/purchases/providers/webhooks/stripe/${environment}/${projectId}`,
		configured: Boolean(row && scopedStoreCredential(row, env)),
		environment,
		application_origin: row
			? text(object(JSON.parse(row.public_configuration)).application_origin)
			: "",
		last_tested_at: row?.last_tested_at ?? null,
	};
}

async function connection(env: BillingEnv, projectId: string, environment: BillingEnvironment) {
	const row = await env.DB.prepare(
		"SELECT id,public_configuration,configuration_encrypted,billing_configuration_encrypted FROM billing_store_connections WHERE project_id=? AND provider='stripe' AND environment=? AND status!='disabled'",
	)
		.bind(projectId, environment)
		.first<{
			id: string;
			public_configuration: string;
			configuration_encrypted: string | null;
			billing_configuration_encrypted: string | null;
		}>();
	const cipher = row && scopedStoreCredential(row, env);
	if (!row || !cipher)
		throw purchasesError(
			"stripe_not_configured",
			"Stripe is not configured for this environment",
			503,
		);
	const secrets = object(JSON.parse(await decryptCredential(env, cipher)));
	return {
		id: row.id,
		key: text(secrets.secret_key),
		signing: text(secrets.webhook_secret),
		origin: origin(object(JSON.parse(row.public_configuration)).application_origin),
	};
}

export async function testStripeConnection(
	env: BillingEnv,
	projectId: string,
	environment: BillingEnvironment,
) {
	const configured = await connection(env, projectId, environment);
	const account = await stripeRequest(configured.key, "account");
	if (!text(account.id))
		throw purchasesError("stripe_account_invalid", "Stripe account could not be verified");
	await env.DB.prepare(
		"UPDATE billing_store_connections SET status='connected',last_tested_at=datetime('now') WHERE id=?",
	)
		.bind(configured.id)
		.run();
	return { valid: true };
}

export async function syncStripeCatalog(
	env: BillingEnv,
	projectId: string,
	environment: BillingEnvironment,
) {
	const configured = await connection(env, projectId, environment);
	let cursor = "",
		imported = 0;
	for (let page = 0; page < 100; page++) {
		const query = new URLSearchParams({
			active: "true",
			limit: "100",
			"expand[]": "data.product",
			...(cursor ? { starting_after: cursor } : {}),
		});
		const result = await stripeRequest(configured.key, `prices?${query.toString()}`);
		if (!Array.isArray(result.data))
			throw purchasesError("stripe_catalog_invalid", "Stripe returned an invalid catalog");
		const statements = result.data
			.map((raw) => {
				const price = object(raw),
					product = object(price.product);
				if (
					price.livemode !== (environment === "production") ||
					!text(price.id).startsWith("price_") ||
					product.active === false
				)
					return null;
				const currency = text(price.currency).toUpperCase();
				if (!currency || price.unit_amount === null || price.billing_scheme !== "per_unit")
					return null;
				return env.DB.prepare(`INSERT INTO billing_products(id,project_id,store,environment,store_product_id,product_type,display_name,active,metadata)
				VALUES(?,?,'stripe',?,?,?,?,1,?) ON CONFLICT(project_id,store,environment,store_product_id) DO UPDATE SET
				display_name=excluded.display_name,metadata=excluded.metadata,active=1,updated_at=datetime('now')`).bind(
					crypto.randomUUID(),
					projectId,
					environment,
					price.id,
					price.recurring ? "subscription" : "non_consumable",
					text(product.name) || price.id,
					JSON.stringify({
						currency,
						price_micros: micros(price.unit_amount, currency),
						recurring: price.recurring ?? null,
						provider_synced_at: new Date().toISOString(),
					}),
				);
			})
			.filter((statement): statement is D1PreparedStatement => statement !== null);
		if (statements.length) {
			await env.DB.batch(statements);
			imported += statements.length;
		}
		if (!result.has_more) {
			await env.DB.prepare(
				"UPDATE billing_store_connections SET last_synced_at=datetime('now') WHERE id=?",
			)
				.bind(configured.id)
				.run();
			return { imported };
		}
		const next = id(result.data.at(-1));
		if (!next || next === cursor)
			throw purchasesError("stripe_catalog_cursor_invalid", "Stripe catalog pagination failed");
		cursor = next;
	}
	throw purchasesError(
		"stripe_catalog_too_large",
		"Stripe catalog exceeds the synchronization limit",
	);
}

export async function createStripeCheckout(
	env: BillingEnv,
	projectId: string,
	customerId: string,
	environment: BillingEnvironment,
	input: ObjectValue,
	key: string,
) {
	if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(key))
		throw purchasesError("checkout_idempotency_required", "A valid Idempotency-Key is required");
	const configured = await connection(env, projectId, environment);
	const success = returnUrl(input.success_url, configured.origin),
		cancel = returnUrl(input.cancel_url, configured.origin);
	const product = await env.DB.prepare(
		"SELECT id,store_product_id,product_type FROM billing_products WHERE id=? AND project_id=? AND store='stripe' AND environment=? AND active=1",
	)
		.bind(text(input.product_id), projectId, environment)
		.first<{ id: string; store_product_id: string; product_type: string }>();
	if (!product) throw purchasesError("stripe_product_not_found", "Stripe product not found", 404);
	const existingCustomer = await env.DB.prepare(
		"SELECT id FROM billing_customers WHERE id=? AND project_id=? AND blocked=0",
	)
		.bind(customerId, projectId)
		.first();
	if (!existingCustomer) throw purchasesError("customer_not_found", "Customer not found", 404);
	const proposedId = crypto.randomUUID();
	await env.DB.prepare(`INSERT INTO billing_checkout_sessions(id,project_id,customer_id,connection_id,provider,environment,product_id,success_url,cancel_url,idempotency_key)
		VALUES(?,?,?,?,'stripe',?,?,?,?,?) ON CONFLICT(project_id,idempotency_key) DO NOTHING`)
		.bind(
			proposedId,
			projectId,
			customerId,
			configured.id,
			environment,
			product.id,
			success,
			cancel,
			key,
		)
		.run();
	const session = await env.DB.prepare(
		"SELECT * FROM billing_checkout_sessions WHERE project_id=? AND idempotency_key=?",
	)
		.bind(projectId, key)
		.first<Record<string, unknown>>();
	if (
		!session ||
		session.customer_id !== customerId ||
		session.product_id !== product.id ||
		session.success_url !== success ||
		session.cancel_url !== cancel
	)
		throw purchasesError(
			"checkout_idempotency_conflict",
			"This checkout key belongs to a different request",
			409,
		);
	if (session.checkout_url) return { id: session.id, url: session.checkout_url };
	const previous = await env.DB.prepare(
		"SELECT provider_customer_id FROM billing_checkout_sessions WHERE project_id=? AND customer_id=? AND environment=? AND provider_customer_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
	)
		.bind(projectId, customerId, environment)
		.first<{ provider_customer_id: string }>();
	const form = new URLSearchParams({
		mode: product.product_type === "subscription" ? "subscription" : "payment",
		"line_items[0][price]": product.store_product_id,
		"line_items[0][quantity]": "1",
		success_url: success,
		cancel_url: cancel,
		client_reference_id: customerId,
		"metadata[superboard_session_id]": String(session.id),
	});
	for (const prefix of [
		"metadata",
		product.product_type === "subscription"
			? "subscription_data[metadata]"
			: "payment_intent_data[metadata]",
	]) {
		form.set(`${prefix}[superboard_project_id]`, projectId);
		form.set(`${prefix}[superboard_customer_id]`, customerId);
		form.set(`${prefix}[superboard_product_id]`, product.id);
	}
	if (previous) form.set("customer", previous.provider_customer_id);
	else if (product.product_type !== "subscription") form.set("customer_creation", "always");
	const result = await stripeRequest(
		configured.key,
		"checkout/sessions",
		form,
		`superboard:${String(session.id)}`,
	);
	const url = text(result.url);
	if (!url.startsWith("https://checkout.stripe.com/") || !id(result).startsWith("cs_"))
		throw purchasesError("stripe_checkout_invalid", "Stripe returned an invalid checkout session");
	await env.DB.prepare(
		"UPDATE billing_checkout_sessions SET provider_session_id=?,provider_customer_id=?,checkout_url=?,expires_at=?,updated_at=datetime('now') WHERE id=?",
	)
		.bind(id(result), id(result.customer) || null, url, timestamp(result.expires_at), session.id)
		.run();
	return { id: session.id, url };
}

export async function createStripePortal(
	env: BillingEnv,
	projectId: string,
	customerId: string,
	environment: BillingEnvironment,
	input: ObjectValue,
) {
	const configured = await connection(env, projectId, environment);
	const target = returnUrl(input.return_url, configured.origin);
	const customer = await env.DB.prepare(
		"SELECT provider_customer_id FROM billing_checkout_sessions WHERE project_id=? AND customer_id=? AND environment=? AND provider_customer_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
	)
		.bind(projectId, customerId, environment)
		.first<{ provider_customer_id: string }>();
	if (!customer)
		throw purchasesError(
			"stripe_customer_not_found",
			"No Stripe customer is linked to this account",
			404,
		);
	const result = await stripeRequest(
		configured.key,
		"billing_portal/sessions",
		new URLSearchParams({ customer: customer.provider_customer_id, return_url: target }),
	);
	if (!text(result.url).startsWith("https://billing.stripe.com/"))
		throw purchasesError("stripe_portal_invalid", "Stripe returned an invalid portal session");
	return { url: result.url };
}

export async function verifyStripeSignature(
	payload: string,
	signature: string,
	secret: string,
	now = Date.now(),
) {
	const parts = signature.split(",").map((part) => part.trim().split("="));
	const time = Number(parts.find(([key]) => key === "t")?.[1]);
	if (!Number.isSafeInteger(time) || Math.abs(now / 1000 - time) > 300)
		throw purchasesError("stripe_signature_invalid", "Invalid Stripe signature", 400);
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	for (const [name, value] of parts) {
		if (name !== "v1" || !value || !/^[a-f0-9]{64}$/i.test(value)) continue;
		const bytes = Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => parseInt(byte, 16));
		if (
			await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(`${time}.${payload}`))
		)
			return;
	}
	throw purchasesError("stripe_signature_invalid", "Invalid Stripe signature", 400);
}

export async function processStripeWebhook(
	env: BillingEnv,
	projectId: string,
	environment: BillingEnvironment,
	payload: string,
	signature: string,
) {
	const configured = await connection(env, projectId, environment);
	await verifyStripeSignature(payload, signature, configured.signing);
	const event = object(JSON.parse(payload));
	if (event.livemode !== (environment === "production"))
		throw purchasesError(
			"stripe_environment_invalid",
			"Stripe event environment does not match",
			400,
		);
	const eventId = text(event.id);
	if (!eventId.startsWith("evt_"))
		throw purchasesError("stripe_event_invalid", "Invalid Stripe event", 400);
	return applyStripeEvent(env, projectId, environment, event);
}

async function applyStripeEvent(
	env: BillingEnv,
	projectId: string,
	environment: BillingEnvironment,
	event: ObjectValue,
) {
	const configured = await connection(env, projectId, environment);
	const eventId = text(event.id),
		eventType = text(event.type);
	let resource = object(object(event.data).object);
	const eventResource = resource;
	let subscriptionId = "",
		paymentId = "";
	if (eventType.startsWith("checkout.session.")) {
		const session = await env.DB.prepare(
			"SELECT id,customer_id FROM billing_checkout_sessions WHERE connection_id=? AND (provider_session_id=? OR id=?)",
		)
			.bind(configured.id, id(resource), text(object(resource.metadata).superboard_session_id))
			.first<{ id: string; customer_id: string }>();
		if (!session) return { ignored: true };
		resource = await stripeRequest(
			configured.key,
			`checkout/sessions/${encodeURIComponent(id(resource))}`,
		);
		await env.DB.prepare(
			"UPDATE billing_checkout_sessions SET provider_session_id=?,provider_customer_id=?,status=?,updated_at=datetime('now') WHERE id=?",
		)
			.bind(id(resource), id(resource.customer) || null, text(resource.status), session.id)
			.run();
		subscriptionId = id(resource.subscription);
		paymentId = id(resource.payment_intent);
	} else if (eventType.startsWith("customer.subscription.")) subscriptionId = id(resource);
	else if (eventType === "invoice.paid" || eventType === "invoice.payment_failed")
		subscriptionId = id(resource.subscription);
	else if (eventType === "charge.refunded") {
		if (resource.refunded !== true) return { ignored: true };
		paymentId = id(resource.payment_intent);
		if (id(resource.invoice)) {
			const invoice = await stripeRequest(
				configured.key,
				`invoices/${encodeURIComponent(id(resource.invoice))}`,
			);
			subscriptionId = id(invoice.subscription);
		}
	} else return { ignored: true };
	let productId = "",
		customerId = "",
		originalId = "",
		storeProductId = "";
	let status: BillingStatus = "pending",
		expiresAt: string | null = null,
		startsAt: string | null = null,
		autoRenews = false;
	let productType: "subscription" | "non_consumable" | "consumable" = "non_consumable";
	let priceMicros = 0,
		currency = "USD";
	if (eventType === "invoice.paid") {
		currency = text(eventResource.currency).toUpperCase();
		priceMicros = micros(eventResource.amount_paid, currency);
	}
	if (subscriptionId) {
		resource = await stripeRequest(
			configured.key,
			`subscriptions/${encodeURIComponent(subscriptionId)}`,
		);
		const metadata = object(resource.metadata);
		if (text(metadata.superboard_project_id) !== projectId) return { ignored: true };
		customerId = text(metadata.superboard_customer_id);
		productId = text(metadata.superboard_product_id);
		const items = object(resource.items).data;
		const item = object(Array.isArray(items) ? items[0] : undefined);
		storeProductId = id(item.price);
		originalId = subscriptionId;
		productType = "subscription";
		const statuses: Record<string, BillingStatus> = {
			active: "active",
			trialing: "trialing",
			past_due: "billing_issue",
			unpaid: "expired",
			canceled: "expired",
			incomplete: "pending",
			incomplete_expired: "expired",
			paused: "paused",
		};
		status = statuses[text(resource.status)] ?? "pending";
		if (status === "active" && id(resource.latest_invoice)) {
			const invoice = await stripeRequest(
				configured.key,
				`invoices/${encodeURIComponent(id(resource.latest_invoice))}?expand[]=charge`,
			);
			if (object(invoice.charge).refunded === true) status = "refunded";
		}
		expiresAt = timestamp(resource.current_period_end ?? item.current_period_end);
		startsAt = timestamp(resource.current_period_start ?? item.current_period_start);
		autoRenews = resource.cancel_at_period_end !== true && status !== "expired";
	} else if (paymentId) {
		resource = await stripeRequest(
			configured.key,
			`payment_intents/${encodeURIComponent(paymentId)}`,
		);
		const metadata = object(resource.metadata);
		if (text(metadata.superboard_project_id) !== projectId) return { ignored: true };
		customerId = text(metadata.superboard_customer_id);
		productId = text(metadata.superboard_product_id);
		originalId = paymentId;
		status =
			eventType === "charge.refunded"
				? "refunded"
				: resource.status === "succeeded"
					? "active"
					: "pending";
		currency = text(resource.currency).toUpperCase();
		priceMicros = micros(resource.amount_received, currency);
		startsAt = timestamp(resource.created);
		if (status === "pending") return { pending: true };
	} else return { ignored: true };
	const product = await env.DB.prepare(
		"SELECT store_product_id,product_type FROM billing_products WHERE (id=? OR store_product_id=?) AND project_id=? AND store='stripe' AND environment=?",
	)
		.bind(subscriptionId ? "" : productId, storeProductId, projectId, environment)
		.first<{ store_product_id: string; product_type: string }>();
	const customer = await env.DB.prepare(
		"SELECT id FROM billing_customers WHERE id=? AND project_id=?",
	)
		.bind(customerId, projectId)
		.first();
	if (!product || !customer || (storeProductId && product.store_product_id !== storeProductId))
		throw purchasesError(
			"stripe_mapping_invalid",
			"Stripe event does not match the configured product and customer",
			422,
		);
	if (resource.livemode !== (environment === "production"))
		throw purchasesError(
			"stripe_environment_invalid",
			"Stripe resource environment does not match",
			400,
		);
	if (!subscriptionId && product.product_type === "consumable") productType = "consumable";
	return applyVerifiedPurchase(env, {
		projectId,
		customerId,
		store: "stripe",
		environment,
		storeProductId: product.store_product_id,
		productType,
		storeTransactionId: subscriptionId ? eventId : originalId,
		originalTransactionId: originalId,
		eventType: subscriptionId ? eventType : status === "refunded" ? "REFUNDED" : "PURCHASED",
		status,
		purchasedAt: startsAt,
		expiresAt,
		eventOccurredAt: timestamp(event.created),
		autoRenews,
		priceMicros,
		currency,
		rawPayload: { stripe_event_id: eventId },
	});
}

export async function reconcileStripeSubscription(
	env: BillingEnv,
	projectId: string,
	environment: BillingEnvironment,
	subscriptionId: string,
) {
	return applyStripeEvent(env, projectId, environment, {
		id: `reconcile:${subscriptionId}:${Math.floor(Date.now() / 900000)}`,
		type: "customer.subscription.updated",
		created: Math.floor(Date.now() / 1000),
		data: { object: { id: subscriptionId } },
	});
}
