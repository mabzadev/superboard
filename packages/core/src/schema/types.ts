export type FieldType =
	| "string"
	| "text"
	| "url"
	| "number"
	| "integer"
	| "boolean"
	| "datetime"
	| "select"
	| "multiSelect"
	| "portableText"
	| "image"
	| "file"
	| "reference"
	| "json"
	| "slug"
	| "repeater";

export const FIELD_TYPES: readonly FieldType[] = [
	"string",
	"text",
	"url",
	"number",
	"integer",
	"boolean",
	"datetime",
	"select",
	"multiSelect",
	"portableText",
	"image",
	"file",
	"reference",
	"json",
	"slug",
	"repeater",
] as const;

export const INDEXABLE_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
	"string",
	"url",
	"number",
	"integer",
	"boolean",
	"datetime",
	"select",
	"reference",
	"slug",
]);

export function isIndexableFieldType(type: FieldType): boolean {
	return INDEXABLE_FIELD_TYPES.has(type);
}

export type ColumnType = "TEXT" | "REAL" | "INTEGER" | "JSON";

export const FIELD_TYPE_TO_COLUMN: Record<FieldType, ColumnType> = {
	string: "TEXT",
	text: "TEXT",
	number: "REAL",
	integer: "INTEGER",
	boolean: "INTEGER",
	datetime: "TEXT",
	select: "TEXT",
	multiSelect: "JSON",
	portableText: "JSON",
	image: "TEXT",
	file: "TEXT",
	reference: "TEXT",
	json: "JSON",
	slug: "TEXT",
	url: "TEXT",
	repeater: "JSON",
};

export type CollectionSupport =
	| "drafts"
	| "revisions"
	| "preview"
	| "scheduling"
	| "search"
	| "seo";

export type CollectionSource =
	| `template:${string}`
	| `import:${string}`
	| "manual"
	| "discovered"
	| "seed";

export interface RepeaterSubField {
	slug: string;
	type:
		| "string"
		| "text"
		| "url"
		| "number"
		| "integer"
		| "boolean"
		| "datetime"
		| "select"
		| "image";
	label: string;
	required?: boolean;
	options?: string[];
}

export const REPEATER_SUB_FIELD_TYPES = [
	"string",
	"text",
	"url",
	"number",
	"integer",
	"boolean",
	"datetime",
	"select",
	"image",
] as const;

export interface FieldValidation {
	required?: boolean;
	min?: number;
	max?: number;
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	options?: string[];
	subFields?: RepeaterSubField[];
	minItems?: number;
	maxItems?: number;
	allowedMimeTypes?: string[];
}

export interface FieldWidgetOptions {
	rows?: number;
	showPreview?: boolean;
	collection?: string;
	allowMultiple?: boolean;
	[key: string]: unknown;
}

export const MAX_COLLECTION_LIST_COLUMNS = 4;

export interface CollectionAdminConfig {
	listColumns?: string[];
}

export interface Collection {
	id: string;
	slug: string;
	label: string;
	labelSingular?: string;
	description?: string;
	icon?: string;
	admin?: CollectionAdminConfig;
	supports: CollectionSupport[];
	source?: CollectionSource;
	hasSeo: boolean;
	titleField?: string;
	dateField?: string;
	urlPattern?: string;
	routable?: boolean;
	hidden: boolean;
	sortOrder?: number;
	commentsEnabled: boolean;
	commentsModeration: "all" | "first_time" | "none";
	commentsClosedAfterDays: number;
	commentsAutoApproveUsers: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface Field {
	id: string;
	collectionId: string;
	slug: string;
	label: string;
	type: FieldType;
	columnType: ColumnType;
	required: boolean;
	unique: boolean;
	defaultValue?: unknown;
	validation?: FieldValidation;
	widget?: string;
	options?: FieldWidgetOptions;
	sortOrder: number;
	searchable: boolean;
	indexed: boolean;
	translatable: boolean;
	createdAt: string;
}

export interface CreateCollectionInput {
	slug: string;
	label: string;
	labelSingular?: string;
	description?: string;
	icon?: string;
	admin?: CollectionAdminConfig;
	supports?: CollectionSupport[];
	source?: CollectionSource;
	urlPattern?: string;
	routable?: boolean;
	hasSeo?: boolean;
	hidden?: boolean;
	sortOrder?: number | null;
	commentsEnabled?: boolean;
}

export interface UpdateCollectionInput {
	label?: string;
	labelSingular?: string;
	description?: string;
	icon?: string;
	admin?: CollectionAdminConfig;
	supports?: CollectionSupport[];
	urlPattern?: string | null;
	routable?: boolean;
	hasSeo?: boolean;
	hidden?: boolean;
	sortOrder?: number | null;
	commentsEnabled?: boolean;
	commentsModeration?: "all" | "first_time" | "none";
	commentsClosedAfterDays?: number;
	commentsAutoApproveUsers?: boolean;
	titleField?: string | null;
	dateField?: string | null;
}

export interface CreateFieldInput {
	slug: string;
	label: string;
	type: FieldType;
	required?: boolean;
	unique?: boolean;
	defaultValue?: unknown;
	validation?: FieldValidation | null;
	widget?: string;
	options?: FieldWidgetOptions;
	sortOrder?: number;
	searchable?: boolean;
	indexed?: boolean;
	translatable?: boolean;
}

export interface UpdateFieldInput {
	label?: string;
	type?: FieldType;
	required?: boolean;
	unique?: boolean;
	defaultValue?: unknown;
	validation?: FieldValidation | null;
	widget?: string;
	options?: FieldWidgetOptions;
	sortOrder?: number;
	searchable?: boolean;
	indexed?: boolean;
	translatable?: boolean;
}

export interface CollectionWithFields extends Collection {
	fields: Field[];
}

export const RESERVED_FIELD_SLUGS = [
	"id",
	"slug",
	"status",
	"author_id",
	"primary_byline_id",
	"created_at",
	"updated_at",
	"published_at",
	"scheduled_at",
	"deleted_at",
	"version",
	"live_revision_id",
	"draft_revision_id",
	"terms",
	"bylines",
	"byline",
];

export const RESERVED_COLLECTION_SLUGS = [
	"content",
	"media",
	"users",
	"revisions",
	"taxonomies",
	"options",
	"audit_logs",
	"reorder",
];

export type BylineFieldType = "string" | "text" | "url" | "boolean" | "select";

export const BYLINE_FIELD_TYPES: readonly BylineFieldType[] = [
	"string",
	"text",
	"url",
	"boolean",
	"select",
] as const;

export interface BylineFieldValidation {
	options?: string[];
}

export interface BylineFieldDefinition {
	id: string;
	slug: string;
	label: string;
	type: BylineFieldType;
	required: boolean;
	translatable: boolean;
	validation: BylineFieldValidation | null;
	sortOrder: number;
	createdAt: string;
	updatedAt: string;
}

export interface CreateBylineFieldInput {
	slug: string;
	label: string;
	type: BylineFieldType;
	required?: boolean;
	translatable?: boolean;
	validation?: BylineFieldValidation | null;
	sortOrder?: number;
}

export interface UpdateBylineFieldInput {
	label?: string;
	required?: boolean;
	translatable?: boolean;
	validation?: BylineFieldValidation | null;
	sortOrder?: number;
}

export type CustomFieldValue = string | boolean | null;

export const RESERVED_BYLINE_FIELD_SLUGS = [
	"id",
	"slug",
	"display_name",
	"bio",
	"avatar_media_id",
	"website_url",
	"user_id",
	"is_guest",
	"locale",
	"translation_group",
	"created_at",
	"updated_at",
	"reorder",
] as const;
