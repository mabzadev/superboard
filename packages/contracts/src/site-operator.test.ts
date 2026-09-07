import { describe, expect, it } from "vitest";

import { signSiteOperatorRequest, verifySiteOperatorRequest } from "./site-operator.js";

describe("Site operator assertions", () => {
	const operator = {
		operator_id: "01J00000000000000000000001",
		instance_id: "independent",
		role: 50,
	};
	const secret = "isolated-site-operator-signing-secret";
	const request = new Request(
		"https://api.internal/api/v1/paywalls/projects/1-prod/paywalls?limit=10",
	);
	it("authenticates an EmDash operator without a historical access token", async () => {
		const headers = await signSiteOperatorRequest(request, operator, secret, 1000);
		expect(
			await verifySiteOperatorRequest(
				new Request(request, { headers }),
				"independent",
				secret,
				1000,
			),
		).toEqual(operator);
	});
	it("rejects another instance, an expired assertion, a forged signature and a changed URL", async () => {
		const headers = await signSiteOperatorRequest(request, operator, secret, 1000);
		const signed = new Request(request, { headers });
		expect(await verifySiteOperatorRequest(signed, "another-instance", secret, 1000)).toBeNull();
		expect(await verifySiteOperatorRequest(signed, "independent", secret, 1061)).toBeNull();
		expect(await verifySiteOperatorRequest(signed, "independent", "wrong", 1000)).toBeNull();
		expect(
			await verifySiteOperatorRequest(
				new Request("https://api.internal/api/v1/paywalls/projects/2-prod/paywalls?limit=10", {
					headers,
				}),
				"independent",
				secret,
				1000,
			),
		).toBeNull();
		expect(
			await verifySiteOperatorRequest(
				new Request(request, { method: "DELETE", headers }),
				"independent",
				secret,
				1000,
			),
		).toBeNull();
	});
});
