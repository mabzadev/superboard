import { DurableObject } from "cloudflare:workers";

import { RealJetstreamClient } from "./jetstream-client.js";
import { JetstreamIngestor, type IngestorStorage } from "./jetstream-ingestor.js";
import { RestartableRunLoop } from "./run-loop-lifecycle.js";

async function deriveJetstreamCursorFloor(db: D1Database): Promise<number | null> {
	const row = await db
		.prepare(
			`SELECT MAX(t) AS latest FROM (
				SELECT MAX(verified_at) AS t FROM packages
				UNION ALL
				SELECT MAX(verified_at) AS t FROM releases
				UNION ALL
				SELECT MAX(verified_at) AS t FROM publishers
				UNION ALL
				SELECT MAX(verified_at) AS t FROM publisher_verifications
			)`,
		)
		.first<{ latest: string | null }>();
	if (!row?.latest) return null;
	const ms = new Date(row.latest).getTime();
	if (!Number.isFinite(ms)) return null;
	return ms * 1000;
}

export const RECORDS_DO_NAME = "main";

export class RecordsJetstreamDO extends DurableObject<Env> {
	private readonly runLoop: RestartableRunLoop<JetstreamIngestor>;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.runLoop = new RestartableRunLoop(
			state,
			() =>
				new JetstreamIngestor({
					client: new RealJetstreamClient(this.env.JETSTREAM_URL),
					queue: this.env.RECORDS_QUEUE,
					storage: wrapDoStorage(this.ctx.storage),
					cursorFloor: () => deriveJetstreamCursorFloor(this.env.DB),
				}),
			(error) => {
				console.error("[aggregator] jetstream ingestor crashed", error);
			},
		);
		this.runLoop.ensureStarted();
	}

	override async fetch(_request: Request): Promise<Response> {
		const ingestor = this.runLoop.ensureStarted();
		return Response.json({
			cursor: ingestor.currentCursor,
			consecutiveFailures: ingestor.consecutiveFailures,
		});
	}
}

function wrapDoStorage(storage: DurableObjectStorage): IngestorStorage {
	return {
		async get(key: string): Promise<number | undefined> {
			const value = await storage.get<number>(key);
			return typeof value === "number" ? value : undefined;
		},
		async put(key: string, value: number): Promise<void> {
			await storage.put(key, value);
		},
	};
}
