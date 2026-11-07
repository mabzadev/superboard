import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { Hono } from "hono";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { sqliteD1 } from "../../helpers/sqlite-d1.js";

const mocks = vi.hoisted(() => ({ getRequestAuthContext: vi.fn() }));

vi.mock("../../../../../../../packages/plugins/superboard-core/api/src/lib/auth", () => ({
	getRequestAuthContext: mocks.getRequestAuthContext,
}));

import { gatewayAdmin } from "../../../../../../../packages/plugins/superboard-core/api/src/routes/gateway-admin";

let sqlite: DatabaseSync;
let env: { DB: ReturnType<typeof sqliteD1> };

function api() {
	const root = new Hono();
	return gatewayAdmin(root, async () => new Response(null, { status: 404 }));
}

function savePolicy(ids: string[], key: string) {
	return api().request(
		"/access-policy",
		{
			method: "POST",
			headers: { "Content-Type": "application/json", "Idempotency-Key": key },
			body: JSON.stringify({ allowed_operator_ids: ids }),
		},
		env,
	);
}

beforeEach(() => {
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec(
		readFileSync(
			new URL(
				"../../../../../../../packages/plugins/superboard-core/api/migrations/0066_gateway_operator.sql",
				import.meta.url,
			),
			"utf8",
		),
	);
	env = { DB: sqliteD1(sqlite) };
	mocks.getRequestAuthContext.mockResolvedValue({
		siteOperator: { instance_id: "instance-1", operator_id: "operator-17" },
	});
});

afterEach(() => {
	sqlite.close();
});

test("the route list returns the stored access policy so the console can keep it", async () => {
	expect((await savePolicy(["operator-17", "operator-42"], "policy-key-1")).status).toBe(200);

	const response = await api().request("/routes", {}, env);

	expect(response.status).toBe(200);
	await expect(response.json()).resolves.toEqual({
		data: [],
		access_policy: { allowed_operator_ids: ["operator-17", "operator-42"], version: 1 },
	});
});

test("an instance without a stored policy reports an empty, unversioned list", async () => {
	const response = await api().request("/routes", {}, env);

	await expect(response.json()).resolves.toEqual({
		data: [],
		access_policy: { allowed_operator_ids: [], version: null },
	});
});
