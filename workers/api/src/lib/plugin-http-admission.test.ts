import { Hono } from "hono";
import { expect, test, vi } from "vitest";

import { pluginHttpAdmission } from "./plugin-http-admission.js";

vi.mock("@superboard/contracts/plugin-task", async (importOriginal) => ({
	...(await importOriginal<typeof import("@superboard/contracts/plugin-task")>()),
	runPluginTask: vi.fn(
		async (_env: unknown, plugin: string, _lease: unknown, run: () => Promise<unknown>) =>
			plugin === "supbrd-plugmod-reference-production"
				? { ran: false }
				: { ran: true, value: await run() },
	),
}));

test.each(["/custom/v1/jobs", "/api/v1/sdk/custom/v1/jobs"])(
	"disabled custom plugins stay inaccessible through %s",
	async (path) => {
		const app = new Hono();
		app.use("*", pluginHttpAdmission);
		app.get(path, (c) => c.json({ retainedJobs: true }));
		const response = await app.request(
			`https://api.test${path}`,
			{},
			{ CUSTOM_WORKER_PLUGIN_ID: "supbrd-plugmod-reference-production" },
		);
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ error: { code: "PLUGIN_NOT_ACTIVE" } });
	},
);
