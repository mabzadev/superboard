import { describe, expect, test } from "vitest";

import { resolveSiteReleaseOperations } from "../../../scripts/cloudflare-site-preview.mjs";
import {
	recentOperatorReauthentication,
	requirePluginOperator,
	requireReleaseOperator,
	withManagedPluginAuthorization,
} from "../src/lib/operator-guard.js";

function context(options: { role?: number; origin?: string; marker?: string } = {}) {
	return {
		locals: options.role === undefined ? {} : { user: { role: options.role } },
		request: new Request("https://site.example/superboard-system/api/releases/compile", {
			method: "POST",
			headers: {
				Origin: options.origin ?? "https://site.example",
				"X-EmDash-Request": options.marker ?? "1",
			},
		}),
		url: new URL("https://site.example/superboard-system/api/releases/compile"),
	} as Parameters<typeof requireReleaseOperator>[0];
}

const disabledEnv = { SUPERBOARD_RELEASE_OPERATIONS: "disabled" } as Parameters<
	typeof requireReleaseOperator
>[1];
const enabledEnv = { SUPERBOARD_RELEASE_OPERATIONS: "enabled" } as Parameters<
	typeof requireReleaseOperator
>[1];

describe("Release operator guard", () => {
	test("a plugin authorization is limited to its operator, instance and candidate", async () => {
		const now = "2026-09-10T08:00:00.000Z";
		const original = {
			...context({ role: 50 }),
			locals: { user: { id: "operator-1", role: 50 } },
			session: { get: async () => undefined },
		} as Parameters<typeof withManagedPluginAuthorization>[0];
		const input = {
			instance_id: "instance-1",
			candidate_id: "candidate-1",
			action: "front_release.approve" as const,
			now,
		};
		expect(await recentOperatorReauthentication(original, input)).toBeNull();
		const authorized = withManagedPluginAuthorization(original, {
			instanceId: input.instance_id,
			candidateId: input.candidate_id,
			operationId: "operation-1",
			verifiedAt: now,
		});
		expect(await recentOperatorReauthentication(authorized, input)).toMatchObject({
			authorization_method: "operator_session",
			operation_id: "operation-1",
			operator_id: "operator-1",
		});
		for (const changed of [
			{ instance_id: "other" },
			{ candidate_id: "other" },
			{ action: "front_release.rollback" as const },
			{ now: "2026-09-10T08:06:00.000Z" },
		]) {
			expect(await recentOperatorReauthentication(authorized, { ...input, ...changed })).toBeNull();
		}
		expect(
			await recentOperatorReauthentication(
				{
					...authorized,
					locals: { ...authorized.locals, user: { ...authorized.locals.user!, id: "other" } },
				},
				input,
			),
		).toBeNull();
		expect(
			await recentOperatorReauthentication(
				{
					...original,
					locals: {
						...original.locals,
						managedPluginAuthorization: { userId: "operator-1", verifiedAt: now },
					},
				} as typeof original,
				input,
			),
		).toBeNull();
		expect(() =>
			withManagedPluginAuthorization(
				{ ...original, request: new Request(original.url, { method: "POST" }) },
				{
					instanceId: "instance-1",
					candidateId: "candidate-1",
					operationId: "operation-1",
					verifiedAt: now,
				},
			),
		).toThrow("PLUGIN_OPERATOR_AUTHORIZATION_REQUIRED");
	});
	test("the operational deployment permits an admin plugin mutation but retains authorization and CSRF checks", () => {
		const operations = resolveSiteReleaseOperations({
			service: "site",
			environment: "development",
			publicRoutesEnabled: true,
		});
		const deployed = { SUPERBOARD_RELEASE_OPERATIONS: operations.value } as Parameters<
			typeof requireReleaseOperator
		>[1];
		expect(requireReleaseOperator(context({ role: 50 }), deployed)).toBeNull();
		expect(requireReleaseOperator(context(), deployed)?.status).toBe(401);
		expect(requireReleaseOperator(context({ role: 40 }), deployed)?.status).toBe(403);
		expect(
			requireReleaseOperator(context({ role: 50, origin: "https://other.example" }), deployed)
				?.status,
		).toBe(403);
	});
	test("allows authenticated operators to inspect plugin Stores without enabling releases", () => {
		expect(requirePluginOperator(context())).toHaveProperty("status", 401);
		expect(requirePluginOperator(context({ role: 40 }))).toHaveProperty("status", 403);
		expect(requirePluginOperator(context({ role: 50 }))).toBeNull();
	});

	test("fails closed before a release mutation can reach D1", async () => {
		expect(requireReleaseOperator(context(), enabledEnv)?.status).toBe(401);
		expect(requireReleaseOperator(context({ role: 40 }), enabledEnv)?.status).toBe(403);
		expect(requireReleaseOperator(context({ role: 50 }), disabledEnv)?.status).toBe(503);
		expect(
			requireReleaseOperator(context({ role: 50, origin: "https://other.example" }), enabledEnv)
				?.status,
		).toBe(403);
		expect(requireReleaseOperator(context({ role: 50 }), enabledEnv)).toBeNull();
	});

	test("accepts only a recent Passkey-backed marker for the same operator", async () => {
		const now = "2026-08-29T18:04:00.000Z";
		const receipt = await recentOperatorReauthentication(
			{
				locals: { user: { id: "operator-1", role: 50 } },
				session: {
					get: async () => ({
						userId: "operator-1",
						verifiedAt: "2026-08-29T18:00:00.000Z",
					}),
				},
			} as Parameters<typeof recentOperatorReauthentication>[0],
			{
				instance_id: "reference-production",
				candidate_id: "candidate-1",
				action: "front_release.approve",
				now,
			},
		);
		expect(receipt).toMatchObject({
			operator_id: "operator-1",
			instance_id: "reference-production",
			action: "front_release.approve",
		});
		expect(receipt?.receipt_checksum).toMatch(/^sha256:[a-f0-9]{64}$/u);

		expect(
			await recentOperatorReauthentication(
				{
					locals: { user: { id: "operator-2", role: 50 } },
					session: {
						get: async () => ({
							userId: "operator-1",
							verifiedAt: "2026-08-29T18:00:00.000Z",
						}),
					},
				} as Parameters<typeof recentOperatorReauthentication>[0],
				{
					instance_id: "reference-production",
					candidate_id: "candidate-1",
					action: "front_release.approve",
					now,
				},
			),
		).toBeNull();
	});
});
