import { handleApi } from "./api.js";
import type { PerfQueueMessage } from "./events.js";
import { isBuildSucceeded } from "./events.js";
import { resolvePrForSha } from "./github.js";
import { runMeasurements } from "./measure.js";
import { TRIGGER_WORKER_NAME } from "./routes.js";
import { insertResults } from "./store.js";

async function handleBuildSucceeded(
	env: Env,
	event: Extract<PerfQueueMessage, { type: "cf.workersBuilds.worker.build.succeeded" }>,
): Promise<void> {
	const workerName = event.source.workerName;
	if (workerName !== TRIGGER_WORKER_NAME) {
		return;
	}

	const meta = event.payload.buildTriggerMetadata;
	if (meta.branch !== "main") {
		return;
	}

	const sha = meta.commitHash;
	if (!sha) {
		console.warn("build.succeeded event missing commitHash; skipping");
		return;
	}

	console.log(`Running deploy-triggered measurement for ${workerName} @ ${sha.slice(0, 7)}`);

	const prNumber = await resolvePrForSha(sha, meta.commitMessage);
	const results = await runMeasurements(env, { source: "deploy", sha, prNumber });

	if (results.length > 0) {
		await insertResults(env.DB, results);
		console.log(
			`Stored ${results.length} deploy measurements for ${sha.slice(0, 7)}${prNumber ? ` (PR #${prNumber})` : ""}`,
		);
	} else {
		console.warn(`No measurements returned for ${sha.slice(0, 7)}`);
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		const apiResponse = await handleApi(request, url, env);
		if (apiResponse) return apiResponse;

		return new Response("Not found", { status: 404 });
	},

	async scheduled(
		controller: ScheduledController,
		env: Env,
		_ctx: ExecutionContext,
	): Promise<void> {
		console.log(`Cron triggered at ${new Date(controller.scheduledTime).toISOString()}`);

		const results = await runMeasurements(env, { source: "cron" });

		if (results.length > 0) {
			await insertResults(env.DB, results);
			console.log(`Stored ${results.length} cron measurements`);
		} else {
			console.warn("No measurements returned from probes");
		}
	},

	async queue(batch: MessageBatch<PerfQueueMessage>, env: Env): Promise<void> {
		for (const message of batch.messages) {
			try {
				const event = message.body;
				if (!isBuildSucceeded(event)) {
					message.ack();
					continue;
				}
				await handleBuildSucceeded(env, event);
				message.ack();
			} catch (err) {
				console.error("Failed to process queue message:", err);
				message.retry();
			}
		}
	},
} satisfies ExportedHandler<Env, PerfQueueMessage>;
