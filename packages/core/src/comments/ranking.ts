const DEFAULT_Z = 1.96;

const NEGATIVE_REACTIONS: ReadonlySet<string> = new Set(["dislike", "down"]);

export function wilsonLowerBound(up: number, down: number, z: number = DEFAULT_Z): number {
	const n = up + down;
	if (n <= 0) return 0;
	const phat = up / n;
	const z2 = z * z;
	const denom = 1 + z2 / n;
	const centre = phat + z2 / (2 * n);
	const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
	return (centre - margin) / denom;
}

export function reactionScore(counts: Record<string, number>): number {
	let up = 0;
	let down = 0;
	for (const [reaction, count] of Object.entries(counts)) {
		if (NEGATIVE_REACTIONS.has(reaction)) {
			down += count;
		} else {
			up += count;
		}
	}
	return wilsonLowerBound(up, down);
}
