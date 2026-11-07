import { expect, test, vi } from "vitest";

const active = vi.hoisted(() => new Set<string>());

vi.mock("@superboard/contracts/plugin-task", async (importOriginal) => ({
	...(await importOriginal<typeof import("@superboard/contracts/plugin-task")>()),
	runPluginTask: vi.fn(
		async (_env: unknown, plugin: string, _lease: unknown, run: () => Promise<unknown>) =>
			active.has(plugin) ? { ran: true, value: await run() } : { ran: false },
	),
}));

const { app } = await import("../../../../../../../packages/plugins/superboard-core/api/src/index.js");

async function admission(path: string) {
	const response = await app.request(`https://api.test${path}`, {}, {});
	const body: unknown = await response.json().catch(() => null);
	return { status: response.status, body };
}

test.each([
	["/api/v1/data/database/projects/p/tables", "superboard-database"],
	["/api/v1/data/storage/projects/p/buckets", "superboard-storage"],
	["/api/v1/data/functions/projects/p/functions", "superboard-functions"],
	["/api/v1/data/vectors/projects/p/vector-collections", "superboard-vectors"],
	["/api/v1/app-data/db/todos", "superboard-database"],
	["/api/v1/app-data/storage/buckets", "superboard-storage"],
	["/api/v1/app-data/functions/hello", "superboard-functions"],
	["/api/v1/app-data/vectors/notes/query", "superboard-vectors"],
])("%s opens only while %s is active", async (path, owner) => {
	active.clear();
	for (const plugin of [
		"superboard-database",
		"superboard-storage",
		"superboard-functions",
		"superboard-vectors",
		"superboard-files",
	])
		if (plugin !== owner) active.add(plugin);
	expect(await admission(path)).toMatchObject({
		status: 404,
		body: { error: { code: "PLUGIN_NOT_ACTIVE" } },
	});
	active.clear();
	active.add(owner);
	expect(await admission(path)).not.toMatchObject({ body: { error: { code: "PLUGIN_NOT_ACTIVE" } } });
});
