import { sanitizeGalleryImages } from "./gallery.js";
import {
	UnsupportedPortableTextMarksError,
	assertPortableTextMarksSupported,
} from "./mark-safety.js";
import {
	deriveLegacyListId,
	normalizeProseMirrorOrderedListJson,
	normalizeListId,
	normalizeListStart,
} from "./numbered-list.js";
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
} from "./types.js";

export function portableTextToProsemirror(blocks: PortableTextBlock[]): ProseMirrorDocument {
	if (!blocks || blocks.length === 0) {
		return {
			type: "doc",
			content: [{ type: "paragraph" }],
		};
	}
	assertPortableTextMarksSupported(blocks);

	const content: ProseMirrorNode[] = [];
	let i = 0;

	while (i < blocks.length) {
		const block = blocks[i];

		if (isTextBlock(block) && block.listItem) {
			const listBlocks: PortableTextTextBlock[] = [];
			const listType = block.listItem;
			const runStart = i;
			const rootId = listType === "number" ? normalizeListId(block.listId) : undefined;

			while (i < blocks.length) {
				const current = blocks[i];
				if (!isTextBlock(current) || !current.listItem) break;
				const level = current.level || 1;
				const currentId =
					current.listItem === "number" ? normalizeListId(current.listId) : undefined;
				const sameRootIdentity =
					listType !== "number" ||
					level > 1 ||
					(rootId ? currentId === rootId : currentId === undefined);
				if (level > 1 || (current.listItem === listType && sameRootIdentity)) {
					listBlocks.push(current);
					i++;
				} else {
					break;
				}
			}

			content.push(convertList(listBlocks, listType, `root:${runStart}`));
		} else if (isTextBlock(block) && block.style === "blockquote") {
			const quoteBlocks: PortableTextTextBlock[] = [];
			while (i < blocks.length) {
				const current = blocks[i];
				if (
					!isTextBlock(current) ||
					current.style !== "blockquote" ||
					current.listItem !== undefined
				) {
					break;
				}
				quoteBlocks.push(current);
				i++;
			}

			content.push({
				type: "blockquote",
				content: quoteBlocks.map((quoteBlock) => {
					const paragraph = convertSpans(quoteBlock.children, quoteBlock.markDefs || []);
					return {
						type: "paragraph",
						content: paragraph.length > 0 ? paragraph : undefined,
					};
				}),
			});
		} else {
			const converted = convertBlock(block);
			if (converted) {
				content.push(converted);
			}
			i++;
		}
	}

	return normalizeProseMirrorOrderedListJson({
		type: "doc",
		content: content.length > 0 ? content : [{ type: "paragraph" }],
	});
}

function getListMetadata(
	item: PortableTextTextBlock,
	fallbackSeed: string,
): { listId: string; listStart?: number } {
	const listId = normalizeListId(item.listId) ?? deriveLegacyListId(fallbackSeed);
	const listStart = normalizeListStart(item.listStart);
	return {
		listId,
		...(listStart === undefined ? {} : { listStart }),
	};
}

function belongsToNestedGroup(
	item: PortableTextTextBlock,
	minLevel: number,
	parentListType: "bullet" | "number",
	anchorType: "bullet" | "number",
	anchorId: string | undefined,
): boolean {
	if ((item.level || 2) > minLevel) return true;
	if ((item.listItem || parentListType) !== anchorType) return false;
	if (anchorType !== "number") return true;
	const itemId = normalizeListId(item.listId);
	return anchorId ? itemId === anchorId : itemId === undefined;
}

function isTextBlock(block: PortableTextBlock): block is PortableTextTextBlock {
	return block._type === "block";
}

function isImageBlock(block: PortableTextBlock): block is PortableTextImageBlock {
	return (
		block._type === "image" &&
		"asset" in block &&
		typeof block.asset === "object" &&
		block.asset !== null
	);
}

function isGalleryBlock(block: PortableTextBlock): block is PortableTextGalleryBlock {
	return block._type === "gallery" && "images" in block && Array.isArray(block.images);
}

function isCodeBlock(block: PortableTextBlock): block is PortableTextCodeBlock {
	return block._type === "code";
}

function convertBlock(block: PortableTextBlock): ProseMirrorNode | null {
	if (isTextBlock(block)) {
		return convertTextBlock(block);
	}
	if (isImageBlock(block)) {
		return convertImage(block);
	}
	if (block._type === "image") {
		return convertMalformedImage(block);
	}
	if (isGalleryBlock(block)) {
		return {
			type: "gallery",
			attrs: {
				images: sanitizeGalleryImages(block.images),
				columns: typeof block.columns === "number" ? block.columns : undefined,
			},
		};
	}
	if (isCodeBlock(block)) {
		return convertCodeBlock(block);
	}
	if (block._type === "htmlBlock") {
		const hb = block as PortableTextBlock & { html?: string };
		return {
			type: "htmlBlock",
			attrs: { html: hb.html || "" },
		};
	}
	if (block._type === "break") {
		return { type: "horizontalRule" };
	}
	return {
		type: "paragraph",
		content: [
			{
				type: "text",
				text: `[Unknown block type: ${block._type}]`,
				marks: [{ type: "code" }],
			},
		],
	};
}

function convertTextBlock(block: PortableTextTextBlock): ProseMirrorNode | null {
	const { style = "normal", children, markDefs = [] } = block;

	const content = convertSpans(children, markDefs);

	switch (style) {
		case "h1":
		case "h2":
		case "h3":
		case "h4":
		case "h5":
		case "h6": {
			const level = parseInt(style.substring(1), 10);
			return {
				type: "heading",
				attrs: {
					level,
					...(block.textAlign ? { textAlign: block.textAlign } : {}),
				},
				content: content.length > 0 ? content : undefined,
			};
		}

		case "blockquote":
			return {
				type: "blockquote",
				content: [
					{
						type: "paragraph",
						content: content.length > 0 ? content : undefined,
					},
				],
			};

		case "normal":
		default:
			return {
				type: "paragraph",
				attrs: block.textAlign ? { textAlign: block.textAlign } : undefined,
				content: content.length > 0 ? content : undefined,
			};
	}
}

function convertList(
	items: PortableTextTextBlock[],
	listType: "bullet" | "number",
	context: string,
): ProseMirrorNode {
	const rootItems: ProseMirrorNode[] = [];
	let i = 0;

	while (i < items.length) {
		const item = items[i];
		const level = item.level || 1;

		if (level === 1) {
			const nestedItems: PortableTextTextBlock[] = [];
			i++;

			while (i < items.length && (items[i].level || 1) > 1) {
				nestedItems.push(items[i]);
				i++;
			}

			rootItems.push(
				convertListItem(item, nestedItems, listType, `${context}:${rootItems.length}`),
			);
		} else {
			rootItems.push(convertListItem(item, [], listType, `${context}:${rootItems.length}`));
			i++;
		}
	}

	const metadata =
		listType === "number" ? getListMetadata(items[0], `${context}:${items[0]._key}`) : undefined;

	return {
		type: listType === "bullet" ? "bulletList" : "orderedList",
		attrs: metadata ? { ...metadata, start: metadata.listStart ?? 1 } : undefined,
		content: rootItems,
	};
}

function convertListItem(
	item: PortableTextTextBlock,
	nestedItems: PortableTextTextBlock[],
	parentListType: "bullet" | "number",
	context: string,
): ProseMirrorNode {
	const content: ProseMirrorNode[] = [];

	const spans = convertSpans(item.children, item.markDefs || []);
	content.push({
		type: "paragraph",
		content: spans.length > 0 ? spans : undefined,
	});

	if (nestedItems.length > 0) {
		let minLevel = Infinity;
		for (const ni of nestedItems) {
			const level = ni.level || 2;
			if (level < minLevel) minLevel = level;
		}

		let j = 0;
		while (j < nestedItems.length) {
			const anchorType: "bullet" | "number" = nestedItems[j].listItem || parentListType;
			const anchorId = anchorType === "number" ? normalizeListId(nestedItems[j].listId) : undefined;
			const nestedGroup: PortableTextTextBlock[] = [];

			do {
				nestedGroup.push(nestedItems[j]);
				j++;
			} while (
				j < nestedItems.length &&
				belongsToNestedGroup(nestedItems[j], minLevel, parentListType, anchorType, anchorId)
			);

			if (nestedGroup.length > 0) {
				const adjustedGroup = nestedGroup.map((ni) => ({
					...ni,
					level: (ni.level || 2) - 1,
				}));
				content.push(
					convertList(adjustedGroup, anchorType, `${context}:nested:${j - nestedGroup.length}`),
				);
			}
		}
	}

	return {
		type: "listItem",
		content,
	};
}

function convertSpans(
	spans: PortableTextSpan[],
	markDefs: PortableTextMarkDef[],
): ProseMirrorNode[] {
	const nodes: ProseMirrorNode[] = [];
	const markDefsMap = new Map(markDefs.map((md) => [md._key, md]));

	for (const span of spans) {
		if (span._type !== "span") continue;

		const parts = span.text.split("\n");

		for (let i = 0; i < parts.length; i++) {
			const text = parts[i];

			if (text.length > 0) {
				const marks = convertMarks(span.marks || [], markDefsMap);
				const node: ProseMirrorNode = {
					type: "text",
					text,
				};
				if (marks.length > 0) {
					node.marks = marks;
				}
				nodes.push(node);
			}

			if (i < parts.length - 1) {
				nodes.push({ type: "hardBreak" });
			}
		}
	}

	return nodes;
}

function convertMarks(
	marks: string[],
	markDefs: Map<string, PortableTextMarkDef>,
): ProseMirrorMark[] {
	const pmMarks: ProseMirrorMark[] = [];

	for (const mark of marks) {
		switch (mark) {
			case "strong":
				pmMarks.push({ type: "bold" });
				break;

			case "em":
				pmMarks.push({ type: "italic" });
				break;

			case "underline":
				pmMarks.push({ type: "underline" });
				break;

			case "strike-through":
				pmMarks.push({ type: "strike" });
				break;

			case "subscript":
				pmMarks.push({ type: "subscript" });
				break;

			case "superscript":
				pmMarks.push({ type: "superscript" });
				break;

			case "code":
				pmMarks.push({ type: "code" });
				break;

			default: {
				const markDef = markDefs.get(mark);
				if (markDef?._type === "link") {
					pmMarks.push({
						type: "link",
						attrs: {
							href: markDef.href,
							target: markDef.blank ? "_blank" : null,
						},
					});
				} else {
					throw new UnsupportedPortableTextMarksError([
						typeof markDef?._type === "string" ? markDef._type : mark,
					]);
				}
				break;
			}
		}
	}

	return pmMarks;
}

function convertImage(block: PortableTextImageBlock): ProseMirrorNode {
	return {
		type: "image",
		attrs: {
			src: block.asset.url || block.asset._ref,
			alt: block.alt || "",
			title: block.caption || "",
			mediaId: block.asset._ref,
			provider: block.asset.provider,
			width: block.width,
			height: block.height,
			displayWidth: block.displayWidth,
			displayHeight: block.displayHeight,
		},
	};
}

function convertMalformedImage(block: PortableTextBlock): ProseMirrorNode {
	const url = "url" in block && typeof block.url === "string" ? block.url : "";
	const alt = "alt" in block && typeof block.alt === "string" ? block.alt : "";
	const caption = "caption" in block && typeof block.caption === "string" ? block.caption : "";
	const width = "width" in block && typeof block.width === "number" ? block.width : undefined;
	const height = "height" in block && typeof block.height === "number" ? block.height : undefined;
	const displayWidth =
		"displayWidth" in block && typeof block.displayWidth === "number"
			? block.displayWidth
			: undefined;
	const displayHeight =
		"displayHeight" in block && typeof block.displayHeight === "number"
			? block.displayHeight
			: undefined;
	return {
		type: "image",
		attrs: {
			src: url,
			alt,
			title: caption,
			mediaId: undefined,
			provider: undefined,
			width,
			height,
			displayWidth,
			displayHeight,
		},
	};
}

function convertCodeBlock(block: PortableTextCodeBlock): ProseMirrorNode {
	return {
		type: "codeBlock",
		attrs: {
			language: block.language || null,
		},
		content: block.code ? [{ type: "text", text: block.code }] : undefined,
	};
}
