import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
	WorkerdSandboxRunner,
	waitForProcessExit,
} from "../../../../packages/workerd/src/sandbox/runner.js";

interface FakeProc extends EventEmitter {
	exitCode: number | null;
	kill: ReturnType<typeof vi.fn>;
}

function makeFakeProc(): FakeProc {
	const proc = new EventEmitter() as FakeProc;
	proc.exitCode = null;
	proc.kill = vi.fn();
	return proc;
}

describe("waitForProcessExit", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("clears the SIGKILL timer when the process exits cleanly", async () => {
		const fake = makeFakeProc();

		const stopPromise = waitForProcessExit(fake as unknown as ChildProcess);

		expect(fake.kill).toHaveBeenCalledWith("SIGTERM");

		await vi.advanceTimersByTimeAsync(100);
		fake.emit("exit");
		await stopPromise;

		expect(vi.getTimerCount()).toBe(0);

		await vi.advanceTimersByTimeAsync(5_000);
		expect(fake.kill).toHaveBeenCalledTimes(1);
		expect(fake.kill).not.toHaveBeenCalledWith("SIGKILL");
	});

	it("sends SIGKILL when the process does not exit within the timeout", async () => {
		const fake = makeFakeProc();

		const stopPromise = waitForProcessExit(fake as unknown as ChildProcess);
		expect(fake.kill).toHaveBeenCalledWith("SIGTERM");

		await vi.advanceTimersByTimeAsync(5_000);
		expect(fake.kill).toHaveBeenCalledWith("SIGKILL");

		fake.emit("exit");
		await stopPromise;
	});

	it("respects a custom timeout", async () => {
		const fake = makeFakeProc();
		const stopPromise = waitForProcessExit(fake as unknown as ChildProcess, 1_000);

		await vi.advanceTimersByTimeAsync(999);
		expect(fake.kill).not.toHaveBeenCalledWith("SIGKILL");

		await vi.advanceTimersByTimeAsync(1);
		expect(fake.kill).toHaveBeenCalledWith("SIGKILL");

		fake.emit("exit");
		await stopPromise;
	});
});

describe("stopWorkerd timer cleanup", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("clears the SIGKILL timer when the process exits cleanly", async () => {
		const runner = new WorkerdSandboxRunner({ db: null as any });
		const fake = makeFakeProc();
		(runner as any).workerdProcess = fake;

		const stopPromise = (runner as any).stopWorkerd() as Promise<void>;
		expect(fake.kill).toHaveBeenCalledWith("SIGTERM");

		await vi.advanceTimersByTimeAsync(100);
		fake.emit("exit");
		await stopPromise;

		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(fake.kill).not.toHaveBeenCalledWith("SIGKILL");
	});

	it("fast-paths when exitCode is already set", async () => {
		const runner = new WorkerdSandboxRunner({ db: null as any });
		const fake = makeFakeProc();
		fake.exitCode = 0;
		(runner as any).workerdProcess = fake;

		await (runner as any).stopWorkerd();

		expect(fake.kill).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});
