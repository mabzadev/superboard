import { createInitLock, type InitLock, initWithLock } from "./init-lock.js";

export interface SingleFlightCache<T> {
	value: T | null;
	hasValue: boolean;
	version: number;
	valueVersion: number;
	lock: InitLock;
}

export function createSingleFlightCache<T>(): SingleFlightCache<T> {
	return { value: null, hasValue: false, version: 0, valueVersion: -1, lock: createInitLock() };
}

export function invalidateSingleFlightCache(cache: SingleFlightCache<unknown>): void {
	cache.version++;
	cache.hasValue = false;
	cache.value = null;
	cache.valueVersion = -1;
	cache.lock.ownerStartedAt = null;
}

const RECLAIM_HEADROOM_MS = 5_000;

export interface SingleFlightCachedOptions {
	anchor?: (promise: Promise<void>) => void;
	deadlineMs?: number;
	pollMs?: number;
	maxWaitMs?: number;
	ownerTimeoutMs?: number;
}

interface Box<T> {
	v: T;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`singleFlightCached: owner fetch exceeded ${ms}ms`));
		}, ms);
		promise.then(resolve, reject).finally(() => {
			clearTimeout(timer);
		});
	});
}

export function singleFlightCached<T>(
	cache: SingleFlightCache<T>,
	fetch: () => Promise<T>,
	options: SingleFlightCachedOptions = {},
): Promise<T> {
	const versionAtCall = cache.version;

	const ownerTimeoutMs =
		options.ownerTimeoutMs !== undefined &&
		Number.isFinite(options.ownerTimeoutMs) &&
		options.ownerTimeoutMs > 0
			? options.ownerTimeoutMs
			: undefined;

	const deadlineMs =
		ownerTimeoutMs === undefined
			? options.deadlineMs
			: Math.max(options.deadlineMs ?? 0, ownerTimeoutMs + RECLAIM_HEADROOM_MS);

	return initWithLock<Box<T>>(
		cache.lock,
		() =>
			cache.hasValue && cache.valueVersion === versionAtCall
				? // eslint-disable-next-line typescript/no-unsafe-type-assertion -- hasValue gates that `value` holds a real T
					({ v: cache.value as T } satisfies Box<T>)
				: null,
		(isCurrentClaim) => {
			const real = (async (): Promise<Box<T>> => {
				const value = await fetch();
				if (isCurrentClaim()) {
					cache.value = value;
					cache.hasValue = true;
					cache.valueVersion = versionAtCall;
				}
				return { v: value };
			})();
			options.anchor?.(
				real.then(
					() => undefined,
					() => undefined,
				),
			);
			return ownerTimeoutMs === undefined ? real : withTimeout(real, ownerTimeoutMs);
		},
		{
			deadlineMs,
			pollMs: options.pollMs,
			maxWaitMs: options.maxWaitMs,
		},
	).then((box) => box.v);
}
