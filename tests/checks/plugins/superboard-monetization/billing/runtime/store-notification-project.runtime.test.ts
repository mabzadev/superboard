import { exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptCredential } from "../../../../../../packages/plugins/superboard-core/api/src/lib/secrets.js";
import iapRoutes from "../../../../../../packages/plugins/superboard-core/api/src/routes/iap.js";
import { billingTestEnv as testEnv } from "./apply-migrations.js";

const instanceId = 43;
const productionProjectId = "431";
const sandboxProjectId = "432";
const coins = "notify.coins";
const billingEnv = { ...testEnv, CREDENTIAL_KEY_SCOPE: "billing" };

type QueuedJob = { projectId: string; productType?: string };

function recordingQueue() {
	const jobs: QueuedJob[] = [];
	return {
		jobs,
		queue: {
			send: async (job: QueuedJob) => {
				jobs.push(job);
			},
		},
	};
}

async function storedWebhookEvent(store: string, externalEventId: string) {
	return testEnv.DB.prepare(
		"SELECT project_id, environment FROM billing_webhook_events WHERE store = ? AND external_event_id = ?",
	)
		.bind(store, externalEventId)
		.first<{ project_id: string; environment: string }>();
}

describe("Legacy store notification routes on D1", () => {
	beforeAll(async () => {
		const { privateKey } = await generateKeyPair("RS256", { extractable: true });
		const credential = await encryptCredential(
			billingEnv,
			JSON.stringify({
				client_email: "billing@notify.test",
				private_key: await exportPKCS8(privateKey),
				token_uri: "https://oauth2.notify.test/token",
			}),
		);
		await testEnv.DB.batch([
			testEnv.DB.prepare(
				"INSERT INTO instances (id, api_key, uri_scheme) VALUES (43, 'notify-instance', 'notify-app')",
			),
			testEnv.DB.prepare(
				`INSERT INTO projects (id, name, identifier, instance_id, is_test)
				 VALUES (431, 'Notify', 'notify-production', 43, 0), (432, 'Notify Test', 'notify-test', 43, 1)`,
			),
			testEnv.DB.prepare(
				"INSERT INTO applications (id, platform, instance_id) VALUES (4301, 'android', 43)",
			),
			testEnv.DB.prepare(
				"INSERT INTO android_configurations (application_id, identifier) VALUES (4301, 'com.superboard.notify')",
			),
			testEnv.DB.prepare(
				"INSERT INTO android_server_api_keys (instance_id, encrypted_key, billing_encrypted_key) VALUES ('43', ?, ?)",
			).bind(credential, credential),
			testEnv.DB.prepare(
				`INSERT INTO billing_products (id, project_id, store, environment, store_product_id, product_type)
				 VALUES ('notify-coins', ?, 'google', 'production', ?, 'consumable')`,
			).bind(productionProjectId, coins),
		]);
	});

	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = input instanceof Request ? input.url : String(input);
				if (url === "https://oauth2.notify.test/token")
					return Response.json({ access_token: "notify-access", expires_in: 3600 });
				return Response.json({ purchaseState: 0, purchaseType: 1, orderId: "GPA.notify-coins" });
			}),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("records a Google RTDN under the project id and queues the configured product type", async () => {
		const { jobs, queue } = recordingQueue();
		const response = await iapRoutes.request(
			`/google/${instanceId}`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Goog-Channel-Token": "notify-channel-token",
				},
				body: JSON.stringify({
					message: {
						messageId: "notify-google-message",
						data: btoa(
							JSON.stringify({
								packageName: "com.superboard.notify",
								eventTimeMillis: "1790000000000",
								oneTimeProductNotification: {
									notificationType: 1,
									purchaseToken: "notify-coins-token",
									sku: coins,
								},
							}),
						),
					},
				}),
			},
			{
				...billingEnv,
				BILLING_QUEUE: queue,
				GOOGLE_PUBSUB_VERIFICATION_TOKEN: "notify-channel-token",
			},
		);

		expect(response.status).toBe(202);
		expect(await storedWebhookEvent("google", "notify-google-message")).toEqual({
			project_id: productionProjectId,
			environment: "production",
		});
		expect(jobs).toEqual([
			expect.objectContaining({ projectId: productionProjectId, productType: "consumable" }),
		]);
	});

	it("records a signed Apple notification under the project id", async () => {
		const { jobs, queue } = recordingQueue();
		const signedPayload = "notify.apple.notification";
		const response = await iapRoutes.request(
			`/apple/test/${instanceId}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ signedPayload }),
			},
			{ ...billingEnv, BILLING_QUEUE: queue },
		);

		expect(response.status).toBe(202);
		const digest = new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signedPayload)),
		);
		const externalEventId = Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join(
			"",
		);
		expect(await storedWebhookEvent("apple", externalEventId)).toEqual({
			project_id: sandboxProjectId,
			environment: "sandbox",
		});
		expect(jobs).toEqual([expect.objectContaining({ projectId: sandboxProjectId })]);
	});
});
