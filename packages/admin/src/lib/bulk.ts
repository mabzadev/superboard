export const BULK_CONCURRENCY = 5;

export interface BulkResult {
	failedIds: string[];
}

export async function runBulkAction(
	ids: string[],
	action: (id: string) => Promise<unknown>,
	concurrency: number = BULK_CONCURRENCY,
): Promise<BulkResult> {
	const failed = new Set<string>();
	let nextIndex = 0;
	async function drain(): Promise<void> {
		while (nextIndex < ids.length) {
			const id = ids[nextIndex++];
			if (id === undefined) continue;
			try {
				await action(id);
			} catch {
				failed.add(id);
			}
		}
	}
	const workerCount = Math.max(1, Math.min(concurrency, ids.length));
	await Promise.all(Array.from({ length: workerCount }, () => drain()));
	return { failedIds: ids.filter((id) => failed.has(id)) };
}
