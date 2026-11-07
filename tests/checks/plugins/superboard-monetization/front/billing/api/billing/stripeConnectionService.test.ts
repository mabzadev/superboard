import { beforeEach, expect, it, vi } from "vitest";

const requests = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock(
	"../../../../../../../../packages/plugins/superboard-monetization/src/front/billing/transport.js",
	() => ({
		DELETE: vi.fn(),
		GET: requests.get,
		PATCH: vi.fn(),
		POST: vi.fn(),
		PUT: vi.fn(),
	}),
);
vi.mock("../../../../../../../../packages/supbrd-front-ui/src/shared/lib/config.js", () => ({
	config: { apiPath: "/api/v1" },
}));

import { getStripeConnection } from "../../../../../../../../packages/plugins/superboard-monetization/src/front/billing/api/billing/billingService.js";

const connection = {
	configured: true,
	environment: "production",
	application_origin: "https://shop.example.com",
	last_tested_at: null,
	webhook_path: "/api/v2/purchases/providers/webhooks/stripe/production/7",
};

beforeEach(() => {
	vi.clearAllMocks();
});

it("keeps the public Stripe webhook URL the service computed", async () => {
	requests.get.mockResolvedValue({
		data: {
			...connection,
			webhook_url: "https://sdk.example.com/v1/monetization/webhooks/stripe/production/7",
		},
	});

	expect(await getStripeConnection("7")).toMatchObject({
		webhook_path: "/api/v2/purchases/providers/webhooks/stripe/production/7",
		webhook_url: "https://sdk.example.com/v1/monetization/webhooks/stripe/production/7",
	});
	expect(requests.get).toHaveBeenCalledWith("/api/v1/billing/7/stripe");
});

it("reads a service that does not send the webhook URL yet", async () => {
	requests.get.mockResolvedValue({ data: connection });

	expect(await getStripeConnection("7")).toMatchObject({ webhook_url: null });
});
