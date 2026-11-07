import { signProjectContext, type InternalProjectContext } from "@superboard/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import app from "../../../../../../packages/plugins/superboard-acquisition/dynamic-links/src/index";

describe("dynamic-links worker", () => {
	it("publishes a versioned health endpoint", async () => {
		const response = await app.request("/internal/v1/health", {}, healthyEnv());
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({
			data: {
				service: "dynamic-links",
				version: "v1",
				status: "ok",
				storage: "d1",
				schema: schema(),
			},
		});
	});

	it("reports D1 failures without leaking their message", async () => {
		const response = await app.request(
			"/internal/v1/health",
			{},
			env({
				prepare: () => ({
					first: async () => {
						throw new Error("private database error");
					},
				}),
			} as unknown as D1Database),
		);
		expect(response.status).toBe(503);
		const body = await response.text();
		expect(body).toContain('"status":"degraded"');
		expect(body).toContain('"reason":"database_health_unavailable"');
		expect(body).not.toContain("private database error");
	});

	it("rejects unsigned project traffic", async () => {
		const response = await app.request(
			"/internal/v1/missing",
			{ headers: { "x-internal-token": "secret", "x-project-id": "12" } },
			env(),
		);
		expect(response.status).toBe(403);
	});

	it("accepts a canonical signed project context", async () => {
		const issuedAt = Math.floor(Date.now() / 1_000);
		const context: InternalProjectContext = {
			module: "dynamic-links",
			method: "GET",
			pathname: "/internal/v1/missing",
			projectId: 12,
			projectRef: "10-test",
			instanceId: 10,
			environment: "test",
			actorId: 2,
			role: "owner",
			requestId: "dynamic-request",
			issuedAt,
		};
		const response = await app.request(
			context.pathname,
			{ headers: await headers(context) },
			env(),
		);
		expect(response.status).toBe(404);
	});
});

describe("dynamic-links domain verification", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("does not mark a domain verified when its DNS record is missing", async () => {
		const database = recordingDatabase();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ Status: 3 })),
		);
		const response = await verify(database.db);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ data: { id: "domain-1", verified: false } });
		expect(database.queries.some((query) => query.includes("status='verified'"))).toBe(false);
	});

	it("marks a domain verified once its TXT record holds the verification token", async () => {
		const database = recordingDatabase();
		const lookup = vi.fn(async () =>
			Response.json({
				Status: 0,
				Answer: [{ name: "_superboard.links.example.com", type: 16, data: '"token-1"' }],
			}),
		);
		vi.stubGlobal("fetch", lookup);
		const response = await verify(database.db);
		expect(await response.json()).toEqual({
			data: {
				id: "domain-1",
				verified: true,
				status: "verified",
				check: {
					result: "verified",
					record: { type: "TXT", name: "_superboard.links.example.com", value: "token-1" },
					found: ["token-1"],
				},
			},
		});
		expect(
			database.queries.some(
				(query) =>
					query.includes("status='verified'") &&
					query.includes("dns_verified_at=CURRENT_TIMESTAMP"),
			),
		).toBe(true);
		const [url, init] = lookup.mock.calls[0] as unknown as [string, RequestInit];
		expect(new URL(url).searchParams.get("name")).toBe("_superboard.links.example.com");
		expect(new URL(url).searchParams.get("type")).toBe("TXT");
		expect(new Headers(init.headers).get("accept")).toBe("application/dns-json");
	});

	it("reports the values it found when the TXT record does not match", async () => {
		const database = recordingDatabase();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ Status: 0, Answer: [{ type: 16, data: '"old-token"' }] })),
		);
		const response = await verify(database.db);
		expect(await response.json()).toMatchObject({
			data: {
				verified: false,
				status: "pending",
				check: { result: "mismatch", found: ["old-token"] },
			},
		});
		expect(database.queries.some((query) => query.includes("status='verified'"))).toBe(false);
	});
});

async function verify(database: D1Database) {
	const pathname = "/internal/v1/domains/domain-1/verify";
	const context: InternalProjectContext = {
		module: "dynamic-links",
		method: "POST",
		pathname,
		projectId: 12,
		projectRef: "10-test",
		instanceId: 10,
		environment: "test",
		actorId: 2,
		role: "owner",
		requestId: "verify-request",
		issuedAt: Math.floor(Date.now() / 1_000),
	};
	return app.request(
		pathname,
		{
			method: "POST",
			headers: {
				...(await headers(context)),
				"content-type": "application/json",
				"idempotency-key": crypto.randomUUID(),
			},
			body: JSON.stringify({ verified: true }),
		},
		env(database),
	);
}
function recordingDatabase() {
	const queries: string[] = [];
	const statement = (query: string) => {
		const result = {
			first: async () =>
				query.includes("FROM domains")
					? {
							id: "domain-1",
							hostname: "links.example.com",
							status: "pending",
							verification_token: "token-1",
						}
					: null,
			run: async () => ({ meta: { changes: 1 } }),
			all: async () => ({ results: [] }),
		};
		return { ...result, bind: () => result };
	};
	const db = {
		prepare: (query: string) => {
			queries.push(query);
			return statement(query);
		},
		batch: async () => [],
	} as unknown as D1Database;
	return { db, queries };
}
async function headers(context: InternalProjectContext) {
	return {
		"x-internal-token": "secret",
		"x-project-id": String(context.projectId),
		"x-project-ref": context.projectRef,
		"x-instance-id": String(context.instanceId),
		"x-environment": context.environment,
		"x-actor-id": String(context.actorId),
		"x-role": context.role,
		"x-request-id": context.requestId,
		"x-context-issued-at": String(context.issuedAt),
		"x-context-version": "1",
		"x-context-signature": await signProjectContext(context, "secret"),
	};
}
function env(database = {} as D1Database): Env {
	return {
		DB: database,
		D1_EXPECTED_MIGRATION: "0003_campaign_analytics.sql",
		INTERNAL_API_TOKEN: "secret",
	};
}
function healthyEnv(): Env {
	return env({
		prepare: (query: string) => {
			const first = async () =>
				query.includes("superboard_health_check")
					? { superboard_health_check: 1 }
					: {
							applied_migration_count: 3,
							expected_migration_applied: 1,
							latest_migration: "0003_campaign_analytics.sql",
						};
			return { first, bind: () => ({ first }) };
		},
	} as unknown as D1Database);
}
function schema() {
	return {
		status: "current",
		expectedMigration: "0003_campaign_analytics.sql",
		latestMigration: "0003_campaign_analytics.sql",
		appliedMigrationCount: 3,
	};
}
