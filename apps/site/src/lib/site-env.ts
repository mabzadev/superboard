import { env } from "cloudflare:workers";

export interface SuperBoardSiteEnv extends Cloudflare.Env {
	SUPERBOARD_RELEASE_PRIVATE_JWK?: string;
	SUPERBOARD_API_URL?: string;
}

export function getSiteEnv(): SuperBoardSiteEnv {
	return env;
}
