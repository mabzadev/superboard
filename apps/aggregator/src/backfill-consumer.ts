import {
	AtprotoWebDidDocumentResolver,
	CompositeDidDocumentResolver,
	PlcDidDocumentResolver,
} from "@atcute/identity-resolver";

import { processBackfillJob, type ProcessBackfillJobDeps } from "./backfill.js";
import { createD1DidDocCache, DidResolver } from "./did-resolver.js";
import type { BackfillJob } from "./env.js";
import type { MessageBatchLike } from "./records-consumer.js";
import { boundFetch } from "./utils.js";

export async function processBackfillBatch(
	batch: MessageBatchLike<BackfillJob>,
	env: Env,
	depsOverride?: ProcessBackfillJobDeps,
): Promise<void> {
	const deps = depsOverride ?? createProductionDeps(env);
	for (const message of batch.messages) {
		const job = message.body;
		try {
			const result = await processBackfillJob(job, deps);
			console.log("[aggregator] backfill job complete", {
				did: result.did,
				collection: result.collection,
				enqueued: result.enqueued,
			});
			message.ack();
		} catch (err) {
			console.error("[aggregator] backfill job failed, retrying", {
				did: job.did,
				collection: job.collection,
				error: formatErrorChain(err),
			});
			message.retry();
		}
	}
}

export function drainBackfillDeadLetterBatch(
	batch: MessageBatchLike<BackfillJob>,
	_env: Env,
): void {
	for (const message of batch.messages) {
		console.error("[aggregator] backfill DLQ drain: pair exhausted retries", {
			did: message.body.did,
			collection: message.body.collection,
		});
		message.ack();
	}
}

function formatErrorChain(err: unknown): string {
	const parts: string[] = [];
	let current: unknown = err;
	for (let i = 0; i < 5 && current; i++) {
		if (current instanceof Error) {
			parts.push(`${current.name}: ${current.message}`);
			current = (current as { cause?: unknown }).cause;
		} else {
			parts.push(typeof current === "string" ? current : JSON.stringify(current));
			break;
		}
	}
	return parts.join("; cause: ");
}

function createProductionDeps(env: Env): ProcessBackfillJobDeps {
	const composite = new CompositeDidDocumentResolver({
		methods: {
			plc: new PlcDidDocumentResolver({ fetch: boundFetch }),
			web: new AtprotoWebDidDocumentResolver({ fetch: boundFetch }),
		},
	});
	return {
		resolver: new DidResolver({
			cache: createD1DidDocCache(env.DB),
			resolver: composite,
		}),
		queue: env.RECORDS_QUEUE,
		fetch: boundFetch,
	};
}
