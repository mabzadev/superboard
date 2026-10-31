/**
 * Applies "equal jitter" to a retry delay: the result is uniformly distributed
 * between half of `milliseconds` and `milliseconds`, so clients that lost
 * their connection at the same moment do not all retry in lockstep.
 */
export function withJitter(milliseconds, random = Math.random) {
	if (!(milliseconds > 0)) return 0;
	const half = milliseconds / 2;
	return Math.round(half + random() * half);
}
