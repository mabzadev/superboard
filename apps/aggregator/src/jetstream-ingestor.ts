import { WANTED_COLLECTIONS } from "./constants.js";
import type { RecordsJob } from "./env.js";
import type {
	JetstreamClient,
	JetstreamCommitEvent,
	JetstreamSubscriptionHandle,
} from "./jetstream-client.js";

const CURSOR_STORAGE_KEY = "jetstream:cursor";

export interface JobQueue {
	send(job: RecordsJob): Promise<unknown>;
}

export interface IngestorStorage {
	get(key: string): Promise<number | undefined>;
	put(key: string, value: number): Promise<void>;
}

export interface IngestorBackoffConfig {
	initialDelayMs?: number;
	maxDelayMs?: number;
	multiplier?: number;
	jitter?: number;
}

export interface IngestorLogger {
	info?(msg: string, ctx?: Record<string, unknown>): void;
	warn?(msg: string, ctx?: Record<string, unknown>): void;
	error?(msg: string, ctx?: Record<string, unknown>): void;
}

export interface JetstreamIngestorOptions {
	client: JetstreamClient;
	queue: JobQueue;
	storage: IngestorStorage;
	wantedCollections?: readonly string[];
	backoff?: IngestorBackoffConfig;
	logger?: IngestorLogger;
	sleep?: (ms: number) => Promise<void>;
	random?: () => number;
	cursorFloor?: () => Promise<number | null>;
}

const DEFAULT_BACKOFF: Required<IngestorBackoffConfig> = {
	initialDelayMs: 1_000,
	maxDelayMs: 60_000,
	multiplier: 2,
	jitter: 0.2,
};

export class JetstreamIngestor {
	private readonly client: JetstreamClient;
	private readonly queue: JobQueue;
	private readonly storage: IngestorStorage;
	private readonly wantedCollections: readonly string[];
	private readonly backoff: Required<IngestorBackoffConfig>;
	private readonly logger: IngestorLogger;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly random: () => number;

	private stopped = false;
	private currentSub: JetstreamSubscriptionHandle | null = null;
	private cursor: number | null = null;
	private madeProgress = false;

	private readonly cursorFloor: (() => Promise<number | null>) | null;

	constructor(opts: JetstreamIngestorOptions) {
		this.client = opts.client;
		this.queue = opts.queue;
		this.storage = opts.storage;
		this.wantedCollections = opts.wantedCollections ?? WANTED_COLLECTIONS;
		this.backoff = { ...DEFAULT_BACKOFF, ...opts.backoff };
		this.logger = opts.logger ?? {};
		this.sleep = opts.sleep ?? defaultSleep;
		this.random = opts.random ?? Math.random;
		this.cursorFloor = opts.cursorFloor ?? null;
	}

	get currentCursor(): number | null {
		return this.cursor;
	}

	async run(): Promise<void> {
		this.cursor = (await this.storage.get(CURSOR_STORAGE_KEY)) ?? null;
		if (this.cursor === null && this.cursorFloor !== null) {
			try {
				const floor = await this.cursorFloor();
				if (floor !== null) {
					this.cursor = floor;
					await this.storage.put(CURSOR_STORAGE_KEY, floor);
					this.logger.info?.("jetstream cursor seeded from D1 floor", { cursor: floor });
				}
			} catch (err) {
				this.logger.warn?.("cursorFloor lookup failed, falling back to subscription default", {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		while (!this.stopped) {
			try {
				await this.connectAndConsume();
				if (this.madeProgress) this._consecutiveFailures = 0;
				else this._consecutiveFailures += 1;
			} catch (err) {
				if (this.madeProgress) this._consecutiveFailures = 0;
				else this._consecutiveFailures += 1;
				this.logger.warn?.("jetstream subscription failed", {
					error: err instanceof Error ? err.message : String(err),
					consecutiveFailures: this._consecutiveFailures,
				});
			}
			if (this.stopped) break;
			await this.sleep(this.computeBackoff(this._consecutiveFailures));
		}
	}

	get consecutiveFailures(): number {
		return this._consecutiveFailures;
	}
	private _consecutiveFailures = 0;

	stop(): void {
		this.stopped = true;
		this.currentSub?.close();
	}

	private async connectAndConsume(): Promise<void> {
		this.madeProgress = false;
		const sub = this.client.subscribe({
			wantedCollections: this.wantedCollections,
			...(this.cursor !== null ? { cursor: this.cursor } : {}),
		});
		this.currentSub = sub;
		try {
			for await (const event of sub) {
				if (this.stopped) break;
				await this.handleEvent(event);
			}
		} finally {
			sub.close();
			if (this.currentSub === sub) this.currentSub = null;
		}
	}

	private async handleEvent(event: JetstreamCommitEvent): Promise<void> {
		if (!this.wantedCollections.includes(event.commit.collection)) return;

		const job: RecordsJob = {
			did: event.did,
			collection: event.commit.collection,
			rkey: event.commit.rkey,
			operation: event.commit.operation,
			cid: event.commit.operation === "delete" ? "" : event.commit.cid,
			...(event.commit.operation !== "delete" ? { jetstreamRecord: event.commit.record } : {}),
		};

		await this.queue.send(job);
		this.cursor = event.time_us;
		await this.storage.put(CURSOR_STORAGE_KEY, event.time_us);
		this.madeProgress = true;
	}

	private computeBackoff(failures: number): number {
		const exp = Math.min(
			Math.max(
				this.backoff.initialDelayMs,
				this.backoff.initialDelayMs * this.backoff.multiplier ** (failures - 1),
			),
			this.backoff.maxDelayMs,
		);
		if (this.backoff.jitter <= 0) return exp;
		const range = exp * this.backoff.jitter;
		const offset = (this.random() * 2 - 1) * range;
		return Math.max(0, Math.round(exp + offset));
	}
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
