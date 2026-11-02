import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_AGGREGATOR_URL = "https://registry.emdashcms.com";

export const DEFAULT_OAUTH_DIR = join(homedir(), ".emdash", "oauth");

export function resolveAggregatorUrl(flag?: string): string {
	if (flag && flag.length > 0) return flag;
	const fromEnv = process.env["EMDASH_REGISTRY_URL"];
	if (fromEnv && fromEnv.length > 0) return fromEnv;
	return DEFAULT_AGGREGATOR_URL;
}
