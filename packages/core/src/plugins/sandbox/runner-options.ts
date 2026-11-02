import { createSiteInfo, type SiteInfoOptions } from "../context.js";
import type { SandboxOptions } from "./types.js";

export function createSandboxRunnerOptions(
	options: Omit<SandboxOptions, "siteInfo">,
	siteInfo?: SiteInfoOptions,
): SandboxOptions {
	return {
		...options,
		siteInfo: createSiteInfo(siteInfo ?? {}),
	};
}
