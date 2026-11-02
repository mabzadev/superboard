import { JetstreamSubscription } from "@atcute/jetstream";

export interface JetstreamCommitEvent {
	did: `did:${string}:${string}`;
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

export interface JetstreamSubscribeOptions {
	wantedCollections: readonly string[];
	cursor?: number;
}

export interface JetstreamSubscriptionHandle extends AsyncIterable<JetstreamCommitEvent> {
	readonly cursor: number;
	close(): void;
}

export interface JetstreamClient {
	subscribe(opts: JetstreamSubscribeOptions): JetstreamSubscriptionHandle;
}

export class RealJetstreamClient implements JetstreamClient {
	constructor(private readonly url: string) {}

	subscribe(opts: JetstreamSubscribeOptions): JetstreamSubscriptionHandle {
		const sub = new JetstreamSubscription({
			url: this.url,
			wantedCollections: [...opts.wantedCollections],
			...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
		});
		return wrapAtcuteSubscription(sub);
	}
}

export interface RawJetstreamSubscription<E extends { kind: string }> extends AsyncIterable<E> {
	readonly cursor: number;
}

export function wrapAtcuteSubscription<E extends { kind: string }>(
	sub: RawJetstreamSubscription<E>,
): JetstreamSubscriptionHandle {
	let inner: AsyncIterator<E> | null = null;
	let resolveClosed: (() => void) | null = null;
	const closedSignal = new Promise<void>((resolve) => {
		resolveClosed = resolve;
	});
	const fireClosed = () => {
		if (resolveClosed) {
			const r = resolveClosed;
			resolveClosed = null;
			r();
		}
	};

	return {
		get cursor() {
			return sub.cursor;
		},
		close: () => {
			fireClosed();
			inner?.return?.()?.catch(() => {});
		},
		[Symbol.asyncIterator](): AsyncIterator<JetstreamCommitEvent> {
			inner ??= sub[Symbol.asyncIterator]();
			const it = inner;
			return {
				async next(): Promise<IteratorResult<JetstreamCommitEvent>> {
					for (;;) {
						const result = await Promise.race([
							it.next(),
							closedSignal.then((): IteratorResult<E> => ({ value: undefined, done: true })),
						]);
						if (result.done) return { value: undefined, done: true };
						const event = result.value;
						if (isCommitEvent(event)) {
							return { value: event, done: false };
						}
					}
				},
				async return(): Promise<IteratorResult<JetstreamCommitEvent>> {
					fireClosed();
					await it.return?.();
					return { value: undefined, done: true };
				},
			};
		},
	};
}

type MaybeCommitEvent = {
	kind: string;
	commit?: {
		collection?: unknown;
		rkey?: unknown;
		operation?: unknown;
		cid?: unknown;
	};
};

const KNOWN_OPERATIONS = new Set(["create", "update", "delete"]);

function isCommitEvent(event: MaybeCommitEvent): event is JetstreamCommitEvent {
	if (event.kind !== "commit" || event.commit === undefined) return false;
	const c = event.commit;
	if (typeof c.collection !== "string" || typeof c.rkey !== "string") return false;
	if (typeof c.operation !== "string" || !KNOWN_OPERATIONS.has(c.operation)) return false;
	if (c.operation !== "delete" && typeof c.cid !== "string") return false;
	return true;
}
