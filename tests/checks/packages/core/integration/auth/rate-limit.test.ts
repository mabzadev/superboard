import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	handleDeviceCodeRequest,
	handleDeviceTokenExchange,
} from "../../../../../../packages/core/src/api/handlers/device-flow.js";
import {
	checkRateLimit,
	cleanupExpiredRateLimits,
	getClientIp,
} from "../../../../../../packages/core/src/auth/rate-limit.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { setupTestDatabase } from "../../utils/test-db.js";

let db: Kysely<Database>;

beforeEach(async () => {
	db = await setupTestDatabase();
});

afterEach(async () => {
	await db.destroy();
});

describe("checkRateLimit", () => {
	it("should allow requests within the limit", async () => {
		const result1 = await checkRateLimit(db, "1.2.3.4", "test/endpoint", 3, 60);
		expect(result1.allowed).toBe(true);
		expect(result1.count).toBe(1);

		const result2 = await checkRateLimit(db, "1.2.3.4", "test/endpoint", 3, 60);
		expect(result2.allowed).toBe(true);
		expect(result2.count).toBe(2);

		const result3 = await checkRateLimit(db, "1.2.3.4", "test/endpoint", 3, 60);
		expect(result3.allowed).toBe(true);
		expect(result3.count).toBe(3);
	});

	it("should reject requests exceeding the limit", async () => {
		await checkRateLimit(db, "1.2.3.4", "test/endpoint", 3, 60);
		await checkRateLimit(db, "1.2.3.4", "test/endpoint", 3, 60);
		await checkRateLimit(db, "1.2.3.4", "test/endpoint", 3, 60);

		const result = await checkRateLimit(db, "1.2.3.4", "test/endpoint", 3, 60);
		expect(result.allowed).toBe(false);
		expect(result.count).toBe(4);
		expect(result.limit).toBe(3);
	});

	it("should track limits per IP independently", async () => {
		await checkRateLimit(db, "1.2.3.4", "test/endpoint", 2, 60);
		await checkRateLimit(db, "1.2.3.4", "test/endpoint", 2, 60);
		const resultA = await checkRateLimit(db, "1.2.3.4", "test/endpoint", 2, 60);
		expect(resultA.allowed).toBe(false);

		const resultB = await checkRateLimit(db, "5.6.7.8", "test/endpoint", 2, 60);
		expect(resultB.allowed).toBe(true);
		expect(resultB.count).toBe(1);
	});

	it("should track limits per endpoint independently", async () => {
		await checkRateLimit(db, "1.2.3.4", "endpoint-a", 1, 60);
		const resultA = await checkRateLimit(db, "1.2.3.4", "endpoint-a", 1, 60);
		expect(resultA.allowed).toBe(false);

		const resultB = await checkRateLimit(db, "1.2.3.4", "endpoint-b", 1, 60);
		expect(resultB.allowed).toBe(true);
	});

	it("should skip rate limiting when IP is null", async () => {
		for (let i = 0; i < 10; i++) {
			const result = await checkRateLimit(db, null, "test/endpoint", 1, 60);
			expect(result.allowed).toBe(true);
			expect(result.count).toBe(0);
		}
	});

	it("should reset after window expires", async () => {
		await checkRateLimit(db, "1.2.3.4", "test/endpoint", 1, 1);
		const blocked = await checkRateLimit(db, "1.2.3.4", "test/endpoint", 1, 1);
		expect(blocked.allowed).toBe(false);

		await new Promise((resolve) => setTimeout(resolve, 1100));

		const allowed = await checkRateLimit(db, "1.2.3.4", "test/endpoint", 1, 1);
		expect(allowed.allowed).toBe(true);
		expect(allowed.count).toBe(1);
	});
});

describe("getClientIp", () => {
	function cfRequest(url: string, init?: RequestInit): Request {
		const req = new Request(url, init);
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- test helper
		(req as unknown as { cf: Record<string, unknown> }).cf = { country: "US" };
		return req;
	}

	it("should extract IP from CF-Connecting-IP on Cloudflare", () => {
		const request = cfRequest("http://localhost/test", {
			headers: { "cf-connecting-ip": "198.51.100.1" },
		});
		expect(getClientIp(request)).toBe("198.51.100.1");
	});

	it("should extract IP from X-Forwarded-For on Cloudflare", () => {
		const request = cfRequest("http://localhost/test", {
			headers: { "x-forwarded-for": "203.0.113.50, 70.41.3.18, 150.172.238.178" },
		});
		expect(getClientIp(request)).toBe("203.0.113.50");
	});

	it("should return null when not on Cloudflare (no cf object)", () => {
		const request = new Request("http://localhost/test");
		expect(getClientIp(request)).toBeNull();
	});

	it("should return null when not on Cloudflare even with XFF header", () => {
		const request = new Request("http://localhost/test", {
			headers: { "x-forwarded-for": "203.0.113.50" },
		});
		expect(getClientIp(request)).toBeNull();
	});

	it("should reject non-IP values in X-Forwarded-For", () => {
		const request = cfRequest("http://localhost/test", {
			headers: { "x-forwarded-for": "<script>alert(1)</script>" },
		});
		expect(getClientIp(request)).toBeNull();
	});

	it("should handle IPv6 addresses on Cloudflare", () => {
		const request = cfRequest("http://localhost/test", {
			headers: { "x-forwarded-for": "2001:db8::1" },
		});
		expect(getClientIp(request)).toBe("2001:db8::1");
	});
});

describe("getClientIp with trusted proxy headers", () => {
	function cfRequest(url: string, init?: RequestInit): Request {
		const req = new Request(url, init);
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- test helper
		(req as unknown as { cf: Record<string, unknown> }).cf = { country: "US" };
		return req;
	}

	it("reads the IP from a declared trusted header off-Cloudflare", () => {
		const request = new Request("http://localhost/test", {
			headers: { "x-real-ip": "203.0.113.50" },
		});
		expect(getClientIp(request, ["x-real-ip"])).toBe("203.0.113.50");
	});

	it("tries trusted headers in declared order", () => {
		const request = new Request("http://localhost/test", {
			headers: {
				"x-real-ip": "203.0.113.50",
				"fly-client-ip": "198.51.100.7",
			},
		});
		expect(getClientIp(request, ["fly-client-ip", "x-real-ip"])).toBe("198.51.100.7");
	});

	it("falls through when earlier trusted header is missing", () => {
		const request = new Request("http://localhost/test", {
			headers: { "x-real-ip": "203.0.113.50" },
		});
		expect(getClientIp(request, ["fly-client-ip", "x-real-ip"])).toBe("203.0.113.50");
	});

	it("takes the first entry when a trusted header is XFF-style", () => {
		const request = new Request("http://localhost/test", {
			headers: { "x-forwarded-for": "203.0.113.50, 10.0.0.1" },
		});
		expect(getClientIp(request, ["x-forwarded-for"])).toBe("203.0.113.50");
	});

	it("rejects non-IP-shaped values from trusted headers", () => {
		const request = new Request("http://localhost/test", {
			headers: { "x-real-ip": "<script>alert(1)</script>" },
		});
		expect(getClientIp(request, ["x-real-ip"])).toBeNull();
	});

	it("does not read from headers that are not on the trusted list", () => {
		const request = new Request("http://localhost/test", {
			headers: { "x-client-ip": "203.0.113.50" },
		});
		expect(getClientIp(request, ["x-real-ip"])).toBeNull();
	});

	it("without cf, returns null when no trusted header is set", () => {
		const request = new Request("http://localhost/test", {
			headers: { "x-real-ip": "203.0.113.50" },
		});
		expect(getClientIp(request, [])).toBeNull();
	});

	it("matches header names case-insensitively", () => {
		const request = new Request("http://localhost/test", {
			headers: { "X-Real-IP": "203.0.113.50" },
		});
		expect(getClientIp(request, ["x-real-ip"])).toBe("203.0.113.50");
	});

	it("CF-Connecting-IP wins over trusted headers on Cloudflare", () => {
		const request = cfRequest("http://localhost/test", {
			headers: {
				"cf-connecting-ip": "1.1.1.1",
				"x-real-ip": "203.0.113.50",
			},
		});
		expect(getClientIp(request, ["x-real-ip"])).toBe("1.1.1.1");
	});

	it("trusted headers fill in when the CF path produces no IP", () => {
		const request = cfRequest("http://localhost/test", {
			headers: { "x-real-ip": "203.0.113.50" },
		});
		expect(getClientIp(request, ["x-real-ip"])).toBe("203.0.113.50");
	});
});

describe("cleanupExpiredRateLimits", () => {
	it("should delete expired entries", async () => {
		const oldWindow = new Date(Date.now() - 7200 * 1000).toISOString();
		const currentWindow = new Date(Math.floor(Date.now() / (60 * 1000)) * 60 * 1000).toISOString();

		await db
			.insertInto("_emdash_rate_limits")
			.values([
				{ key: "old:entry", window: oldWindow, count: 5 },
				{ key: "current:entry", window: currentWindow, count: 2 },
			])
			.execute();

		const deleted = await cleanupExpiredRateLimits(db, 3600);
		expect(deleted).toBe(1);

		const rows = await db.selectFrom("_emdash_rate_limits").selectAll().execute();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.key).toBe("current:entry");
	});
});

describe("Device Token Exchange: slow_down enforcement", () => {
	const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

	it("should return slow_down when polling faster than interval", async () => {
		const codeResult = await handleDeviceCodeRequest(
			db,
			{ client_id: "emdash-cli" },
			"https://example.com/_emdash/device",
		);
		expect(codeResult.success).toBe(true);
		if (!codeResult.success) return;

		const { device_code } = codeResult.data;

		const poll1 = await handleDeviceTokenExchange(db, {
			device_code,
			grant_type: GRANT_TYPE,
		});
		expect(poll1.success).toBe(false);
		expect(poll1.deviceFlowError).toBe("authorization_pending");

		const poll2 = await handleDeviceTokenExchange(db, {
			device_code,
			grant_type: GRANT_TYPE,
		});
		expect(poll2.success).toBe(false);
		expect(poll2.deviceFlowError).toBe("slow_down");
		expect(poll2.deviceFlowInterval).toBe(10);
	});

	it("should increase interval by 5s on each slow_down", async () => {
		const codeResult = await handleDeviceCodeRequest(
			db,
			{ client_id: "emdash-cli" },
			"https://example.com/_emdash/device",
		);
		expect(codeResult.success).toBe(true);
		if (!codeResult.success) return;

		const { device_code } = codeResult.data;

		await handleDeviceTokenExchange(db, { device_code, grant_type: GRANT_TYPE });

		await handleDeviceTokenExchange(db, { device_code, grant_type: GRANT_TYPE });

		const row = await db
			.selectFrom("_emdash_device_codes")
			.select("interval")
			.where("device_code", "=", device_code)
			.executeTakeFirst();

		expect(row?.interval).toBe(10);

		await handleDeviceTokenExchange(db, { device_code, grant_type: GRANT_TYPE });

		const row2 = await db
			.selectFrom("_emdash_device_codes")
			.select("interval")
			.where("device_code", "=", device_code)
			.executeTakeFirst();

		expect(row2?.interval).toBe(15);
	});

	it("should cap slow_down interval at 60 seconds", async () => {
		const codeResult = await handleDeviceCodeRequest(
			db,
			{ client_id: "emdash-cli" },
			"https://example.com/_emdash/device",
		);
		expect(codeResult.success).toBe(true);
		if (!codeResult.success) return;

		const { device_code } = codeResult.data;

		await handleDeviceTokenExchange(db, { device_code, grant_type: GRANT_TYPE });

		await db
			.updateTable("_emdash_device_codes")
			.set({ interval: 58 })
			.where("device_code", "=", device_code)
			.execute();

		const poll = await handleDeviceTokenExchange(db, { device_code, grant_type: GRANT_TYPE });
		expect(poll.deviceFlowInterval).toBe(60);

		const row = await db
			.selectFrom("_emdash_device_codes")
			.select("interval")
			.where("device_code", "=", device_code)
			.executeTakeFirst();

		expect(row?.interval).toBe(60);
	});

	it("should not return slow_down when polling at or above the interval", async () => {
		const codeResult = await handleDeviceCodeRequest(
			db,
			{ client_id: "emdash-cli" },
			"https://example.com/_emdash/device",
		);
		expect(codeResult.success).toBe(true);
		if (!codeResult.success) return;

		const { device_code } = codeResult.data;

		await handleDeviceTokenExchange(db, { device_code, grant_type: GRANT_TYPE });

		await db
			.updateTable("_emdash_device_codes")
			.set({
				last_polled_at: new Date(Date.now() - 10_000).toISOString(),
			})
			.where("device_code", "=", device_code)
			.execute();

		const poll = await handleDeviceTokenExchange(db, {
			device_code,
			grant_type: GRANT_TYPE,
		});
		expect(poll.success).toBe(false);
		expect(poll.deviceFlowError).toBe("authorization_pending");
	});
});
