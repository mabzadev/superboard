import { env } from "cloudflare:workers";

export interface SuperBoardSiteEnv extends Cloudflare.Env {
	SUPERBOARD_RELEASE_PRIVATE_JWK?: string;
}

export function getSiteEnv(): SuperBoardSiteEnv {
	return env;
}
