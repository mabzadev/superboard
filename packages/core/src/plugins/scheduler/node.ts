import type { CronExecutor } from "../cron.js";
import type { CronScheduler, SystemCleanupFn } from "./types.js";

const MIN_INTERVAL_MS = 1000;

const MAX_INTERVAL_MS = 60 * 1000;

export class NodeCronScheduler implements CronScheduler {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running = false;
	private systemCleanup: SystemCleanupFn | null = null;

	constructor(private executor: CronExecutor) {}

	setSystemCleanup(fn: SystemCleanupFn): void {
		this.systemCleanup = fn;
	}

	start(): void {
		this.running = true;
		this.arm();
	}

	stop(): void {
		this.running = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	reschedule(): void {
		if (!this.running) return;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.arm();
	}

	private arm(): void {
		if (!this.running) return;

		void this.executor
			.getNextDueTime()
			.then((nextDue) => {
				if (!this.running) return undefined;

				let delayMs: number;
				if (nextDue) {
					const dueAt = new Date(nextDue).getTime();
					delayMs = Math.max(dueAt - Date.now(), MIN_INTERVAL_MS);
					delayMs = Math.min(delayMs, MAX_INTERVAL_MS);
				} else {
					delayMs = MAX_INTERVAL_MS;
				}

				this.timer = setTimeout(() => {
					if (!this.running) return;
					this.executeTick();
				}, delayMs);

				if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
					this.timer.unref();
				}

				return undefined;
			})
			.catch((error: unknown) => {
				console.error("[cron:node] Failed to get next due time:", error);
				if (this.running) {
					this.timer = setTimeout(() => this.arm(), MAX_INTERVAL_MS);
					if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
						this.timer.unref();
					}
				}
			});
	}

	private executeTick(): void {
		if (!this.running) return;

		const tasks: Promise<unknown>[] = [this.executor.tick(), this.executor.recoverStaleLocks()];
		if (this.systemCleanup) {
			tasks.push(this.systemCleanup());
		}

		void Promise.allSettled(tasks)
			.then((results) => {
				for (const r of results) {
					if (r.status === "rejected") {
						console.error("[cron:node] Tick task failed:", r.reason);
					}
				}
				return undefined;
			})
			.finally(() => {
				if (this.running) {
					this.arm();
				}
			});
	}
}
