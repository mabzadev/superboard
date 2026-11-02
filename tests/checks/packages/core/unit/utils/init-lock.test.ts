import { describe, expect, it } from "vitest";

import {
	createInitLock,
	initWithLock,
} from "../../../../../../packages/core/src/utils/init-lock.js";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function neverSettles<T>(): Promise<T> {
	return new Promise<T>(() => {});
}

describe("initWithLock", () => {
	it("returns the cached value without calling init", async () => {
		const lock = createInitLock();
		let initCalls = 0;
		const result = await initWithLock(
			lock,
			() => "cached",
			async () => {
				initCalls++;
				return "fresh";
			},
		);
		expect(result).toBe("cached");
		expect(initCalls).toBe(0);
	});

	it("runs init once and shares the result with concurrent waiters", async () => {
		const lock = createInitLock();
		let cache: string | null = null;
		let initCalls = 0;
		const init = async () => {
			initCalls++;
			await sleep(50);
			cache = "value";
			return "value";
		};
		const opts = { pollMs: 10 };
		const results = await Promise.all(
			Array.from({ length: 5 }, () => initWithLock(lock, () => cache, init, opts)),
		);
		expect(results).toEqual(["value", "value", "value", "value", "value"]);
		expect(initCalls).toBe(1);
	});

	it("reclaims the lock after the deadline when the owner is abandoned", async () => {
		const lock = createInitLock();
		let cache: string | null = null;

		void initWithLock(
			lock,
			() => cache,
			() => neverSettles<string>(),
			{
				deadlineMs: 100,
				pollMs: 10,
			},
		);
		expect(lock.ownerStartedAt).not.toBeNull();

		await sleep(120);

		const result = await initWithLock(
			lock,
			() => cache,
			async () => {
				cache = "recovered";
				return "recovered";
			},
			{ deadlineMs: 100, pollMs: 10, maxWaitMs: 1000 },
		);
		expect(result).toBe("recovered");
	});

	it("releases the lock when init throws so the next caller can retry", async () => {
		const lock = createInitLock();
		let cache: string | null = null;

		await expect(
			initWithLock(
				lock,
				() => cache,
				() => Promise.reject(new Error("boom")),
				{ pollMs: 10 },
			),
		).rejects.toThrow("boom");
		expect(lock.ownerStartedAt).toBeNull();

		const result = await initWithLock(
			lock,
			() => cache,
			async () => {
				cache = "ok";
				return "ok";
			},
			{ pollMs: 10 },
		);
		expect(result).toBe("ok");
	});

	it("gives up after maxWaitMs instead of waiting forever", async () => {
		const lock = createInitLock();

		void initWithLock(
			lock,
			() => null,
			() => neverSettles<string>(),
			{
				deadlineMs: 60_000,
				pollMs: 10,
			},
		);

		await expect(
			initWithLock(
				lock,
				() => null,
				async () => "late",
				{
					deadlineMs: 60_000,
					pollMs: 10,
					maxWaitMs: 100,
				},
			),
		).rejects.toThrow(/timed out/i);
	});

	it("reclaims from a live-but-slow owner without running init more than twice", async () => {
		const lock = createInitLock();
		let cache: string | null = null;
		let initCalls = 0;

		const owner = initWithLock(
			lock,
			() => cache,
			async () => {
				initCalls++;
				await sleep(250);
				cache = "slow-owner";
				return "slow-owner";
			},
			{ deadlineMs: 100, pollMs: 10, maxWaitMs: 2000 },
		);
		await sleep(10);
		const waiter = initWithLock(
			lock,
			() => cache,
			async () => {
				initCalls++;
				cache = "reclaimer";
				return "reclaimer";
			},
			{ deadlineMs: 100, pollMs: 10, maxWaitMs: 2000 },
		);

		expect(await owner).toBe("slow-owner");
		expect(await waiter).toBe("reclaimer");
		expect(initCalls).toBe(2);

		expect(cache).toBe("slow-owner");
		const third = await initWithLock(
			lock,
			() => cache,
			async () => {
				initCalls++;
				return "third";
			},
			{ deadlineMs: 100, pollMs: 10 },
		);
		expect(third).toBe(cache);
		expect(initCalls).toBe(2);
	});

	it("gates publication so a reclaimed slow owner cannot overwrite the reclaimer's value", async () => {
		const lock = createInitLock();
		let cache: string | null = null;
		const claimChecks: boolean[] = [];

		const makeInit = (value: string, delayMs: number) => async (isCurrentClaim: () => boolean) => {
			await sleep(delayMs);
			const current = isCurrentClaim();
			claimChecks.push(current);
			if (current) cache = value;
			return value;
		};

		const owner = initWithLock(lock, () => cache, makeInit("slow-owner", 250), {
			deadlineMs: 100,
			pollMs: 10,
			maxWaitMs: 2000,
		});
		await sleep(10);
		const reclaimer = initWithLock(lock, () => cache, makeInit("reclaimer", 50), {
			deadlineMs: 100,
			pollMs: 10,
			maxWaitMs: 2000,
		});

		expect(await owner).toBe("slow-owner");
		expect(await reclaimer).toBe("reclaimer");
		expect(cache).toBe("reclaimer");
		expect(claimChecks).toEqual([true, false]);
	});

	it("does not let a finished stale owner release the reclaimer's lock", async () => {
		const lock = createInitLock();
		let cache: string | null = null;
		let initCalls = 0;
		const opts = { deadlineMs: 300, pollMs: 20, maxWaitMs: 3000 };

		const ownerA = initWithLock(
			lock,
			() => cache,
			async () => {
				initCalls++;
				await sleep(400);
				throw new Error("slow failure");
			},
			opts,
		).catch((error: unknown) => error);

		await sleep(20);
		const reclaimerB = initWithLock(
			lock,
			() => cache,
			async () => {
				initCalls++;
				await sleep(200);
				cache = "reclaimer";
				return "reclaimer";
			},
			opts,
		);

		await sleep(420);
		const lateC = initWithLock(
			lock,
			() => cache,
			async () => {
				initCalls++;
				cache = "late";
				return "late";
			},
			opts,
		);

		expect(await reclaimerB).toBe("reclaimer");
		expect(await lateC).toBe("reclaimer");
		expect(await ownerA).toBeInstanceOf(Error);
		expect(initCalls).toBe(2);
	});

	it("anchors the in-flight init promise and swallows its rejection", async () => {
		const lock = createInitLock();
		const anchored: Promise<void>[] = [];

		await expect(
			initWithLock(
				lock,
				() => null,
				() => Promise.reject(new Error("boom")),
				{
					pollMs: 10,
					anchor: (promise) => anchored.push(promise),
				},
			),
		).rejects.toThrow("boom");

		expect(anchored).toHaveLength(1);
		await expect(anchored[0]).resolves.toBeUndefined();
	});

	it("lets a waiter pick up a value cached by the owner mid-wait", async () => {
		const lock = createInitLock();
		let cache: string | null = null;

		const owner = initWithLock(
			lock,
			() => cache,
			async () => {
				await sleep(40);
				cache = "owner-value";
				return "owner-value";
			},
			{ pollMs: 10 },
		);
		await sleep(5);
		const waiter = initWithLock(
			lock,
			() => cache,
			async () => "waiter-value",
			{ pollMs: 10, maxWaitMs: 1000 },
		);
		expect(await owner).toBe("owner-value");
		expect(await waiter).toBe("owner-value");
	});
});
