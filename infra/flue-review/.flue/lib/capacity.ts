export class CapacityExhaustedError extends Error {
	constructor(label: string, attempts: number, cause: unknown) {
		super(`${label}: model over capacity after ${attempts} attempt(s)`, { cause });
		this.name = "CapacityExhaustedError";
	}
}

export class ModelTimeoutError extends Error {
	constructor(label: string, timeoutMs: number, cause: unknown) {
		super(`${label}: model call exceeded ${timeoutMs}ms timeout`, { cause });
		this.name = "ModelTimeoutError";
	}
}

export interface CapacityRetryOptions {
	label: string;
	attempts?: number;
	perAttemptTimeoutMs?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
	signal?: AbortSignal;
	onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

const CAPACITY_MARKERS = [
	"429",
	"too many requests",
	"capacity",
	"over capacity",
	"rate limit",
	"overloaded",
	"3040",
];

export function isCapacityError(error: unknown): boolean {
	const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
	return CAPACITY_MARKERS.some((marker) => message.includes(marker));
}

function isTimeoutAbort(error: unknown, timeoutSignal: AbortSignal | undefined): boolean {
	if (!timeoutSignal?.aborted) return false;
	return (
		(error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) ||
		error === timeoutSignal.reason
	);
}

function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
	const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
	return Math.round(Math.random() * exponential);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export async function withCapacityRetry<T>(
	fn: (signal: AbortSignal) => PromiseLike<T>,
	options: CapacityRetryOptions,
): Promise<T> {
	const attempts = options.attempts ?? 3;
	const baseDelayMs = options.baseDelayMs ?? 3000;
	const maxDelayMs = options.maxDelayMs ?? 30000;

	let lastError: unknown;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		const timeoutSignal =
			options.perAttemptTimeoutMs !== undefined
				? AbortSignal.timeout(options.perAttemptTimeoutMs)
				: undefined;
		const signals = [options.signal, timeoutSignal].filter(
			(s): s is AbortSignal => s !== undefined,
		);
		const signal =
			signals.length > 1 ? AbortSignal.any(signals) : (signals[0] ?? new AbortController().signal);

		try {
			return await fn(signal);
		} catch (error) {
			lastError = error;

			if (isTimeoutAbort(error, timeoutSignal)) {
				throw new ModelTimeoutError(options.label, options.perAttemptTimeoutMs ?? 0, error);
			}
			if (options.signal?.aborted) throw error;
			if (!isCapacityError(error)) throw error;
			if (attempt === attempts) break;

			const delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs);
			options.onRetry?.({ attempt, delayMs, error });
			await sleep(delayMs, options.signal);
		}
	}

	throw new CapacityExhaustedError(options.label, attempts, lastError);
}
