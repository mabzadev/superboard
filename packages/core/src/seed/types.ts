import type { CollectionAdminConfig, FieldType } from "../schema/types.js";
import type { SiteSettings } from "../settings/types.js";
import type { Storage } from "../storage/types.js";

export interface SeedFile {
	$schema?: string;

	version: "1";

	defaultLocale?: string;

	meta?: {
		name?: string;
		description?: string;
		author?: string;
	};

	settings?: Partial<SiteSettings>;

	collections?: SeedCollection[];

	taxonomies?: SeedTaxonomy[];

	menus?: SeedMenu[];

	redirects?: SeedRedirect[];

	widgetAreas?: SeedWidgetArea[];

	sections?: SeedSection[];

	bylines?: SeedByline[];

	content?: Record<string, SeedContentEntry[]>;
}

export interface SeedCollection {
	slug: string;
	label: string;
	labelSingular?: string;
	description?: string;
	icon?: string;
	admin?: CollectionAdminConfig;
	supports?: ("drafts" | "revisions" | "preview" | "scheduling" | "search" | "seo")[];
	urlPattern?: string;
	routable?: boolean;
	hidden?: boolean;
	sortOrder?: number;
	commentsEnabled?: boolean;
	titleField?: string;
	dateField?: string;
	fields: SeedField[];
}

export interface SeedField {
	slug: string;
	label: string;
	type: FieldType;
	required?: boolean;
	unique?: boolean;
	searchable?: boolean;
	indexed?: boolean;
	defaultValue?: unknown;
	validation?: Record<string, unknown>;
	widget?: string;
	options?: Record<string, unknown>;
}

export interface SeedTaxonomy {
	id?: string;
	name: string;
	label: string;
	labelSingular?: string;
	hierarchical: boolean;
	collections: string[];
	locale?: string;
	translationOf?: string;
	terms?: SeedTaxonomyTerm[];
}

export interface SeedTaxonomyTerm {
	id?: string;
	slug: string;
	label: string;
	description?: string;
	parent?: string;
	locale?: string;
	translationOf?: string;
}

export interface SeedMenu {
	id?: string;
	name: string;
	label: string;
	locale?: string;
	translationOf?: string;
	items: SeedMenuItem[];
}

export interface SeedMenuItem {
	id?: string;
	type: string;
	label?: string;
	url?: string;
	ref?: string;
	collection?: string;
	target?: "_blank" | "_self";
	titleAttr?: string;
	cssClasses?: string;
	locale?: string;
	translationOf?: string;
	children?: SeedMenuItem[];
}

export interface SeedRedirect {
	source: string;
	destination: string;
	type?: 301 | 302 | 307 | 308;
	enabled?: boolean;
	groupName?: string | null;
}

export interface SeedWidgetArea {
	name: string;
	label: string;
	description?: string;
	widgets: SeedWidget[];
}

export interface SeedWidget {
	type: "content" | "menu" | "component";
	title?: string;

	content?: Array<{ _type: string; _key?: string; [key: string]: unknown }>;

	menuName?: string;

	componentId?: string;
	props?: Record<string, unknown>;
}

export interface SeedSection {
	slug: string;
	title: string;
	description?: string;
	keywords?: string[];
	content: Array<{ _type: string; _key?: string; [key: string]: unknown }>;
	source?: "theme" | "import";
}

export interface SeedByline {
	id: string;
	slug: string;
	displayName: string;
	bio?: string;
	websiteUrl?: string;
	isGuest?: boolean;
	avatar?: SeedBylineAvatar;
}

export interface SeedBylineAvatar {
	storageKey: string;
	alt?: string;
	filename?: string;
	mimeType?: string;
	width?: number;
	height?: number;
}

export interface SeedContentEntry {
	id: string;

	slug?: string | null;

	status?: "published" | "draft";

	data: Record<string, unknown>;

	taxonomies?: Record<string, string[]>;

	bylines?: SeedBylineCredit[];

	locale?: string;

	translationOf?: string;
}

export interface SeedBylineCredit {
	byline: string;
	roleLabel?: string;
}

export interface SeedApplyOptions {
	includeContent?: boolean;

	onConflict?: "skip" | "update" | "error";

	mediaBasePath?: string;

	storage?: Storage;

	skipMediaDownload?: boolean;
}

export interface SeedApplyResult {
	collections: { created: number; skipped: number; updated: number };
	fields: { created: number; skipped: number; updated: number };
	taxonomies: { created: number; terms: number };
	bylines: { created: number; skipped: number; updated: number };
	menus: { created: number; items: number };
	redirects: { created: number; skipped: number; updated: number };
	widgetAreas: { created: number; widgets: number };
	sections: { created: number; skipped: number; updated: number };
	settings: { applied: number };
	content: { created: number; skipped: number; updated: number };
	media: { created: number; skipped: number };
}

export interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

export interface MediaQueueItem {
	url: string;
	targetMediaId: string;
	alt?: string;
	filename?: string;
}

export interface SeedMediaReference {
	$media: {
		url: string;
		alt?: string;
		filename?: string;
		caption?: string;
	};
}
