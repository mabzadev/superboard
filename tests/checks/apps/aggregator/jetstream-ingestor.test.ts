import { MockJetstream } from "@emdash-cms/atproto-test-utils/jetstream";
import { PROFILE_NSID, RELEASE_NSID } from "@emdash-cms/atproto-test-utils/nsid";
import { describe, expect, it } from "vitest";

import type { RecordsJob } from "../../../../apps/aggregator/src/env.js";
import type {
	JetstreamClient,
	JetstreamSubscribeOptions,
	JetstreamSubscriptionHandle,
} from "../../../../apps/aggregator/src/jetstream-client.js";
import {
	JetstreamIngestor,
	type IngestorStorage,
	type JobQueue,
} from "../../../../apps/aggregator/src/jetstream-ingestor.js";

const TEST_DID = "did:plc:test00000000000000000000";

class InMemoryQueue implements JobQueue {
	readonly jobs: RecordsJob[] = [];
	send(job: RecordsJob): Promise<void> {
		this.jobs.push(job);
		return Promise.resolve();
	}
}

class MapStorage implements IngestorStorage {
	private readonly map = new Map<string, number>();
	get(key: string): Promise<number | undefined> {
		return Promise.resolve(this.map.get(key));
	}
	put(key: string, value: number): Promise<void> {
		this.map.set(key, value);
		return Promise.resolve();
	}
}

class MockJetstreamClient implements JetstreamClient {
	constructor(private readonly stream: MockJetstream) {}
	subscribe(opts: JetstreamSubscribeOptions): JetstreamSubscriptionHandle {
		return this.stream.subscribe({
			wantedCollections: [...opts.wantedCollections],
			...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
		});
	}
}

interface Harness {
	stream: MockJetstream;
	queue: InMemoryQueue;
	storage: MapStorage;
	ingestor: JetstreamIngestor;
	runPromise: Promise<void>;
}

function buildHarness(opts: { wantedCollections?: readonly string[] } = {}): Harness {
	const stream = new MockJetstream();
	const queue = new InMemoryQueue();
	const storage = new MapStorage();
	const ingestor = new JetstreamIngestor({
		client: new MockJetstreamClient(stream),
		queue,
		storage,
		wantedCollections: opts.wantedCollections ?? [PROFILE_NSID, RELEASE_NSID],
		backoff: { initialDelayMs: 1, maxDelayMs: 5, multiplier: 2, jitter: 0 },
		sleep: () => Promise.resolve(),
	});
	const runPromise = ingestor.run();
	return { stream, queue, storage, ingestor, runPromise };
}

async function waitFor(predicate: () => boolean, label: string, attempts = 200): Promise<void> {
	for (let i = 0; i < attempts; i++) {
		if (predicate()) return;
		await Promise.resolve();
		await new Promise<void>((r) => setTimeout(r, 0));
	}
	throw new Error(`waitFor timed out: ${label}`);
}

describe("JetstreamIngestor", () => {
	it("converts a commit create event into a RecordsJob and enqueues it", async () => {
		const h = buildHarness();
		const event = h.stream.emitCommit({
			did: TEST_DID,
			collection: PROFILE_NSID,
			rkey: "p",
			cid: "bafyrecord",
			record: { slug: "p", license: "MIT" },
		});

		await waitFor(() => h.queue.jobs.length === 1, "first job enqueued");

		expect(h.queue.jobs[0]).toEqual({
			did: TEST_DID,
			collection: PROFILE_NSID,
			rkey: "p",
			operation: "create",
			cid: "bafyrecord",
			jetstreamRecord: { slug: "p", license: "MIT" },
		});
		expect(h.ingestor.currentCursor).toBe(event.time_us);

		h.ingestor.stop();
		await h.runPromise;
	});

	it("persists cursor to storage after each successful enqueue", async () => {
		const h = buildHarness();
		const e1 = h.stream.emitCommit({
			did: TEST_DID,
			collection: PROFILE_NSID,
			rkey: "a",
		});
		const e2 = h.stream.emitCommit({
			did: TEST_DID,
			collection: PROFILE_NSID,
			rkey: "b",
		});

		await waitFor(() => h.queue.jobs.length === 2, "both jobs enqueued");

		expect(await h.storage.get("jetstream:cursor")).toBe(e2.time_us);
		expect(e2.time_us).toBeGreaterThan(e1.time_us);

		h.ingestor.stop();
		await h.runPromise;
	});

	it("resumes from the persisted cursor on a fresh ingestor", async () => {
		const stream = new MockJetstream();
		const queue = new InMemoryQueue();
		const storage = new MapStorage();
		const earlier = stream.emitCommit({
			did: TEST_DID,
			collection: PROFILE_NSID,
			rkey: "earlier",
		});
		const later = stream.emitCommit({
			did: TEST_DID,
			collection: PROFILE_NSID,
			rkey: "later",
		});

		await storage.put("jetstream:cursor", earlier.time_us);

		const ingestor = new JetstreamIngestor({
			client: new MockJetstreamClient(stream),
			queue,
			storage,
			wantedCollections: [PROFILE_NSID, RELEASE_NSID],
			backoff: { initialDelayMs: 1, maxDelayMs: 5, multiplier: 2, jitter: 0 },
			sleep: () => Promise.resolve(),
		});
		const runPromise = ingestor.run();

		await waitFor(() => queue.jobs.length === 1, "later event enqueued");

		expect(queue.jobs).toHaveLength(1);
		expect(queue.jobs[0]?.rkey).toBe("later");
		expect(ingestor.currentCursor).toBe(later.time_us);

		ingestor.stop();
		await runPromise;
	});

	it("seeds cursor from cursorFloor when storage is empty", async () => {
		const stream = new MockJetstream();
		const queue = new InMemoryQueue();
		const storage = new MapStorage();
		const floorTimeUs = 1_700_000_000_000_000;
		let calls = 0;

		const ingestor = new JetstreamIngestor({
			client: new MockJetstreamClient(stream),
			queue,
			storage,
			wantedCollections: [PROFILE_NSID],
			backoff: { initialDelayMs: 1, maxDelayMs: 5, multiplier: 2, jitter: 0 },
			sleep: () => Promise.resolve(),
			cursorFloor: () => {
				calls += 1;
				return Promise.resolve(floorTimeUs);
			},
		});
		const runPromise = ingestor.run();

		await waitFor(() => ingestor.currentCursor === floorTimeUs, "floor adopted by ingestor");
		expect(calls).toBe(1);
		expect(await storage.get("jetstream:cursor")).toBe(floorTimeUs);

		ingestor.stop();
		await runPromise;
	});

	it("ignores cursorFloor when storage already has a cursor (no override)", async () => {
		const stream = new MockJetstream();
		const queue = new InMemoryQueue();
		const storage = new MapStorage();
		const persisted = 2_000_000_000_000_000;
		await storage.put("jetstream:cursor", persisted);
		let floorCalled = false;

		const ingestor = new JetstreamIngestor({
			client: new MockJetstreamClient(stream),
			queue,
			storage,
			wantedCollections: [PROFILE_NSID],
			backoff: { initialDelayMs: 1, maxDelayMs: 5, multiplier: 2, jitter: 0 },
			sleep: () => Promise.resolve(),
			cursorFloor: () => {
				floorCalled = true;
				return Promise.resolve(1_000_000_000_000_000);
			},
		});
		const runPromise = ingestor.run();
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(floorCalled).toBe(false);
		expect(ingestor.currentCursor).toBe(persisted);

		ingestor.stop();
		await runPromise;
	});

	it("falls back to subscription default when cursorFloor returns null", async () => {
		const stream = new MockJetstream();
		const queue = new InMemoryQueue();
		const storage = new MapStorage();

		const ingestor = new JetstreamIngestor({
			client: new MockJetstreamClient(stream),
			queue,
			storage,
			wantedCollections: [PROFILE_NSID],
			backoff: { initialDelayMs: 1, maxDelayMs: 5, multiplier: 2, jitter: 0 },
			sleep: () => Promise.resolve(),
			cursorFloor: () => Promise.resolve(null),
		});
		const runPromise = ingestor.run();
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(ingestor.currentCursor).toBeNull();
		expect(await storage.get("jetstream:cursor")).toBeUndefined();

		ingestor.stop();
		await runPromise;
	});

	it("handles delete operations (no record body, empty cid)", async () => {
		const h = buildHarness();
		h.stream.emit({
			did: TEST_DID,
			time_us: Date.now() * 1000,
			kind: "commit",
			commit: {
				rev: "rev-del",
				collection: PROFILE_NSID,
				rkey: "p",
				operation: "delete",
			},
		});

		await waitFor(() => h.queue.jobs.length === 1, "delete job enqueued");

		expect(h.queue.jobs[0]).toEqual({
			did: TEST_DID,
			collection: PROFILE_NSID,
			rkey: "p",
			operation: "delete",
			cid: "",
		});
		expect(h.queue.jobs[0]?.jetstreamRecord).toBeUndefined();

		h.ingestor.stop();
		await h.runPromise;
	});

	it("filters events outside wantedCollections (defence in depth)", async () => {
		const h = buildHarness({ wantedCollections: [PROFILE_NSID] });
		h.stream.emitCommit({
			did: TEST_DID,
			collection: RELEASE_NSID,
			rkey: "ignored:1.0.0",
		});
		h.stream.emitCommit({
			did: TEST_DID,
			collection: PROFILE_NSID,
			rkey: "kept",
		});

		await waitFor(() => h.queue.jobs.length === 1, "filtered job enqueued");

		expect(h.queue.jobs).toHaveLength(1);
		expect(h.queue.jobs[0]?.rkey).toBe("kept");

		h.ingestor.stop();
		await h.runPromise;
	});

	it("stop() ends the run loop cleanly", async () => {
		const h = buildHarness();
		h.stream.emitCommit({ did: TEST_DID, collection: PROFILE_NSID, rkey: "p" });
		await waitFor(() => h.queue.jobs.length === 1, "first job");

		h.ingestor.stop();
		await expect(h.runPromise).resolves.toBeUndefined();
	});

	it("consecutiveFailures stays 0 across disconnect-with-events cycles", async () => {
		const stream = new MockJetstream();
		const queue = new InMemoryQueue();
		const storage = new MapStorage();
		const ingestor = new JetstreamIngestor({
			client: new MockJetstreamClient(stream),
			queue,
			storage,
			wantedCollections: [PROFILE_NSID],
			backoff: { initialDelayMs: 1, maxDelayMs: 5, multiplier: 2, jitter: 0 },
			sleep: () => Promise.resolve(),
		});
		const runPromise = ingestor.run();

		for (let i = 0; i < 3; i++) {
			stream.emitCommit({ did: TEST_DID, collection: PROFILE_NSID, rkey: `r${i}` });
			await waitFor(() => queue.jobs.length === i + 1, `event ${i}`);
			stream.closeAll();
			await new Promise<void>((r) => setTimeout(r, 5));
			expect(ingestor.consecutiveFailures).toBe(0);
		}

		ingestor.stop();
		await runPromise;
	});

	it("resets backoff after a successful event, even across reconnects", async () => {
		const stream = new MockJetstream();
		const queue = new InMemoryQueue();
		const storage = new MapStorage();
		const sleeps: number[] = [];
		const ingestor = new JetstreamIngestor({
			client: new MockJetstreamClient(stream),
			queue,
			storage,
			wantedCollections: [PROFILE_NSID],
			backoff: { initialDelayMs: 10, maxDelayMs: 1000, multiplier: 10, jitter: 0 },
			sleep: (ms) => {
				sleeps.push(ms);
				return Promise.resolve();
			},
		});
		const runPromise = ingestor.run();

		stream.emitCommit({ did: TEST_DID, collection: PROFILE_NSID, rkey: "a" });
		await waitFor(() => queue.jobs.length === 1, "first job");
		stream.closeAll();
		await waitFor(() => sleeps.length >= 1, "first backoff");

		stream.emitCommit({ did: TEST_DID, collection: PROFILE_NSID, rkey: "b" });
		await waitFor(() => queue.jobs.length === 2, "second job", 500);
		stream.closeAll();
		await waitFor(() => sleeps.length >= 2, "second backoff", 500);

		expect(sleeps[0]).toBe(10);
		expect(sleeps[1]).toBe(10);

		ingestor.stop();
		await runPromise;
	});

	it("computes exponential backoff with cap, no jitter for determinism", async () => {
		const stream = new MockJetstream();
		const queue = new InMemoryQueue();
		const storage = new MapStorage();
		const sleeps: number[] = [];
		const ingestor = new JetstreamIngestor({
			client: new MockJetstreamClient(stream),
			queue,
			storage,
			wantedCollections: [PROFILE_NSID],
			backoff: { initialDelayMs: 10, maxDelayMs: 80, multiplier: 2, jitter: 0 },
			sleep: (ms) => {
				sleeps.push(ms);
				return Promise.resolve();
			},
		});
		const runPromise = ingestor.run();

		stream.emitCommit({ did: TEST_DID, collection: PROFILE_NSID, rkey: "a" });
		await waitFor(() => queue.jobs.length === 1, "first job");
		stream.closeAll();

		stream.emitCommit({ did: TEST_DID, collection: PROFILE_NSID, rkey: "b" });
		await waitFor(() => queue.jobs.length === 2, "post-reconnect job", 500);

		expect(sleeps.length).toBeGreaterThanOrEqual(1);
		expect(sleeps[0]).toBeGreaterThanOrEqual(10);
		expect(sleeps[0]).toBeLessThanOrEqual(80);

		ingestor.stop();
		await runPromise;
	});
});
