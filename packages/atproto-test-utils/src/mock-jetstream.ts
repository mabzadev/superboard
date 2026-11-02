import type { AtprotoDid } from "./types.js";

export interface JetstreamCommitEvent {
	did: AtprotoDid;
	time_us: number;
	kind: "commit";
	commit:
		| {
				rev: string;
				collection: string;
				rkey: string;
				operation: "create" | "update";
				cid: string;
				record: Record<string, unknown>;
		  }
		| {
				rev: string;
				collection: string;
				rkey: string;
				operation: "delete";
		  };
}

export type JetstreamEvent = JetstreamCommitEvent;

interface ActiveSubscriber {
	id: string;
	wantedCollections: ReadonlySet<string> | null;
	wantedDids: ReadonlySet<AtprotoDid> | null;
	queue: JetstreamEvent[];
	resolve: (() => void) | null;
	closed: boolean;
	lastDeliveredTimeUs: number;
}

export interface MockJetstreamSubscribeOptions {
	wantedCollections?: string[];
	wantedDids?: AtprotoDid[];
	cursor?: number;
}

export interface MockJetstreamSubscription extends AsyncIterable<JetstreamEvent> {
	readonly id: string;
	readonly cursor: number;
	close(): void;
}

export class MockJetstream {
	private history: JetstreamEvent[] = [];
	private subscribers = new Map<string, ActiveSubscriber>();
	private nextSubId = 0;
	private timeUs = Date.now() * 1000;

	emit(event: JetstreamEvent): void {
		this.history.push(event);
		for (const sub of this.subscribers.values()) {
			if (sub.closed) continue;
			if (!subscriberWants(sub, event)) continue;
			sub.queue.push(event);
			if (sub.resolve) {
				const r = sub.resolve;
				sub.resolve = null;
				r();
			}
		}
	}

	emitCommit(args: {
		did: AtprotoDid;
		collection: string;
		rkey: string;
		operation?: "create" | "update";
		cid?: string;
		record?: Record<string, unknown>;
		rev?: string;
	}): JetstreamCommitEvent {
		this.timeUs += 1;
		const event: JetstreamCommitEvent = {
			did: args.did,
			time_us: this.timeUs,
			kind: "commit",
			commit: {
				rev: args.rev ?? generateRev(),
				collection: args.collection,
				rkey: args.rkey,
				operation: args.operation ?? "create",
				cid: args.cid ?? "bafyreigfakecidplaceholder0000000000000000000000000",
				record: args.record ?? {},
			},
		};
		this.emit(event);
		return event;
	}

	subscribe(opts: MockJetstreamSubscribeOptions = {}): MockJetstreamSubscription {
		const id = String(++this.nextSubId);
		const sub: ActiveSubscriber = {
			id,
			wantedCollections: opts.wantedCollections ? new Set(opts.wantedCollections) : null,
			wantedDids: opts.wantedDids ? new Set(opts.wantedDids) : null,
			queue: [],
			resolve: null,
			closed: false,
			lastDeliveredTimeUs: 0,
		};
		const cursor = opts.cursor ?? 0;
		for (const event of this.history) {
			if (event.time_us <= cursor) continue;
			if (!subscriberWants(sub, event)) continue;
			sub.queue.push(event);
		}
		this.subscribers.set(id, sub);

		const subscribers = this.subscribers;
		const iterable: MockJetstreamSubscription = {
			id,
			get cursor() {
				return sub.lastDeliveredTimeUs;
			},
			close: () => {
				sub.closed = true;
				subscribers.delete(id);
				if (sub.resolve) {
					const r = sub.resolve;
					sub.resolve = null;
					r();
				}
			},
			[Symbol.asyncIterator]: () => ({
				async next() {
					while (true) {
						const event = sub.queue.shift();
						if (event) {
							sub.lastDeliveredTimeUs = event.time_us;
							return { value: event, done: false };
						}
						if (sub.closed) return { value: undefined, done: true };
						if (sub.resolve !== null) {
							throw new Error(
								"MockJetstreamSubscription.next() called concurrently from two consumers; this is not supported",
							);
						}
						await new Promise<void>((resolve) => {
							sub.resolve = resolve;
						});
					}
				},
				async return() {
					iterable.close();
					return { value: undefined, done: true };
				},
			}),
		};
		return iterable;
	}

	closeSubscriber(id: string): void {
		const sub = this.subscribers.get(id);
		if (sub) {
			sub.closed = true;
			this.subscribers.delete(id);
			if (sub.resolve) {
				const r = sub.resolve;
				sub.resolve = null;
				r();
			}
		}
	}

	closeAll(): void {
		for (const sub of this.subscribers.values()) {
			sub.closed = true;
			if (sub.resolve) {
				const r = sub.resolve;
				sub.resolve = null;
				r();
			}
		}
		this.subscribers.clear();
	}
}

function subscriberWants(sub: ActiveSubscriber, event: JetstreamEvent): boolean {
	if (sub.wantedDids && !sub.wantedDids.has(event.did)) return false;
	if (sub.wantedCollections) {
		if (event.kind === "commit" && !sub.wantedCollections.has(event.commit.collection))
			return false;
	}
	return true;
}

function generateRev(): string {
	return `rev-${Math.random().toString(36).slice(2, 12)}`;
}
