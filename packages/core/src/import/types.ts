import type { PortableTextBlock } from "@emdash-cms/gutenberg-to-portable-text";

export interface WpAuthorInfo {
	id?: number;
	login?: string;
	email?: string;
	displayName?: string;
	postCount: number;
}

export interface FileInput {
	type: "file";
	file: File;
}

export interface UrlInput {
	type: "url";
	url: string;
	token?: string;
}

export interface OAuthInput {
	type: "oauth";
	url: string;
	accessToken: string;
	siteId?: string;
}

export type SourceInput = FileInput | UrlInput | OAuthInput;

export interface SourceAuth {
	type: "oauth" | "token" | "password" | "none";
	provider?: string;
	oauthUrl?: string;
	instructions?: string;
}

export interface SourceCapabilities {
	publicContent: boolean;
	privateContent: boolean;
	customPostTypes: boolean;
	allMeta: boolean;
	mediaStream: boolean;
}

export type SuggestedAction =
	| { type: "proceed" }
	| { type: "oauth"; url: string; provider: string }
	| { type: "upload"; instructions: string }
	| { type: "install-plugin"; instructions: string };

export interface I18nDetection {
	plugin: string;
	defaultLocale: string;
	locales: string[];
}

export interface SourceProbeResult {
	sourceId: string;

	confidence: "definite" | "likely" | "possible";

	detected: {
		platform: string;
		version?: string;
		siteTitle?: string;
		siteUrl?: string;
	};

	capabilities: SourceCapabilities;

	auth?: SourceAuth;

	suggestedAction: SuggestedAction;

	preview?: {
		posts?: number;
		pages?: number;
		media?: number;
	};

	i18n?: I18nDetection;
}

export interface ProbeResult {
	url: string;
	isWordPress: boolean;
	bestMatch: SourceProbeResult | null;
	allMatches: SourceProbeResult[];
}

export interface ImportFieldDef {
	slug: string;
	label: string;
	type: string;
	required: boolean;
	searchable?: boolean;
}

export type FieldCompatibility = "compatible" | "type_mismatch" | "missing";

export interface CollectionSchemaStatus {
	exists: boolean;
	fieldStatus: Record<
		string,
		{
			status: FieldCompatibility;
			existingType?: string;
			requiredType: string;
		}
	>;
	canImport: boolean;
	reason?: string;
}

export interface PostTypeAnalysis {
	name: string;
	count: number;
	suggestedCollection: string;
	requiredFields: ImportFieldDef[];
	schemaStatus: CollectionSchemaStatus;
}

export interface AttachmentInfo {
	id?: number;
	title?: string;
	url?: string;
	filename?: string;
	mimeType?: string;
	alt?: string;
	caption?: string;
	width?: number;
	height?: number;
}

export interface NavMenuAnalysis {
	name: string;
	label: string;
	itemCount: number;
}

export interface TaxonomyAnalysis {
	slug: string;
	termCount: number;
	sampleTerms: string[];
}

export interface ReusableBlockAnalysis {
	id: number;
	title: string;
	slug: string;
}

export interface ImportAnalysis {
	sourceId: string;

	site: {
		title: string;
		url: string;
	};

	postTypes: PostTypeAnalysis[];

	attachments: {
		count: number;
		items: AttachmentInfo[];
	};

	categories: number;
	tags: number;
	authors: WpAuthorInfo[];

	navMenus?: NavMenuAnalysis[];

	customTaxonomies?: TaxonomyAnalysis[];

	reusableBlocks?: ReusableBlockAnalysis[];

	customFields?: Array<{
		key: string;
		count: number;
		samples: string[];
		suggestedField: string;
		suggestedType: "string" | "number" | "boolean" | "date" | "json";
		isInternal: boolean;
	}>;

	i18n?: I18nDetection;
}

export interface NormalizedItem {
	sourceId: string | number;
	postType: string;
	status: "publish" | "draft" | "pending" | "private" | "future";
	slug: string;
	title: string;
	content: PortableTextBlock[];
	excerpt?: string;
	date: Date;
	modified?: Date;
	author?: string;
	categories?: string[];
	tags?: string[];
	meta?: Record<string, unknown>;
	featuredImage?: string;
	parentId?: string | number;
	menuOrder?: number;
	customTaxonomies?: Record<string, string[]>;

	locale?: string;

	translationGroup?: string;
}

export interface PostTypeMapping {
	enabled: boolean;
	collection: string;
}

export interface ImportConfig {
	postTypeMappings: Record<string, PostTypeMapping>;
	skipExisting?: boolean;
}

export interface FetchOptions {
	postTypes: string[];
	includeDrafts?: boolean;
	limit?: number;
}

export interface ImportResult {
	success: boolean;
	imported: number;
	skipped: number;
	errors: Array<{ title: string; error: string }>;
	byCollection: Record<string, number>;
	taxonomyAssignments?: number;
	missingTaxonomies?: string[];
	taxonomiesCreated?: string[];
	menus?: { created: number; items: number };
	comments?: { imported: number; skipped: number };
	siteSettings?: string[];
}

export interface ImportSource {
	id: string;

	name: string;

	description: string;

	icon: "upload" | "globe" | "wordpress" | "plug";

	requiresFile?: boolean;

	canProbe?: boolean;

	probe?(url: string): Promise<SourceProbeResult | null>;

	analyze(input: SourceInput, context: ImportContext): Promise<ImportAnalysis>;

	fetchContent(input: SourceInput, options: FetchOptions): AsyncGenerator<NormalizedItem>;

	fetchMedia?(url: string, input: SourceInput): Promise<Blob>;
}

export interface ImportContext {
	db?: unknown;
	getExistingCollections?: () => Promise<
		Map<string, { slug: string; fields: Map<string, { type: string }> }>
	>;
}
