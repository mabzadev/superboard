import { env, SELF, introspectWorkflowInstance } from "cloudflare:test";
import { expect, test } from "vitest";

test("a real Workflow waits without business writes while disabled and resumes exactly once on activation", async () => {
	const binding = Reflect.get(env, "FLOW_DELAY_EXECUTION") as Workflow<{ key: string }>;
	const key = crypto.randomUUID();
	const headers = {
		Origin: "https://site.example",
		"X-EmDash-Request": "1",
		"X-Parity-Operator": "1",
	};
	const toggle = (action: string) =>
		SELF.fetch(
			`https://site.example/_emdash/api/superboard/plugins/supbrd-plugmod-flows/${action}`,
			{ method: "POST", headers },
		);
	expect((await toggle("enable")).status).toBe(201);
	expect((await toggle("disable")).status).toBe(201);
	await env.DB.exec("CREATE TABLE plugin_workflow_effects (id TEXT PRIMARY KEY)");
	await using inspector = await introspectWorkflowInstance(binding, key);
	await binding.create({ id: key, params: { key } });
	const checkpoint = await inspector.waitForStepResult({ name: "persist-business-operation" });
	expect(checkpoint).toMatchObject({ outcome: "paused" });
	expect(
		await env.DB.prepare("SELECT COUNT(*) AS count FROM plugin_workflow_effects").first(),
	).toEqual({ count: 0 });
	expect(
		await env.DB.prepare(
			"SELECT workflow_id FROM superboard_plugin_workflow_waiters WHERE workflow_id=?",
		)
			.bind(key)
			.first(),
	).not.toBeNull();
	expect((await toggle("enable")).status).toBe(201);
	await inspector.waitForStatus("complete");
	expect(await inspector.getOutput()).toEqual({ id: key });
	expect((await toggle("enable")).status).toBe(200);
	expect(await env.DB.prepare("SELECT id FROM plugin_workflow_effects").all()).toMatchObject({
		results: [{ id: key }],
	});
});
