import { quarantinePlatformDeadLetter } from "../../../supbrd-core/api/src/lib/platform-dead-letters.js";
import type { PushDeliveryEnv } from "../../../supbrd-core/api/src/lib/push-credentials.js";
import { processPushNotifications } from "../../../supbrd-core/api/src/routes/push.js";

type PushEnv = PushDeliveryEnv & { PUSH_DLQ_NAME?: string };

export default {
	fetch() {
		return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
	},
	async queue(batch: MessageBatch<unknown>, env: PushEnv) {
		for (const message of batch.messages) {
			try {
				if (batch.queue === env.PUSH_DLQ_NAME)
					await quarantinePlatformDeadLetter(env.DB, batch.queue, message);
				else {
					const job: unknown =
						typeof message.body === "string" ? JSON.parse(message.body) : message.body;
					if (!job || typeof job !== "object" || !("type" in job) || job.type !== "push.process")
						throw new Error("PUSH_JOB_INVALID");
					const limit = "limit" in job && typeof job.limit === "number" ? job.limit : 25;
					await processPushNotifications(env, limit);
				}
				message.ack();
			} catch {
				message.retry({ delaySeconds: 60 });
			}
		}
	},
};
