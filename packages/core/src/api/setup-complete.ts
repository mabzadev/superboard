import type { Kysely } from "kysely";

import { OptionsRepository } from "../database/repositories/options.js";
import type { Database } from "../database/types.js";

export async function finalizeSetup(db: Kysely<Database>): Promise<void> {
	const options = new OptionsRepository(db);

	const setupComplete = await options.get("emdash:setup_complete");
	if (setupComplete === true || setupComplete === "true") return;

	const setupState = await options.get<Record<string, unknown>>("emdash:setup_state");
	if (setupState?.title && typeof setupState.title === "string") {
		await options.set("emdash:site_title", setupState.title);
	}
	if (setupState?.tagline && typeof setupState.tagline === "string") {
		await options.set("emdash:site_tagline", setupState.tagline);
	}

	await options.set("emdash:setup_complete", true);
	await options.delete("emdash:setup_state");
}
