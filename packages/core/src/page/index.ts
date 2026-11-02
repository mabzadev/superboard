import type {
	PublicPageContext,
	PageMetadataContribution,
	PageFragmentContribution,
} from "../plugins/types.js";

export { createPublicPageContext } from "./context.js";
export type { CreatePublicPageContextInput } from "./context.js";

export {
	resolvePageMetadata,
	renderPageMetadata,
	safeJsonLdSerialize,
	escapeHtmlAttr,
} from "./metadata.js";
export type { ResolvedPageMetadata } from "./metadata.js";

export { resolveFragments, renderFragments } from "./fragments.js";

export { generateBaseSeoContributions, generateSiteSeoContributions } from "./seo-contributions.js";
export { cleanJsonLd, buildBlogPostingJsonLd, buildWebSiteJsonLd } from "./jsonld.js";

export interface EmDashPageRuntime {
	collectPageMetadata: (page: PublicPageContext) => Promise<PageMetadataContribution[]>;
	collectPageFragments: (page: PublicPageContext) => Promise<PageFragmentContribution[]>;
}

export function getPageRuntime(locals: Record<string, unknown>): EmDashPageRuntime | undefined {
	const emdash = locals.emdash;
	if (
		emdash &&
		typeof emdash === "object" &&
		"collectPageMetadata" in emdash &&
		"collectPageFragments" in emdash
	) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- structural check above confirms presence of required methods
		return emdash as EmDashPageRuntime;
	}
	return undefined;
}
