import type { Kysely } from "kysely";

import { OptionsRepository } from "../database/repositories/options.js";
import type { Database } from "../database/types.js";
import { getConfiguredOrigin, type SiteUrlConfig } from "./public-url.js";

export async function getSiteBaseUrl(
	db: Kysely<Database>,
	request: Request,
	config?: SiteUrlConfig,
): Promise<string> {
	const configured = getConfiguredOrigin(config);
	if (configured) {
		return `${configured}/_emdash`;
	}
	const options = new OptionsRepository(db);
	const storedUrl = await options.get<string>("emdash:site_url");
	if (storedUrl) {
		return `${storedUrl}/_emdash`;
	}
	const url = new URL(request.url);
	return `${url.protocol}//${url.host}/_emdash`;
}
