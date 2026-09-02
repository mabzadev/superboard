import { env } from "cloudflare:workers";

export interface SuperBoardSiteEnv extends Cloudflare.Env {
	SUPERBOARD_RELEASE_PRIVATE_JWK?: string;
	SUPERBOARD_API_URL?: string;
	SUPERBOARD_ENVIRONMENT: string;
	SUPERBOARD_PLUGIN_IDS: string;
	TARGET_ARTIFACT_CHECKSUM: string;
}

export function getSiteEnv(): SuperBoardSiteEnv {
	return env;
}
