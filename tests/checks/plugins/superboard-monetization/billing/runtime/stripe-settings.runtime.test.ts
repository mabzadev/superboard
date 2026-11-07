import { beforeAll, expect, test } from "vitest";

import {
	decryptCredential,
	scopedStoreCredential,
} from "../../../../../../packages/plugins/superboard-core/api/src/lib/secrets.js";
import {
	configureStripe,
	stripeConnectionStatus,
} from "../../../../../../packages/plugins/superboard-core/api/src/lib/stripe-billing.js";
import { billingTestEnv as testEnv } from "./apply-migrations.js";

async function storedConnection(projectId: string) {
	const row = await testEnv.DB.prepare(
		"SELECT status,last_tested_at,configuration_encrypted,billing_configuration_encrypted FROM billing_store_connections WHERE project_id=? AND provider='stripe' AND environment='sandbox'",
	)
		.bind(projectId)
		.first<{
			status: string;
			last_tested_at: string | null;
			configuration_encrypted: string | null;
			billing_configuration_encrypted: string | null;
		}>();
	if (!row) throw new Error("Stripe connection missing");
	const cipher = scopedStoreCredential(row, testEnv);
	if (!cipher) throw new Error("Stripe secrets missing");
	return {
		status: row.status,
		lastTestedAt: row.last_tested_at,
		secrets: JSON.parse(await decryptCredential(testEnv, cipher)),
	};
}

async function markVerified(projectId: string) {
	await testEnv.DB.prepare(
		"UPDATE billing_store_connections SET status='connected',last_tested_at='2026-01-02 03:04:05' WHERE project_id=? AND provider='stripe'",
	)
		.bind(projectId)
		.run();
}

beforeAll(async () => {
	await testEnv.DB.batch([
		testEnv.DB.prepare(
			"INSERT INTO instances(id,api_key,uri_scheme) VALUES(9,'stripe-settings','stripe-settings')",
		),
		testEnv.DB.prepare(
			"INSERT INTO projects(id,instance_id,is_test,name,identifier) VALUES(91,9,1,'Stripe origin','stripe-origin'),(92,9,1,'Stripe rotation','stripe-rotation'),(93,9,1,'Stripe new','stripe-new')",
		),
	]);
	for (const project of ["91", "92"])
		await configureStripe(testEnv, project, "sandbox", {
			secret_key: "sk_test_original",
			webhook_secret: "whsec_original",
			application_origin: "https://app.example.test",
		});
});

test("updating only the application origin keeps the stored Stripe secrets and verification", async () => {
	await markVerified("91");

	await expect(
		configureStripe(testEnv, "91", "sandbox", {
			application_origin: "https://shop.example.test/checkout",
		}),
	).resolves.toEqual({
		configured: true,
		environment: "sandbox",
		application_origin: "https://shop.example.test",
	});

	expect(await stripeConnectionStatus(testEnv, "91", "sandbox")).toMatchObject({
		configured: true,
		application_origin: "https://shop.example.test",
		last_tested_at: "2026-01-02 03:04:05",
	});
	expect(await storedConnection("91")).toEqual({
		status: "connected",
		lastTestedAt: "2026-01-02 03:04:05",
		secrets: { secret_key: "sk_test_original", webhook_secret: "whsec_original" },
	});
});

test("empty secret fields count as omitted and keep the stored secrets", async () => {
	await configureStripe(testEnv, "91", "sandbox", {
		secret_key: "",
		webhook_secret: "  ",
		application_origin: "https://app.example.test",
	});

	expect((await storedConnection("91")).secrets).toEqual({
		secret_key: "sk_test_original",
		webhook_secret: "whsec_original",
	});
});

test("a provided secret replaces only itself and asks for a new verification", async () => {
	await markVerified("92");

	await configureStripe(testEnv, "92", "sandbox", {
		webhook_secret: "whsec_rotated",
		application_origin: "https://app.example.test",
	});

	expect(await storedConnection("92")).toEqual({
		status: "configured",
		lastTestedAt: null,
		secrets: { secret_key: "sk_test_original", webhook_secret: "whsec_rotated" },
	});

	await configureStripe(testEnv, "92", "sandbox", {
		secret_key: "sk_test_rotated",
		webhook_secret: "whsec_replaced",
		application_origin: "https://app.example.test",
	});
	expect((await storedConnection("92")).secrets).toEqual({
		secret_key: "sk_test_rotated",
		webhook_secret: "whsec_replaced",
	});
});

test("a replacement secret must still match the environment and Stripe's format", async () => {
	await expect(
		configureStripe(testEnv, "92", "sandbox", {
			secret_key: "sk_live_wrong_environment",
			application_origin: "https://app.example.test",
		}),
	).rejects.toMatchObject({ code: "stripe_credentials_invalid" });
	await expect(
		configureStripe(testEnv, "92", "sandbox", {
			webhook_secret: "not-a-signing-secret",
			application_origin: "https://app.example.test",
		}),
	).rejects.toMatchObject({ code: "stripe_credentials_invalid" });
	await expect(
		configureStripe(testEnv, "92", "sandbox", { application_origin: "ftp://app.example.test" }),
	).rejects.toMatchObject({ code: "stripe_origin_invalid" });
	expect((await storedConnection("92")).secrets).toEqual({
		secret_key: "sk_test_rotated",
		webhook_secret: "whsec_replaced",
	});
});

test("the first Stripe configuration still needs both secrets", async () => {
	for (const input of [
		{ application_origin: "https://app.example.test" },
		{ secret_key: "sk_test_only", application_origin: "https://app.example.test" },
		{ webhook_secret: "whsec_only", application_origin: "https://app.example.test" },
	])
		await expect(configureStripe(testEnv, "93", "sandbox", input)).rejects.toMatchObject({
			code: "stripe_credentials_invalid",
		});
	expect(await stripeConnectionStatus(testEnv, "93", "sandbox")).toMatchObject({
		configured: false,
	});
});

test("the Stripe settings give the full webhook URL on the domain that receives provider notifications", async () => {
	const domains = { API_DOMAIN: "api.example.com", SDK_DOMAIN: "sdk.example.com" };

	expect(
		await stripeConnectionStatus(
			{ ...testEnv, ...domains, AUTH_DOMAIN: "auth.example.com" },
			"91",
			"sandbox",
		),
	).toMatchObject({
		webhook_path: "/api/v2/purchases/providers/webhooks/stripe/sandbox/91",
		webhook_url: "https://api.example.com/api/v2/purchases/providers/webhooks/stripe/sandbox/91",
	});
	expect(
		await stripeConnectionStatus(
			{ ...testEnv, ...domains, AUTH_DOMAIN: "sdk.example.com" },
			"91",
			"production",
		),
	).toMatchObject({
		webhook_url: "https://sdk.example.com/v1/monetization/webhooks/stripe/production/91",
	});
	expect(
		await stripeConnectionStatus(
			{ ...testEnv, API_DOMAIN: "", SDK_DOMAIN: "", AUTH_DOMAIN: "" },
			"91",
			"sandbox",
		),
	).toMatchObject({
		webhook_path: "/api/v2/purchases/providers/webhooks/stripe/sandbox/91",
		webhook_url: null,
	});
});
