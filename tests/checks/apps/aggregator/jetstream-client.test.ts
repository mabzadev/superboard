import { describe, expect, it } from "vitest";

import {
	wrapAtcuteSubscription,
	type RawJetstreamSubscription,
} from "../../../../apps/aggregator/src/jetstream-client.js";

interface QuiescentEvent {
	kind: string;
}

function quiescentSubscription(): RawJetstreamSubscription<QuiescentEvent> {
	let returned = false;
	const innerIter: AsyncIterator<QuiescentEvent> = {
		next() {
			if (returned) return Promise.resolve({ value: undefined, done: true });
			return new Promise<IteratorResult<QuiescentEvent>>(() => {});
		},
		async return() {
			returned = true;
			return { value: undefined, done: true };
		},
	};
	return {
		cursor: 0,
		[Symbol.asyncIterator]: () => innerIter,
	};
}

describe("wrapAtcuteSubscription", () => {
	it("close() unblocks a for-await waiting on a quiescent subscription", async () => {
		const sub = quiescentSubscription();
		const handle = wrapAtcuteSubscription(sub);

		const consumed: QuiescentEvent[] = [];
		const consumePromise = (async () => {
			for await (const event of handle) {
				consumed.push(event);
			}
		})();

		await Promise.resolve();
		await Promise.resolve();
		await new Promise<void>((r) => setTimeout(r, 0));

		const beforeClose = await Promise.race([
			consumePromise.then(() => "done" as const),
			new Promise<"pending">((r) => setTimeout(r, 10, "pending")),
		]);
		expect(beforeClose).toBe("pending");

		handle.close();

		await expect(
			Promise.race([
				consumePromise.then(() => "done" as const),
				new Promise<"timeout">((r) => setTimeout(r, 100, "timeout")),
			]),
		).resolves.toBe("done");

		expect(consumed).toEqual([]);
	});

	it("filters non-commit events", async () => {
		const events: Array<{
			kind: string;
			commit?: { collection: string; rkey: string; operation: string; cid?: string };
		}> = [
			{ kind: "identity" },
			{
				kind: "commit",
				commit: { collection: "x", rkey: "r1", operation: "create", cid: "bafyc1" },
			},
			{ kind: "account" },
			{
				kind: "commit",
				commit: { collection: "y", rkey: "r2", operation: "create", cid: "bafyc2" },
			},
		];
		let i = 0;
		const sub: RawJetstreamSubscription<(typeof events)[number]> = {
			cursor: 0,
			[Symbol.asyncIterator]: () => ({
				async next() {
					if (i >= events.length) return { value: undefined, done: true };
					const value = events[i++];
					return { value: value as (typeof events)[number], done: false };
				},
			}),
		};
		const handle = wrapAtcuteSubscription(sub);
		const out: unknown[] = [];
		for await (const event of handle) out.push(event);
		expect(out).toHaveLength(2);
		expect(out.every((e) => (e as { kind: string }).kind === "commit")).toBe(true);
	});

	it("rejects commits with missing cid on non-delete operations", async () => {
		const events = [
			{ kind: "commit", commit: { collection: "x", rkey: "r1", operation: "create" } },
			{
				kind: "commit",
				commit: { collection: "x", rkey: "r2", operation: "update" },
			},
		];
		let i = 0;
		const sub: RawJetstreamSubscription<(typeof events)[number]> = {
			cursor: 0,
			[Symbol.asyncIterator]: () => ({
				async next() {
					if (i >= events.length) return { value: undefined, done: true };
					const value = events[i++];
					return { value: value as (typeof events)[number], done: false };
				},
			}),
		};
		const handle = wrapAtcuteSubscription(sub);
		const out: unknown[] = [];
		for await (const event of handle) out.push(event);
		expect(out).toHaveLength(0);
	});

	it("rejects commits whose operation isn't one of create/update/delete", async () => {
		const events = [
			{
				kind: "commit",
				commit: {
					collection: "x",
					rkey: "r1",
					operation: "rebase",
					cid: "bafyc1",
				},
			},
		];
		let i = 0;
		const sub: RawJetstreamSubscription<(typeof events)[number]> = {
			cursor: 0,
			[Symbol.asyncIterator]: () => ({
				async next() {
					if (i >= events.length) return { value: undefined, done: true };
					const value = events[i++];
					return { value: value as (typeof events)[number], done: false };
				},
			}),
		};
		const handle = wrapAtcuteSubscription(sub);
		const out: unknown[] = [];
		for await (const event of handle) out.push(event);
		expect(out).toHaveLength(0);
	});

	it("accepts delete commits without cid", async () => {
		const events = [
			{ kind: "commit", commit: { collection: "x", rkey: "r1", operation: "delete" } },
		];
		let i = 0;
		const sub: RawJetstreamSubscription<(typeof events)[number]> = {
			cursor: 0,
			[Symbol.asyncIterator]: () => ({
				async next() {
					if (i >= events.length) return { value: undefined, done: true };
					const value = events[i++];
					return { value: value as (typeof events)[number], done: false };
				},
			}),
		};
		const handle = wrapAtcuteSubscription(sub);
		const out: unknown[] = [];
		for await (const event of handle) out.push(event);
		expect(out).toHaveLength(1);
	});
});
