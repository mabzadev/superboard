import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { runDueSchedules } from "../../../../../../packages/plugins/superboard-data/worker/src/functions/runtime";
import { jsonOf, operator, sdk } from "./helpers";

const HELLO = `
export default {
	async fetch(request, env) {
		console.log("hello from", env.GREETING);
		return Response.json({
			user: request.headers.get("x-superboard-user-id"),
			role: request.headers.get("x-superboard-role"),
			spoofed: request.headers.get("x-internal-token"),
			greeting: env.GREETING,
			secret: env.API_TOKEN,
			path: new URL(request.url).pathname,
			query: new URL(request.url).searchParams.get("q"),
		});
	},
	async scheduled(controller) {
		console.log("tick", controller.cron);
	},
};
`;

type Run = { trigger: string; outcome: string; logs: { level: string; message: string }[] };

async function deploy(name: string, body: Record<string, unknown>) {
	const response = await operator(`/functions/${name}`, { method: "PUT", body });
	expect(response.status).toBe(200);
	return jsonOf<{ active_version: number; secret_names: string[]; vars: Record<string, string> }>(
		response,
	);
}

async function runs(name: string): Promise<Run[]> {
	await new Promise((resolve) => {
		setTimeout(resolve, 50);
	});
	return (await jsonOf<{ items: Run[] }>(await operator(`/functions/${name}/runs`))).items;
}

describe("Functions", () => {
	it("deploys a function with variables and write-only secrets", async () => {
		const deployed = await deploy("hello", {
			source: HELLO,
			access: "authenticated",
			vars: { GREETING: "bonjour" },
			secrets: { API_TOKEN: "s3cr3t" },
		});
		expect(deployed).toMatchObject({
			active_version: 1,
			vars: { GREETING: "bonjour" },
			secret_names: ["API_TOKEN"],
		});
		const details = await operator("/functions/hello");
		const text = await details.text();
		expect(text).toContain("hello from");
		expect(text).not.toContain("s3cr3t");
	});

	it("runs the function as the calling user and records its logs", async () => {
		const response = await sdk("/v1/functions/hello/greet?q=1", {
			user: "alice",
			headers: { "x-superboard-user-id": "mallory" },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("x-superboard-logs")).toBeNull();
		expect(response.headers.get("x-superboard-run-id")).toBeTruthy();
		expect(await response.json()).toEqual({
			user: "alice",
			role: "authenticated",
			spoofed: null,
			greeting: "bonjour",
			secret: "s3cr3t",
			path: "/greet",
			query: "1",
		});
		const [run] = await runs("hello");
		expect(run).toMatchObject({
			trigger: "http",
			outcome: "ok",
			logs: [{ level: "log", message: "hello from bonjour" }],
		});
	});

	it("enforces the access level of a function", async () => {
		const anonymous = await sdk("/v1/functions/hello");
		expect(anonymous.status).toBe(401);
		await deploy("hello", { access: "service" });
		expect((await sdk("/v1/functions/hello", { user: "alice" })).status).toBe(403);
		await deploy("hello", { access: "public" });
		expect((await sdk("/v1/functions/hello")).status).toBe(200);
	});

	it("keeps versions and rolls back", async () => {
		const second = await deploy("hello", {
			source: "export default { fetch: () => new Response('v2') }",
		});
		expect(second.active_version).toBe(2);
		expect(await (await sdk("/v1/functions/hello")).text()).toBe("v2");
		const rolledBack = await operator("/functions/hello/rollback", {
			method: "POST",
			body: { version: 1 },
		});
		expect(await jsonOf(rolledBack)).toMatchObject({ active_version: 1 });
		expect(await (await sdk("/v1/functions/hello")).json()).toMatchObject({ greeting: "bonjour" });
	});

	it("reports failures and timeouts", async () => {
		await deploy("broken", {
			source: "export default { async fetch() { throw new Error('boom'); } }",
			access: "public",
		});
		const failed = await sdk("/v1/functions/broken");
		expect(failed.status).toBe(500);
		const [run] = await runs("broken");
		expect(run?.outcome).toBe("error");
		expect(run?.logs[0]?.message).toContain("boom");

		await deploy("slow", {
			source:
				"export default { async fetch() { await new Promise((resolve) => setTimeout(resolve, 5000)); return new Response('late'); } }",
			access: "public",
			timeout_ms: 1000,
		});
		const timedOut = await sdk("/v1/functions/slow");
		expect(timedOut.status).toBe(504);
		expect(await jsonOf(timedOut)).toMatchObject({ error: { code: "function_timeout" } });
	});

	it("invokes a function from the console", async () => {
		const response = await operator("/functions/hello/invoke", {
			method: "POST",
			body: { method: "GET", path: "/console" },
		});
		expect(await jsonOf(response)).toMatchObject({
			status: 200,
			logs: [{ level: "log", message: "hello from bonjour" }],
		});
	});

	it("runs due schedules once", async () => {
		const scheduled = await operator("/functions/hello/schedule", {
			method: "PUT",
			body: { cron: "*/5 * * * *" },
		});
		expect(await jsonOf(scheduled)).toMatchObject({ cron: "*/5 * * * *", enabled: true });
		await env.DB.prepare("UPDATE data_function_schedules SET next_run_at = ? WHERE name = 'hello'")
			.bind(new Date(Date.now() - 60_000).toISOString())
			.run();
		expect(await runDueSchedules(env)).toBe(1);
		expect(await runDueSchedules(env)).toBe(0);
		const [run] = await runs("hello");
		expect(run).toMatchObject({
			trigger: "schedule",
			outcome: "ok",
			logs: [{ message: "tick */5 * * * *" }],
		});
	});

	it("rejects invalid deployments", async () => {
		for (const [name, body, code] of [
			["Bad_Name", { source: "x" }, "function_name_invalid"],
			["empty", {}, "function_source_required"],
			["vars", { source: "x", vars: { lower: "x" } }, "variable_name_invalid"],
			["reserved", { source: "x", vars: { SUPERBOARD_API_URL: "x" } }, "variable_name_invalid"],
		] as const)
			expect(
				await jsonOf(await operator(`/functions/${name}`, { method: "PUT", body })),
			).toMatchObject({
				error: { code },
			});
		expect(
			await jsonOf(
				await operator("/functions/hello/schedule", {
					method: "PUT",
					body: { cron: "61 * * * *" },
				}),
			),
		).toMatchObject({
			error: { code: "cron_invalid" },
		});
	});
});
