import { describe, expect, test } from "vitest";

import {
	recentOperatorReauthentication,
	requireReleaseOperator,
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
				instance_id: "vocostar",
				candidate_id: "candidate-1",
				action: "front_release.approve",
				now,
			},
		);
		expect(receipt).toMatchObject({
			operator_id: "operator-1",
			instance_id: "vocostar",
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
					instance_id: "vocostar",
					candidate_id: "candidate-1",
					action: "front_release.approve",
					now,
				},
			),
		).toBeNull();
	});
});
