export function withJitter(milliseconds, random = Math.random) {
	if (!(milliseconds > 0)) return 0;
	const half = milliseconds / 2;
	return Math.round(half + random() * half);
}
