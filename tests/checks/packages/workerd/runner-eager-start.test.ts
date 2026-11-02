import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { WorkerdSandboxRunner } from "../../../../packages/workerd/src/sandbox/runner.js";

describe("scheduleEagerStart error handling", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("logs and triggers scheduleRestart when ensureRunning rejects", async () => {
		const runner = new WorkerdSandboxRunner({ db: null as any });
		const startError = new Error("simulated startup failure");

		vi.spyOn(runner as any, "ensureRunning").mockRejectedValue(startError);
		const scheduleRestartSpy = vi
			.spyOn(runner as any, "scheduleRestart")
			.mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await runner.load(
			{
				id: "test-plugin",
				name: "test",
				version: "1.0.0",
				capabilities: [],
				storage: {},
			} as any,
			"export default {};",
		);

		await vi.advanceTimersByTimeAsync(60);

		expect(errorSpy).toHaveBeenCalled();
		const firstCall = errorSpy.mock.calls[0];
		expect(String(firstCall?.[0])).toContain("[emdash:workerd] eager start failed");
		expect(firstCall?.[1]).toBe(startError);

		expect(scheduleRestartSpy).toHaveBeenCalledTimes(1);

		try {
			await runner.terminateAll();
		} catch {}
	});
});
