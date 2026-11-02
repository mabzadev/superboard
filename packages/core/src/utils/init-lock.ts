export interface InitLock {
	ownerStartedAt: number | null;
	generation: number;
}

export function createInitLock(): InitLock {
	return { ownerStartedAt: null, generation: 0 };
}

export interface InitLockOptions {
	deadlineMs?: number;
	pollMs?: number;
	maxWaitMs?: number;
	anchor?: (promise: Promise<void>) => void;
}

const DEFAULT_DEADLINE_MS = 15_000;
const DEFAULT_POLL_MS = 50;
const MAX_WAIT_HEADROOM_MS = 15_000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function initWithLock<T>(
	lock: InitLock,
	getCached: () => T | null | undefined,
	init: (isCurrentClaim: () => boolean) => Promise<T>,
	options?: InitLockOptions,
): Promise<T> {
	const deadlineMs = options?.deadlineMs ?? DEFAULT_DEADLINE_MS;
	const pollMs = options?.pollMs ?? DEFAULT_POLL_MS;
	const maxWaitMs = options?.maxWaitMs ?? deadlineMs + MAX_WAIT_HEADROOM_MS;
	const waitStart = Date.now();

	for (;;) {
		const cached = getCached();
		if (cached !== null && cached !== undefined) {
			return cached;
		}

		const ownerStartedAt = lock.ownerStartedAt;
		if (ownerStartedAt === null || Date.now() - ownerStartedAt > deadlineMs) {
			lock.generation += 1;
			const claim = lock.generation;
			lock.ownerStartedAt = Date.now();
			try {
				const isCurrentClaim = () => lock.generation === claim;
				const initPromise = Promise.resolve().then(() => init(isCurrentClaim));
				options?.anchor?.(
					initPromise.then(
						() => undefined,
						() => undefined,
					),
				);
				return await initPromise;
			} finally {
				if (lock.generation === claim) {
					lock.ownerStartedAt = null;
				}
			}
		}

		if (Date.now() - waitStart > maxWaitMs) {
			throw new Error(`initWithLock: timed out after ${maxWaitMs}ms waiting for initialization`);
		}
		await sleep(pollMs);
	}
}
