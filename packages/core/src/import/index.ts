export type {
	ImportSource,
	ImportAnalysis,
	ImportContext,
	SourceInput,
	FileInput,
	UrlInput,
	OAuthInput,
	SourceProbeResult,
	ProbeResult,
	SourceAuth,
	SourceCapabilities,
	SuggestedAction,
	PostTypeAnalysis,
	ImportFieldDef,
	FieldCompatibility,
	CollectionSchemaStatus,
	AttachmentInfo,
	NormalizedItem,
	ImportConfig,
	ImportResult,
	FetchOptions,
	PostTypeMapping,
	NavMenuAnalysis,
	TaxonomyAnalysis,
} from "./types.js";

export {
	importMenusFromWxr,
	importMenusFromPlugin,
	type MenuImportResult,
	type PluginMenu,
	type PluginMenuItem,
} from "./menus.js";

export { importReusableBlocksAsSections, type SectionsImportResult } from "./sections.js";

export {
	importCommentsFromPlugin,
	type PluginComment,
	type CommentsImportResult,
} from "./comments.js";

export {
	importSiteSettings,
	parseSiteSettingsFromPlugin,
	type SiteSettingsAnalysis,
	type SettingsImportResult,
	type SettingsMediaIds,
} from "./settings.js";

export {
	registerSource,
	getSource,
	getAllSources,
	getFileSources,
	getUrlSources,
	probeUrl,
	clearSources,
} from "./registry.js";

export { validateExternalUrl, ssrfSafeFetch, SsrfError } from "./ssrf.js";

export { wxrSource, parseWxrDate } from "./sources/wxr.js";
export { wordpressRestSource } from "./sources/wordpress-rest.js";
export {
	wordpressPluginSource,
	createBasicAuthToken,
	fetchPluginMedia,
	fetchPluginTaxonomies,
} from "./sources/wordpress-plugin.js";

import { registerSource } from "./registry.js";
import { wordpressPluginSource } from "./sources/wordpress-plugin.js";
import { wordpressRestSource } from "./sources/wordpress-rest.js";
import { wxrSource } from "./sources/wxr.js";

registerSource(wordpressPluginSource);
registerSource(wordpressRestSource);
registerSource(wxrSource);
