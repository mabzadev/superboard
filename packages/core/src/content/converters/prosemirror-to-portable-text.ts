import { sanitizeGalleryImages } from "./gallery.js";
import {
	UnsupportedPortableTextMarksError,
	assertProseMirrorMarksSupported,
} from "./mark-safety.js";
import { readOrderedListMetadata, type OrderedListMetadata } from "./numbered-list.js";
import type {
	ProseMirrorDocument,
	ProseMirrorNode,
	ProseMirrorMark,
	PortableTextBlock,
	PortableTextTextBlock,
	PortableTextSpan,
	PortableTextMarkDef,
	PortableTextImageBlock,
	PortableTextGalleryBlock,
	PortableTextCodeBlock,
	PortableTextHtmlBlock,
} from "./types.js";

function generateKey(): string {
	return Math.random().toString(36).substring(2, 11);
}

export function prosemirrorToPortableText(doc: ProseMirrorDocument): PortableTextBlock[] {
	if (!doc || doc.type !== "doc" || !doc.content) {
		return [];
	}
	assertProseMirrorMarksSupported(doc);

	const blocks: PortableTextBlock[] = [];

	for (const [i, node] of doc.content.entries()) {
		const converted = convertNode(node, `root:${i}`);
		if (converted) {
			if (Array.isArray(converted)) {
				blocks.push(...converted);
			} else {
				blocks.push(converted);
			}
		}
	}

	return blocks;
}

function convertNode(
	node: ProseMirrorNode,
	path: string,
): PortableTextBlock | PortableTextBlock[] | null {
	switch (node.type) {
		case "paragraph":
			return convertParagraph(node);

		case "heading":
			return convertHeading(node);

		case "bulletList":
			return convertList(node, "bullet", path);

		case "orderedList":
			return convertList(node, "number", path);

		case "blockquote":
			return convertBlockquote(node);

		case "codeBlock":
			return convertCodeBlock(node);

		case "htmlBlock":
			return convertHtmlBlock(node);

		case "image":
			return convertImage(node);

		case "gallery":
			return convertGallery(node);

		case "horizontalRule":
			return {
				_type: "break",
				_key: generateKey(),
				style: "lineBreak",
			};

		default:
			return {
				_type: node.type,
				_key: generateKey(),
				...node.attrs,
				_pmContent: node.content,
			};
	}
}

function convertParagraph(node: ProseMirrorNode): PortableTextTextBlock | null {
	const { children, markDefs } = convertInlineContent(node.content || []);

	if (children.length === 0) {
		return null;
	}

	const ta = node.attrs?.textAlign;
	const textAlign = ta === "center" || ta === "right" || ta === "justify" ? ta : undefined;

	return {
		_type: "block",
		_key: generateKey(),
		style: "normal",
		children,
		markDefs: markDefs.length > 0 ? markDefs : undefined,
		...(textAlign ? { textAlign } : {}),
	};
}

function headingLevelToStyle(level: number): PortableTextTextBlock["style"] {
	switch (level) {
		case 1:
			return "h1";
		case 2:
			return "h2";
		case 3:
			return "h3";
		case 4:
			return "h4";
		case 5:
			return "h5";
		case 6:
			return "h6";
		default:
			return "h1";
	}
}

function convertHeading(node: ProseMirrorNode): PortableTextTextBlock | null {
	const { children, markDefs } = convertInlineContent(node.content || []);
	const rawLevel = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
	const style = headingLevelToStyle(rawLevel);

	if (children.length === 0) {
		return null;
	}

	const ta = node.attrs?.textAlign;
	const textAlign = ta === "center" || ta === "right" || ta === "justify" ? ta : undefined;

	return {
		_type: "block",
		_key: generateKey(),
		style,
		children,
		markDefs: markDefs.length > 0 ? markDefs : undefined,
		...(textAlign ? { textAlign } : {}),
	};
}

function convertList(
	node: ProseMirrorNode,
	listItem: "bullet" | "number",
	path: string,
): PortableTextTextBlock[] {
	const blocks: PortableTextTextBlock[] = [];
	const metadata = listItem === "number" ? readOrderedListMetadata(node.attrs, path) : undefined;

	for (const [i, item] of (node.content ?? []).entries()) {
		if (item.type === "listItem") {
			const itemBlocks = convertListItem(item, listItem, 1, `${path}:${i}`, metadata);
			blocks.push(...itemBlocks);
		}
	}

	return blocks;
}

function convertListItem(
	item: ProseMirrorNode,
	listItem: "bullet" | "number",
	level: number,
	path: string,
	metadata?: OrderedListMetadata,
): PortableTextTextBlock[] {
	const blocks: PortableTextTextBlock[] = [];

	for (const [i, child] of (item.content ?? []).entries()) {
		if (child.type === "paragraph") {
			const { children, markDefs } = convertInlineContent(child.content || []);

			if (children.length > 0) {
				blocks.push({
					_type: "block",
					_key: generateKey(),
					style: "normal",
					listItem,
					level,
					...metadata,
					children,
					markDefs: markDefs.length > 0 ? markDefs : undefined,
				});
			}
		} else if (child.type === "bulletList") {
			blocks.push(...convertListItemNested(child, "bullet", level + 1, `${path}:${i}`));
		} else if (child.type === "orderedList") {
			blocks.push(...convertListItemNested(child, "number", level + 1, `${path}:${i}`));
		}
	}

	return blocks;
}

function convertListItemNested(
	node: ProseMirrorNode,
	listItem: "bullet" | "number",
	level: number,
	path: string,
): PortableTextTextBlock[] {
	const blocks: PortableTextTextBlock[] = [];
	const metadata = listItem === "number" ? readOrderedListMetadata(node.attrs, path) : undefined;

	for (const [i, item] of (node.content ?? []).entries()) {
		if (item.type === "listItem") {
			blocks.push(...convertListItem(item, listItem, level, `${path}:${i}`, metadata));
		}
	}

	return blocks;
}

function convertBlockquote(
	node: ProseMirrorNode,
): PortableTextTextBlock | PortableTextTextBlock[] | null {
	const blocks: PortableTextTextBlock[] = [];

	for (const child of node.content || []) {
		if (child.type === "paragraph") {
			const { children, markDefs } = convertInlineContent(child.content || []);

			if (children.length > 0) {
				blocks.push({
					_type: "block",
					_key: generateKey(),
					style: "blockquote",
					children,
					markDefs: markDefs.length > 0 ? markDefs : undefined,
				});
			}
		}
	}

	return blocks.length === 1 ? blocks[0] : blocks.length > 0 ? blocks : null;
}

function convertCodeBlock(node: ProseMirrorNode): PortableTextCodeBlock {
	const code = node.content?.map((n) => n.text || "").join("") || "";
	const language = typeof node.attrs?.language === "string" ? node.attrs.language : undefined;

	return {
		_type: "code",
		_key: generateKey(),
		code,
		language: language || undefined,
	};
}

function convertHtmlBlock(node: ProseMirrorNode): PortableTextHtmlBlock {
	const rawHtml = node.attrs?.html;
	return {
		_type: "htmlBlock",
		_key: generateKey(),
		html: typeof rawHtml === "string" ? rawHtml : "",
	};
}

function convertImage(node: ProseMirrorNode): PortableTextImageBlock {
	const attrs = node.attrs;
	const provider = typeof attrs?.provider === "string" ? attrs.provider : undefined;
	const mediaId = typeof attrs?.mediaId === "string" ? attrs.mediaId : undefined;
	const src = typeof attrs?.src === "string" ? attrs.src : "";
	const alt = typeof attrs?.alt === "string" ? attrs.alt : undefined;
	const title = typeof attrs?.title === "string" ? attrs.title : undefined;
	const width = typeof attrs?.width === "number" ? attrs.width : undefined;
	const height = typeof attrs?.height === "number" ? attrs.height : undefined;
	const displayWidth = typeof attrs?.displayWidth === "number" ? attrs.displayWidth : undefined;
	const displayHeight = typeof attrs?.displayHeight === "number" ? attrs.displayHeight : undefined;

	return {
		_type: "image",
		_key: generateKey(),
		asset: {
			_ref: mediaId || src || "",
			url: src || "",
			provider: provider && provider !== "local" ? provider : undefined,
		},
		alt: alt || undefined,
		caption: title || undefined,
		width: width || undefined,
		height: height || undefined,
		displayWidth: displayWidth || undefined,
		displayHeight: displayHeight || undefined,
	};
}

function convertGallery(node: ProseMirrorNode): PortableTextGalleryBlock {
	const columns = node.attrs?.columns;
	return {
		_type: "gallery",
		_key: generateKey(),
		images: sanitizeGalleryImages(node.attrs?.images, generateKey),
		...(typeof columns === "number" ? { columns } : {}),
	};
}

function convertInlineContent(nodes: ProseMirrorNode[]): {
	children: PortableTextSpan[];
	markDefs: PortableTextMarkDef[];
} {
	const children: PortableTextSpan[] = [];
	const markDefs: PortableTextMarkDef[] = [];
	const markDefMap = new Map<string, string>();

	for (const node of nodes) {
		if (node.type === "text" && node.text) {
			const marks: string[] = [];

			for (const mark of node.marks || []) {
				const markType = convertMark(mark, markDefs, markDefMap);
				if (markType) {
					marks.push(markType);
				}
			}

			children.push({
				_type: "span",
				_key: generateKey(),
				text: node.text,
				marks: marks.length > 0 ? marks : undefined,
			});
		} else if (node.type === "hardBreak") {
			if (children.length > 0) {
				const lastChild = children.at(-1)!;
				lastChild.text += "\n";
			} else {
				children.push({
					_type: "span",
					_key: generateKey(),
					text: "\n",
				});
			}
		}
	}

	if (children.length === 0) {
		children.push({
			_type: "span",
			_key: generateKey(),
			text: "",
		});
	}

	return { children, markDefs };
}

function convertMark(
	mark: ProseMirrorMark,
	markDefs: PortableTextMarkDef[],
	markDefMap: Map<string, string>,
): string | null {
	switch (mark.type) {
		case "bold":
		case "strong":
			return "strong";

		case "italic":
		case "em":
			return "em";

		case "underline":
			return "underline";

		case "strike":
		case "strikethrough":
			return "strike-through";

		case "subscript":
			return "subscript";

		case "superscript":
			return "superscript";

		case "code":
			return "code";

		case "link": {
			const href = (typeof mark.attrs?.href === "string" ? mark.attrs.href : "") || "";

			if (markDefMap.has(href)) {
				return markDefMap.get(href)!;
			}

			const key = generateKey();
			markDefs.push({
				_type: "link",
				_key: key,
				href,
				blank: mark.attrs?.target === "_blank",
			});
			markDefMap.set(href, key);

			return key;
		}

		default:
			throw new UnsupportedPortableTextMarksError([mark.type]);
	}
}
