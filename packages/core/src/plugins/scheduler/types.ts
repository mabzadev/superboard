export interface CronScheduler {
	start(): void | Promise<void>;
	stop(): void | Promise<void>;
	reschedule(): void;
	setSystemCleanup(fn: SystemCleanupFn): void;
}

export type SystemCleanupFn = () => Promise<void>;
