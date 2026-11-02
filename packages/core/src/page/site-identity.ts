import type { MediaReference } from "../settings/types.js";
import { escapeHtmlAttr } from "./metadata.js";

export interface SiteIdentityInput {
	favicon?: MediaReference;
}

export function renderSiteIdentity(input: SiteIdentityInput | undefined): string {
	if (!input) return "";

	const parts: string[] = [];

	const favicon = input.favicon;
	if (favicon?.url) {
		let tag = `<link rel="icon" href="${escapeHtmlAttr(favicon.url)}"`;
		if (favicon.contentType) {
			tag += ` type="${escapeHtmlAttr(favicon.contentType)}"`;
		}
		tag += ">";
		parts.push(tag);
	}

	return parts.join("\n");
}
