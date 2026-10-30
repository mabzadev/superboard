import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it, vi, onTestFinished } from "vitest";

import {
	AccountErasureError,
	eraseApplicationAccount,
} from "../../../../../../../packages/plugins/superboard-core/api/src/lib/account-erasure";
import type { Env } from "../../../../../../../packages/plugins/superboard-core/api/src/types";
import { sqliteD1 } from "../../helpers/sqlite-d1.js";

describe("application account erasure coordinator", () => {
	it("erases every configured subject store and revokes Identity last", async () => {
		const logger = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const database = erasureDatabase();
		const calls: Array<{ service: string; request: Request }> = [];
		const environment = erasureEnv(database.db, calls);

		const result = await eraseApplicationAccount(
			environment,
			project(),
			"application-user-1",
			"request-1",
		);

		expect(result).toMatchObject({
			status: "completed",
			completedSteps: [
				"core_collection",
				"app",
				"analytics",
				"marketing",
				"support",
				"custom",
				"billing",
				"identity",
			],
		});
		expect(calls.map(({ service }) => service)).toEqual(
			result.completedSteps.filter((step) => step !== "core_collection"),
		);
		expect(calls.at(-1)?.service).toBe("identity");
		expect(calls[0].request.headers.get("x-project-ref")).toBe("10-test");
		expect(calls[0].request.headers.get("x-context-signature")).toMatch(/^[A-Za-z0-9_-]+$/u);
		expect(calls[4].request.headers.get("x-custom-worker-subject")).toBe("application-user-1");
		expect(database.row?.application_user_id).toBeNull();
		expect(database.row?.status).toBe("completed");
		const completionLog = logger.mock.calls
			.flat()
			.map(String)
			.find((entry) => entry.includes("application_account_erasure_completed"));
		expect(completionLog).toContain(String(database.row?.application_user_hash).slice(0, 12));
		expect(completionLog).not.toContain("application-user-1");
		expect(completionLog).not.toContain(String(database.row?.application_user_hash));
		logger.mockRestore();
	});

	it("persists completed steps and resumes without replaying them after a dependency failure", async () => {
		const database = erasureDatabase();
		const calls: Array<{ service: string; request: Request }> = [];
		let marketingAvailable = false;
		const environment = erasureEnv(database.db, calls, (service) =>
			service === "marketing" && !marketingAvailable
				? Response.json({ error: "unavailable" }, { status: 503 })
				: Response.json({ data: { erased: true } }),
		);

		await expect(
			eraseApplicationAccount(environment, project(), "application-user-2", "request-2"),
		).rejects.toMatchObject<AccountErasureError>({
			code: "marketing_erasure_failed",
			service: "marketing",
		});
		expect(database.row?.status).toBe("failed");
		expect(JSON.parse(database.row?.completed_steps_json || "[]")).toEqual([
			"core_collection",
			"app",
			"analytics",
		]);

		marketingAvailable = true;
		calls.length = 0;
		const resumed = await eraseApplicationAccount(
			environment,
			project(),
			"application-user-2",
			"request-2-retry",
		);
		expect(resumed.status).toBe("completed");
		expect(calls.map(({ service }) => service)).toEqual([
			"marketing",
			"support",
			"custom",
			"billing",
			"identity",
		]);
	});
});

function project() {
	return {
		projectId: 12,
		instanceId: 10,
		projectRef: "10-test",
		environment: "test" as const,
	};
}

function erasureEnv(
	db: D1Database,
	calls: Array<{ service: string; request: Request }>,
	response: (service: string) => Response = () => Response.json({ data: { erased: true } }),
): Env {
	const fetcher = (service: string) => ({
		fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request(input, init);
			calls.push({ service, request });
			return response(service);
		}),
	});
	return {
		DB: db,
		MODULE_INTERNAL_TOKEN: "module-secret",
		CUSTOM_WORKER_TOKEN: "custom-secret",
		APP_MODULE: fetcher("app"),
		ANALYTICS_MODULE: fetcher("analytics"),
		MARKETING_MODULE: fetcher("marketing"),
		SUPPORT_MODULE: fetcher("support"),
		CUSTOM_WORKER: fetcher("custom"),
		BILLING: fetcher("billing"),
		IDENTITY_SERVICE: fetcher("identity"),
	} as unknown as Env;
}

function erasureDatabase() {
	type Row = {
		id: string;
		project_id: number;
		instance_id: number;
		project_ref: string;
		application_user_id: string | null;
		application_user_hash: string;
		status: "processing" | "failed" | "completed";
		completed_steps_json: string;
		lease_id: string | null;
		lease_expires_at: string | null;
	};
	const sqlite = new DatabaseSync(":memory:");
	onTestFinished(() => sqlite.close());
	const migrations = new URL(
		"../../../../../../../packages/plugins/superboard-core/api/migrations/",
		import.meta.url,
	);
	for (const file of readdirSync(migrations)
		.filter((file) => file.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b)))
		sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
	sqlite.exec(
		"INSERT INTO instances(id,api_key,uri_scheme) VALUES(10,'erasure-test','test'); INSERT INTO projects(id,instance_id,is_test,name,identifier) VALUES(12,10,1,'Test','test');",
	);
	return {
		db: sqliteD1(sqlite) as unknown as D1Database,
		get row() {
			return sqlite.prepare("SELECT * FROM application_account_erasures LIMIT 1").get() as
				| Row
				| undefined;
		},
	};
}
