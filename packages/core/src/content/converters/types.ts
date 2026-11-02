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

export interface PortableTextLinkMark extends PortableTextMarkDef {
	_type: "link";
	href: string;
	blank?: boolean;
}

export interface PortableTextTextBlock {
	_type: "block";
	_key: string;
	style?: "normal" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote";
	listItem?: "bullet" | "number";
	level?: number;
	listId?: string;
	listStart?: number;
	children: PortableTextSpan[];
	markDefs?: PortableTextMarkDef[];
	textAlign?: "left" | "center" | "right" | "justify";
}

export interface PortableTextImageBlock {
	_type: "image";
	_key: string;
	asset: {
		_ref: string;
		url?: string;
		provider?: string;
	};
	alt?: string;
	caption?: string;
	width?: number;
	height?: number;
	displayWidth?: number;
	displayHeight?: number;
}

export interface PortableTextGalleryImage {
	_type: "image";
	_key: string;
	asset: {
		_type?: "reference";
		_ref: string;
		url?: string;
		provider?: string;
	};
	alt?: string;
	caption?: string;
	width?: number;
	height?: number;
	focalX?: number;
	focalY?: number;
	blurhash?: string;
	dominantColor?: string;
}

export interface PortableTextGalleryBlock {
	_type: "gallery";
	_key: string;
	images: PortableTextGalleryImage[];
	columns?: number;
}

export interface PortableTextCodeBlock {
	_type: "code";
	_key: string;
	code: string;
	language?: string;
	filename?: string;
}

export interface PortableTextHtmlBlock {
	_type: "htmlBlock";
	_key: string;
	html: string;
}

export interface PortableTextUnknownBlock {
	_type: string;
	_key: string;
	[key: string]: unknown;
}

export type PortableTextBlock =
	| PortableTextTextBlock
	| PortableTextImageBlock
	| PortableTextGalleryBlock
	| PortableTextCodeBlock
	| PortableTextHtmlBlock
	| PortableTextUnknownBlock;

export interface ProseMirrorMark {
	type: string;
	attrs?: Record<string, unknown>;
}

export interface ProseMirrorNode {
	type: string;
	attrs?: Record<string, unknown>;
	content?: ProseMirrorNode[];
	marks?: ProseMirrorMark[];
	text?: string;
}

export interface ProseMirrorDocument {
	type: "doc";
	content: ProseMirrorNode[];
}
