export interface GutenbergBlock {
	blockName: string | null;
	attrs: Record<string, unknown>;
	innerHTML: string;
	innerBlocks: GutenbergBlock[];
	innerContent: Array<string | null>;
}

export interface PortableTextSpan {
	_type: "span";
	_key: string;
	text: string;
	marks?: string[];
}

export interface PortableTextMarkDef {
	_type: string;
	_key: string;
	[key: string]: unknown;
}

export interface PortableTextTextBlock {
	_type: "block";
	_key: string;
	style?: "normal" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote";
	listItem?: "bullet" | "number";
	level?: number;
	children: PortableTextSpan[];
	markDefs?: PortableTextMarkDef[];
}

export interface PortableTextImageBlock {
	_type: "image";
	_key: string;
	asset: {
		_type: "reference";
		_ref: string;
		url?: string;
	};
	alt?: string;
	caption?: string;
	alignment?: "left" | "center" | "right" | "wide" | "full";
	link?: string;
}

export interface PortableTextCodeBlock {
	_type: "code";
	_key: string;
	code: string;
	language?: string;
}

export interface PortableTextEmbedBlock {
	_type: "embed";
	_key: string;
	url: string;
	provider?: string;
	html?: string;
}

export interface PortableTextGalleryBlock {
	_type: "gallery";
	_key: string;
	images: Array<{
		_type: "image";
		_key: string;
		asset: { _type: "reference"; _ref: string; url?: string };
		alt?: string;
		caption?: string;
	}>;
	columns?: number;
}

export interface PortableTextColumnsBlock {
	_type: "columns";
	_key: string;
	columns: Array<{
		_type: "column";
		_key: string;
		content: PortableTextBlock[];
	}>;
}

export interface PortableTextBreakBlock {
	_type: "break";
	_key: string;
	style: "lineBreak";
}

export interface PortableTextTableBlock {
	_type: "table";
	_key: string;
	rows: Array<{
		_type: "tableRow";
		_key: string;
		cells: Array<{
			_type: "tableCell";
			_key: string;
			content: PortableTextSpan[];
			markDefs?: PortableTextMarkDef[];
			isHeader?: boolean;
		}>;
	}>;
	hasHeaderRow?: boolean;
}

export interface PortableTextHtmlBlock {
	_type: "htmlBlock";
	_key: string;
	html: string;
	originalBlockName?: string | null;
	originalAttrs?: Record<string, unknown>;
}

export interface PortableTextButtonBlock {
	_type: "button";
	_key: string;
	text: string;
	url?: string;
	style?: "default" | "outline" | "fill";
}

export interface PortableTextButtonsBlock {
	_type: "buttons";
	_key: string;
	buttons: PortableTextButtonBlock[];
	layout?: "horizontal" | "vertical";
}

export interface PortableTextCoverBlock {
	_type: "cover";
	_key: string;
	backgroundImage?: string;
	backgroundVideo?: string;
	overlayColor?: string;
	overlayOpacity?: number;
	content: PortableTextBlock[];
	minHeight?: string;
	alignment?: "left" | "center" | "right";
}

export interface PortableTextFileBlock {
	_type: "file";
	_key: string;
	url: string;
	filename?: string;
	showDownloadButton?: boolean;
}

export interface PortableTextPullquoteBlock {
	_type: "pullquote";
	_key: string;
	text: string;
	citation?: string;
}

export type PortableTextBlock =
	| PortableTextTextBlock
	| PortableTextImageBlock
	| PortableTextCodeBlock
	| PortableTextEmbedBlock
	| PortableTextGalleryBlock
	| PortableTextColumnsBlock
	| PortableTextBreakBlock
	| PortableTextTableBlock
	| PortableTextHtmlBlock
	| PortableTextButtonBlock
	| PortableTextButtonsBlock
	| PortableTextCoverBlock
	| PortableTextFileBlock
	| PortableTextPullquoteBlock;

export interface ConvertOptions {
	mediaMap?: Map<number, string>;
	customTransformers?: Record<string, BlockTransformer>;
	generateKeys?: boolean;
	keyGenerator?: () => string;
}

export type BlockTransformer = (
	block: GutenbergBlock,
	options: ConvertOptions,
	context: TransformContext,
) => PortableTextBlock[];

export interface TransformContext {
	transformBlocks: (blocks: GutenbergBlock[]) => PortableTextBlock[];
	parseInlineContent: (html: string) => {
		children: PortableTextSpan[];
		markDefs: PortableTextMarkDef[];
	};
	generateKey: () => string;
}

export function attrString(attrs: Record<string, unknown>, key: string): string | undefined {
	const v = attrs[key];
	return typeof v === "string" ? v : undefined;
}

export function attrNumber(attrs: Record<string, unknown>, key: string): number | undefined {
	const v = attrs[key];
	return typeof v === "number" ? v : undefined;
}

export function attrBoolean(attrs: Record<string, unknown>, key: string): boolean | undefined {
	const v = attrs[key];
	return typeof v === "boolean" ? v : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function attrObject(
	attrs: Record<string, unknown>,
	key: string,
): Record<string, unknown> | undefined {
	const v = attrs[key];
	return isRecord(v) ? v : undefined;
}
