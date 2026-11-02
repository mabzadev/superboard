import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { WorkerdSandboxRunner } from "../../../../packages/workerd/src/sandbox/runner.js";

function stubManifest(id: string) {
	return {
		id,
		name: id,
		version: "1.0.0",
		capabilities: [],
		storage: {},
	} as any;
}

describe("plugin port reclaim", () => {
	let runner: WorkerdSandboxRunner;

	beforeEach(() => {
		vi.useFakeTimers();
		runner = new WorkerdSandboxRunner({ db: null as any });
		vi.spyOn(runner as any, "ensureRunning").mockResolvedValue(undefined);
	});

	afterEach(async () => {
		try {
			await runner.terminateAll();
		} catch {}
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("reuses ports freed by unload", async () => {
		const p1 = await runner.load(stubManifest("a"), "export default {};");
		const p2 = await runner.load(stubManifest("b"), "export default {};");
		const port1 = (p1 as any).port;
		const port2 = (p2 as any).port;
		expect(port2).toBeGreaterThan(port1);

		runner.unloadPlugin("a:1.0.0");

		const p3 = await runner.load(stubManifest("c"), "export default {};");
		const port3 = (p3 as any).port;
		expect(port3).toBe(port1);
	});

	it("does not grow nextPluginPort across repeated load/unload cycles", async () => {
		await runner.load(stubManifest("x"), "export default {};");
		await runner.load(stubManifest("y"), "export default {};");
		runner.unloadPlugin("x:1.0.0");
		runner.unloadPlugin("y:1.0.0");

		const before = (runner as any).nextPluginPort;

		for (let i = 0; i < 10; i++) {
			const p = await runner.load(stubManifest(`p${i}`), "export default {};");
			runner.unloadPlugin(`p${i}:1.0.0`);
			void p;
		}

		const after = (runner as any).nextPluginPort;
		expect(after).toBe(before);
	});
});
