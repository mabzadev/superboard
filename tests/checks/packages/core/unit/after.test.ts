import { describe, expect, it, vi } from "vitest";

vi.mock("virtual:emdash/wait-until", () => ({ waitUntil: undefined }), { virtual: true });

import { after } from "../../../../../packages/core/src/after.js";
import { waitForDeferredTasks } from "../../../../../packages/core/src/deferred-tasks.js";

describe("after()", () => {
	it("runs the callback", async () => {
		const fn = vi.fn();
		after(fn);
		await new Promise((r) => setTimeout(r, 0));
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("swallows errors and logs them with the emdash prefix", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const boom = new Error("boom");

		try {
			expect(() =>
				after(async () => {
					throw boom;
				}),
			).not.toThrow();

			await new Promise((r) => setTimeout(r, 0));

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("[emdash] deferred task failed"),
				boom,
			);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it("returns synchronously without waiting for the callback", async () => {
		let ran = false;
		after(async () => {
			await new Promise((r) => setTimeout(r, 10));
			ran = true;
		});
		expect(ran).toBe(false);
	});

	it("exposes deferred work for lifecycle teardown", async () => {
		let settle!: () => void;
		let completed = false;
		after(async () => {
			await new Promise<void>((resolve) => {
				settle = resolve;
			});
			completed = true;
		});
		await Promise.resolve();

		const drained = waitForDeferredTasks();
		await Promise.resolve();
		expect(completed).toBe(false);

		settle();
		await drained;
		expect(completed).toBe(true);
	});
});
