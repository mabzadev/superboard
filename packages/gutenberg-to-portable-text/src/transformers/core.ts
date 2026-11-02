import { extractAlt, extractCaption, extractSrc, extractText } from "../inline.js";
import type {
	GutenbergBlock,
	PortableTextBlock,
	PortableTextTextBlock,
	BlockTransformer,
	TransformContext,
} from "../types.js";
import { attrString, attrNumber, attrBoolean, attrObject } from "../types.js";
import { sanitizeHref } from "../url.js";

const UOL_TAG_PATTERN = /<[uo]l[^>]*>([\s\S]*)<\/[uo]l>/i;
const LI_TAG_PATTERN = /<li[^>]*>([\s\S]*?)<\/li>/i;
const UL_TAG_PATTERN = /<ul[^>]*>([\s\S]*)<\/ul>/i;
const OL_TAG_PATTERN = /<ol[^>]*>([\s\S]*)<\/ol>/i;
const NESTED_LIST_PATTERN = /<[uo]l[^>]*>[\s\S]*<\/[uo]l>/gi;
const P_TAG_PATTERN = /<p[^>]*>([\s\S]*?)<\/p>/gi;
const P_TAG_SINGLE_PATTERN = /<p[^>]*>([\s\S]*?)<\/p>/i;
const HREF_PATTERN = /href="([^"]*)"/i;
const DATA_ID_PATTERN = /data-id=["'](\d+)["']/i;
const CODE_TAG_PATTERN_SINGLE = /<code[^>]*>([\s\S]*?)<\/code>/i;
const TABLE_TAG_PATTERN = /<table[^>]*>([\s\S]*?)<\/table>/i;
const THEAD_TAG_PATTERN = /<thead[^>]*>([\s\S]*?)<\/thead>/i;
const IMG_TAG_GLOBAL = /<img[^>]+>/gi;
const TABLE_ROW_PATTERN = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const TABLE_CELL_PATTERN = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi;
const TBODY_TAG_PATTERN = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i;
const CITE_TAG_PATTERN = /<cite[^>]*>([\s\S]*?)<\/cite>/i;
const LT_ENTITY_PATTERN = /&lt;/g;
const GT_ENTITY_PATTERN = /&gt;/g;
const AMP_ENTITY_PATTERN = /&amp;/g;
const QUOT_ENTITY_PATTERN = /&quot;/g;
const APOS_ENTITY_PATTERN = /&#039;/g;
const NBSP_ENTITY_PATTERN = /&nbsp;/g;

export const paragraph: BlockTransformer = (block, _options, context) => {
	const { children, markDefs } = context.parseInlineContent(block.innerHTML);

	if (children.length === 1 && children[0]?.text === "") {
		return [];
	}

	const result: PortableTextTextBlock = {
		_type: "block",
		_key: context.generateKey(),
		style: "normal",
		children,
	};

	if (markDefs.length > 0) {
		result.markDefs = markDefs;
	}

	return [result];
};

export const heading: BlockTransformer = (block, _options, context) => {
	const level = attrNumber(block.attrs, "level") ?? 2;
	const { children, markDefs } = context.parseInlineContent(block.innerHTML);

	const result: PortableTextTextBlock = {
		_type: "block",
		_key: context.generateKey(),
		style: toHeadingStyle(level),
		children,
	};

	if (markDefs.length > 0) {
		result.markDefs = markDefs;
	}

	return [result];
};

export const list: BlockTransformer = (block, _options, context) => {
	const ordered = block.attrs.ordered === true;
	const listItem = ordered ? "number" : "bullet";

	if (block.innerBlocks.length > 0) {
		return parseListItemBlocks(block.innerBlocks, listItem, 1, context);
	}

	const listMatch = block.innerHTML.match(UOL_TAG_PATTERN);
	const listContent = listMatch?.[1] || block.innerHTML;

	return parseListItems(listContent, listItem, 1, context);
};

function parseListItemBlocks(
	innerBlocks: GutenbergBlock[],
	listItem: "bullet" | "number",
	level: number,
	context: TransformContext,
): PortableTextTextBlock[] {
	const blocks: PortableTextTextBlock[] = [];

	for (const itemBlock of innerBlocks) {
		if (itemBlock.blockName !== "core/list-item") continue;

		const textMatch = itemBlock.innerHTML.match(LI_TAG_PATTERN);
		const textContent = textMatch?.[1]?.trim() || "";

		if (textContent) {
			const { children, markDefs } = context.parseInlineContent(textContent);

			const block: PortableTextTextBlock = {
				_type: "block",
				_key: context.generateKey(),
				style: "normal",
				listItem,
				level,
				children,
			};

			if (markDefs.length > 0) {
				block.markDefs = markDefs;
			}

			blocks.push(block);
		}

		if (itemBlock.innerBlocks.length > 0) {
			for (const nested of itemBlock.innerBlocks) {
				if (nested.blockName === "core/list") {
					const nestedOrdered = nested.attrs.ordered === true;
					const nestedListItem = nestedOrdered ? "number" : "bullet";
					blocks.push(
						...parseListItemBlocks(nested.innerBlocks, nestedListItem, level + 1, context),
					);
				}
			}
		}
	}

	return blocks;
}

function parseListItems(
	html: string,
	listItem: "bullet" | "number",
	level: number,
	context: TransformContext,
): PortableTextTextBlock[] {
	const blocks: PortableTextTextBlock[] = [];

	const liItems = extractTopLevelListItems(html);

	for (const liContent of liItems) {
		const nestedUl = liContent.match(UL_TAG_PATTERN);
		const nestedOl = liContent.match(OL_TAG_PATTERN);

		let textContent = liContent.replace(NESTED_LIST_PATTERN, "").trim();

		if (textContent) {
			const { children, markDefs } = context.parseInlineContent(textContent);

			const block: PortableTextTextBlock = {
				_type: "block",
				_key: context.generateKey(),
				style: "normal",
				listItem,
				level,
				children,
			};

			if (markDefs.length > 0) {
				block.markDefs = markDefs;
			}

			blocks.push(block);
		}

		if (nestedUl?.[1]) {
			blocks.push(...parseListItems(nestedUl[1], "bullet", level + 1, context));
		}
		if (nestedOl?.[1]) {
			blocks.push(...parseListItems(nestedOl[1], "number", level + 1, context));
		}
	}

	return blocks;
}

function extractTopLevelListItems(html: string): string[] {
	const items: string[] = [];
	let depth = 0;
	let currentItem = "";
	let inLi = false;
	let i = 0;

	while (i < html.length) {
		if (html.substring(i, i + 3).toLowerCase() === "<li") {
			const tagEnd = html.indexOf(">", i);
			if (tagEnd === -1) break;

			if (!inLi) {
				inLi = true;
				i = tagEnd + 1;
				continue;
			} else {
				currentItem += html.substring(i, tagEnd + 1);
				depth++;
				i = tagEnd + 1;
				continue;
			}
		}

		if (html.substring(i, i + 5).toLowerCase() === "</li>") {
			if (depth === 0) {
				items.push(currentItem);
				currentItem = "";
				inLi = false;
				i += 5;
				continue;
			} else {
				currentItem += "</li>";
				depth--;
				i += 5;
				continue;
			}
		}

		if (
			html.substring(i, i + 3).toLowerCase() === "<ul" ||
			html.substring(i, i + 3).toLowerCase() === "<ol"
		) {
			const tagEnd = html.indexOf(">", i);
			if (tagEnd !== -1) {
				currentItem += html.substring(i, tagEnd + 1);
				i = tagEnd + 1;
				continue;
			}
		}

		if (
			html.substring(i, i + 5).toLowerCase() === "</ul>" ||
			html.substring(i, i + 5).toLowerCase() === "</ol>"
		) {
			currentItem += html.substring(i, i + 5);
			i += 5;
			continue;
		}

		if (inLi) {
			currentItem += html[i];
		}
		i++;
	}

	if (currentItem.trim()) {
		items.push(currentItem);
	}

	return items.filter((item) => item.trim().length > 0);
}

export const quote: BlockTransformer = (block, _options, context) => {
	const blocks: PortableTextBlock[] = [];

	let match;

	while ((match = P_TAG_PATTERN.exec(block.innerHTML)) !== null) {
		const content = match[1] || "";
		const { children, markDefs } = context.parseInlineContent(content);

		const quoteBlock: PortableTextTextBlock = {
			_type: "block",
			_key: context.generateKey(),
			style: "blockquote",
			children,
		};

		if (markDefs.length > 0) {
			quoteBlock.markDefs = markDefs;
		}

		blocks.push(quoteBlock);
	}

	if (blocks.length === 0) {
		const { children, markDefs } = context.parseInlineContent(block.innerHTML);

		const quoteBlock: PortableTextTextBlock = {
			_type: "block",
			_key: context.generateKey(),
			style: "blockquote",
			children,
		};

		if (markDefs.length > 0) {
			quoteBlock.markDefs = markDefs;
		}

		blocks.push(quoteBlock);
	}

	const citation = attrString(block.attrs, "citation");
	if (citation) {
		const { children, markDefs } = context.parseInlineContent(citation);

		const citationBlock: PortableTextTextBlock = {
			_type: "block",
			_key: context.generateKey(),
			style: "normal",
			children: [
				{
					_type: "span",
					_key: context.generateKey(),
					text: "— ",
				},
				...children,
			],
		};

		if (markDefs.length > 0) {
			citationBlock.markDefs = markDefs;
		}

		blocks.push(citationBlock);
	}

	return blocks;
};

export const image: BlockTransformer = (block, options, context) => {
	const wpId = attrNumber(block.attrs, "id");
	const src = attrString(block.attrs, "url") ?? extractSrc(block.innerHTML);
	const alt = attrString(block.attrs, "alt") ?? extractAlt(block.innerHTML);
	const caption = extractCaption(block.innerHTML);
	const align = attrString(block.attrs, "align");

	const ref = wpId && options.mediaMap?.get(wpId);

	return [
		{
			_type: "image",
			_key: context.generateKey(),
			asset: {
				_type: "reference",
				_ref: ref || String(wpId || src || ""),
				url: src,
			},
			alt,
			caption,
			alignment: mapAlignment(align),
		},
	];
};

export const code: BlockTransformer = (block, _options, context) => {
	const codeMatch = block.innerHTML.match(CODE_TAG_PATTERN_SINGLE);
	const codeContent = codeMatch?.[1] || block.innerHTML;

	const decoded = decodeHtmlEntities(codeContent);

	return [
		{
			_type: "code",
			_key: context.generateKey(),
			code: decoded,
			language: attrString(block.attrs, "language"),
		},
	];
};

export const preformatted: BlockTransformer = (block, _options, context) => {
	const text = extractText(block.innerHTML);

	return [
		{
			_type: "code",
			_key: context.generateKey(),
			code: text,
		},
	];
};

export const separator: BlockTransformer = (_block, _options, context) => {
	return [
		{
			_type: "break",
			_key: context.generateKey(),
			style: "lineBreak",
		},
	];
};

export const gallery: BlockTransformer = (block, options, context) => {
	const images: Array<{
		_type: "image";
		_key: string;
		asset: { _type: "reference"; _ref: string; url?: string };
		alt?: string;
		caption?: string;
	}> = [];

	if (block.innerBlocks.length > 0) {
		for (const innerBlock of block.innerBlocks) {
			if (innerBlock.blockName === "core/image") {
				const wpId = attrNumber(innerBlock.attrs, "id");
				const src = attrString(innerBlock.attrs, "url") ?? extractSrc(innerBlock.innerHTML);
				const alt = attrString(innerBlock.attrs, "alt") ?? extractAlt(innerBlock.innerHTML);
				const caption = extractCaption(innerBlock.innerHTML);
				const ref = wpId && options.mediaMap?.get(wpId);

				images.push({
					_type: "image",
					_key: context.generateKey(),
					asset: {
						_type: "reference",
						_ref: ref || String(wpId || src || ""),
						url: src,
					},
					alt,
					caption,
				});
			}
		}
	} else {
		let match;
		while ((match = IMG_TAG_GLOBAL.exec(block.innerHTML)) !== null) {
			const imgHtml = match[0];
			const src = extractSrc(imgHtml);
			const alt = extractAlt(imgHtml);
			const idMatch = imgHtml.match(DATA_ID_PATTERN);
			const wpId = idMatch?.[1] ? parseInt(idMatch[1], 10) : undefined;
			const ref = wpId && options.mediaMap?.get(wpId);

			images.push({
				_type: "image",
				_key: context.generateKey(),
				asset: {
					_type: "reference",
					_ref: ref || String(wpId || src || ""),
					url: src,
				},
				alt,
			});
		}
	}

	return [
		{
			_type: "gallery",
			_key: context.generateKey(),
			images,
			columns: attrNumber(block.attrs, "columns"),
		},
	];
};

export const columns: BlockTransformer = (block, _options, context) => {
	const columnBlocks = block.innerBlocks.map((col) => ({
		_type: "column" as const,
		_key: context.generateKey(),
		content: context.transformBlocks(col.innerBlocks),
	}));

	return [
		{
			_type: "columns",
			_key: context.generateKey(),
			columns: columnBlocks,
		},
	];
};

export const group: BlockTransformer = (block, _options, context) => {
	return context.transformBlocks(block.innerBlocks);
};

export const table: BlockTransformer = (block, _options, context) => {
	const tableMatch = block.innerHTML.match(TABLE_TAG_PATTERN);
	if (!tableMatch) {
		return [];
	}

	const tableContent = tableMatch[1]!;

	const theadMatch = tableContent.match(THEAD_TAG_PATTERN);
	const tbodyMatch = tableContent.match(TBODY_TAG_PATTERN);

	const rows: Array<{
		_type: "tableRow";
		_key: string;
		cells: Array<{
			_type: "tableCell";
			_key: string;
			content: import("../types.js").PortableTextSpan[];
			markDefs?: import("../types.js").PortableTextMarkDef[];
			isHeader?: boolean;
		}>;
	}> = [];

	if (theadMatch?.[1]) {
		const headerRows = parseTableRows(theadMatch[1], context, true);
		rows.push(...headerRows);
	}

	if (tbodyMatch?.[1]) {
		const bodyRows = parseTableRows(tbodyMatch[1], context, false);
		rows.push(...bodyRows);
	} else if (!theadMatch) {
		const directRows = parseTableRows(tableContent, context, false);
		rows.push(...directRows);
	}

	if (rows.length === 0) {
		return [];
	}

	return [
		{
			_type: "table" as const,
			_key: context.generateKey(),
			rows,
			hasHeaderRow: !!theadMatch,
		},
	];
};

function parseTableRows(
	html: string,
	context: import("../types.js").TransformContext,
	isHeader: boolean,
): Array<{
	_type: "tableRow";
	_key: string;
	cells: Array<{
		_type: "tableCell";
		_key: string;
		content: import("../types.js").PortableTextSpan[];
		markDefs?: import("../types.js").PortableTextMarkDef[];
		isHeader?: boolean;
	}>;
}> {
	const rows: Array<{
		_type: "tableRow";
		_key: string;
		cells: Array<{
			_type: "tableCell";
			_key: string;
			content: import("../types.js").PortableTextSpan[];
			markDefs?: import("../types.js").PortableTextMarkDef[];
			isHeader?: boolean;
		}>;
	}> = [];

	let rowMatch;

	while ((rowMatch = TABLE_ROW_PATTERN.exec(html)) !== null) {
		const rowContent = rowMatch[1]!;
		const cells: Array<{
			_type: "tableCell";
			_key: string;
			content: import("../types.js").PortableTextSpan[];
			markDefs?: import("../types.js").PortableTextMarkDef[];
			isHeader?: boolean;
		}> = [];

		let cellMatch;

		while ((cellMatch = TABLE_CELL_PATTERN.exec(rowContent)) !== null) {
			const isHeaderCell = cellMatch[1]!.toLowerCase() === "th" || isHeader;
			const cellContent = cellMatch[2]!;

			const { children, markDefs } = context.parseInlineContent(cellContent);

			cells.push({
				_type: "tableCell" as const,
				_key: context.generateKey(),
				content: children,
				markDefs: markDefs.length > 0 ? markDefs : undefined,
				isHeader: isHeaderCell || undefined,
			});
		}

		if (cells.length > 0) {
			rows.push({
				_type: "tableRow" as const,
				_key: context.generateKey(),
				cells,
			});
		}
	}

	return rows;
}

function toHeadingStyle(level: number): PortableTextTextBlock["style"] {
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
			return "h2";
	}
}

function mapAlignment(
	align: string | undefined,
): "left" | "center" | "right" | "wide" | "full" | undefined {
	switch (align) {
		case "left":
		case "center":
		case "right":
		case "wide":
		case "full":
			return align;
		default:
			return undefined;
	}
}

function decodeHtmlEntities(html: string): string {
	return html
		.replace(LT_ENTITY_PATTERN, "<")
		.replace(GT_ENTITY_PATTERN, ">")
		.replace(AMP_ENTITY_PATTERN, "&")
		.replace(QUOT_ENTITY_PATTERN, '"')
		.replace(APOS_ENTITY_PATTERN, "'")
		.replace(NBSP_ENTITY_PATTERN, " ");
}

export const button: BlockTransformer = (block, _options, context) => {
	const url = sanitizeHref(attrString(block.attrs, "url"));
	const text = extractText(block.innerHTML).trim() || "Button";

	let style: "default" | "outline" | "fill" = "default";
	const className = attrString(block.attrs, "className");
	if (className?.includes("is-style-outline")) {
		style = "outline";
	} else if (className?.includes("is-style-fill")) {
		style = "fill";
	}

	return [
		{
			_type: "button",
			_key: context.generateKey(),
			text,
			url,
			style,
		},
	];
};

export const buttons: BlockTransformer = (block, _options, context) => {
	const buttonBlocks: Array<{
		_type: "button";
		_key: string;
		text: string;
		url?: string;
		style?: "default" | "outline" | "fill";
	}> = [];

	for (const innerBlock of block.innerBlocks) {
		if (innerBlock.blockName === "core/button") {
			const url = attrString(innerBlock.attrs, "url");
			const text = extractText(innerBlock.innerHTML).trim() || "Button";

			let style: "default" | "outline" | "fill" = "default";
			const className = attrString(innerBlock.attrs, "className");
			if (className?.includes("is-style-outline")) {
				style = "outline";
			} else if (className?.includes("is-style-fill")) {
				style = "fill";
			}

			buttonBlocks.push({
				_type: "button",
				_key: context.generateKey(),
				text,
				url,
				style,
			});
		}
	}

	const layoutObj = attrObject(block.attrs, "layout");
	const layout =
		layoutObj && typeof layoutObj["type"] === "string" && layoutObj["type"] === "flex"
			? "horizontal"
			: "vertical";

	return [
		{
			_type: "buttons",
			_key: context.generateKey(),
			buttons: buttonBlocks,
			layout: layout,
		},
	];
};

export const cover: BlockTransformer = (block, _options, context) => {
	const url = attrString(block.attrs, "url");
	const overlayColor = attrString(block.attrs, "overlayColor");
	const customOverlayColor = attrString(block.attrs, "customOverlayColor");
	const dimRatio = attrNumber(block.attrs, "dimRatio");
	const minHeight = attrNumber(block.attrs, "minHeight");
	const minHeightUnit = attrString(block.attrs, "minHeightUnit");
	const contentPosition = attrString(block.attrs, "contentPosition");

	const content = context.transformBlocks(block.innerBlocks);

	let alignment: "left" | "center" | "right" | undefined;
	if (contentPosition?.includes("left")) alignment = "left";
	else if (contentPosition?.includes("right")) alignment = "right";
	else if (contentPosition?.includes("center")) alignment = "center";

	let minHeightStr: string | undefined;
	if (minHeight !== undefined) {
		minHeightStr = minHeightUnit ? `${minHeight}${minHeightUnit}` : `${minHeight}px`;
	}

	return [
		{
			_type: "cover",
			_key: context.generateKey(),
			backgroundImage: url,
			overlayColor: customOverlayColor || overlayColor,
			overlayOpacity: dimRatio !== undefined ? dimRatio / 100 : undefined,
			content,
			minHeight: minHeightStr,
			alignment,
		},
	];
};

export const file: BlockTransformer = (block, _options, context) => {
	const href = sanitizeHref(attrString(block.attrs, "href"));
	const fileName = attrString(block.attrs, "fileName");
	const showDownloadButton = attrBoolean(block.attrs, "showDownloadButton");

	let url = href;
	if (!url) {
		const hrefMatch = block.innerHTML.match(HREF_PATTERN);
		url = sanitizeHref(hrefMatch?.[1]);
	}

	let filename = fileName;
	if (!filename && url) {
		filename = url.split("/").pop()?.split("?")[0];
	}

	return [
		{
			_type: "file",
			_key: context.generateKey(),
			url: url || "",
			filename,
			showDownloadButton: showDownloadButton !== false,
		},
	];
};

export const pullquote: BlockTransformer = (block, _options, context) => {
	const pMatch = block.innerHTML.match(P_TAG_SINGLE_PATTERN);
	const text = pMatch ? extractText(pMatch[1]!) : extractText(block.innerHTML);

	const citeMatch = block.innerHTML.match(CITE_TAG_PATTERN);
	const citation = citeMatch ? extractText(citeMatch[1]!) : attrString(block.attrs, "citation");

	return [
		{
			_type: "pullquote",
			_key: context.generateKey(),
			text: text.trim(),
			citation: citation?.trim(),
		},
	];
};

export const html: BlockTransformer = (block, _options, context) => {
	return [
		{
			_type: "htmlBlock",
			_key: context.generateKey(),
			html: block.innerHTML.trim(),
			originalBlockName: "core/html",
		},
	];
};

export const verse: BlockTransformer = (block, _options, context) => {
	const text = extractText(block.innerHTML);

	return [
		{
			_type: "code",
			_key: context.generateKey(),
			code: text,
			language: "text",
		},
	];
};

export const more: BlockTransformer = (_block, _options, context) => {
	return [
		{
			_type: "break",
			_key: context.generateKey(),
			style: "lineBreak",
		},
	];
};

export const nextpage: BlockTransformer = (_block, _options, context) => {
	return [
		{
			_type: "break",
			_key: context.generateKey(),
			style: "lineBreak",
		},
	];
};

export const shortcode: BlockTransformer = (block, _options, context) => {
	return [
		{
			_type: "htmlBlock",
			_key: context.generateKey(),
			html: block.innerHTML.trim(),
			originalBlockName: "core/shortcode",
		},
	];
};

export const mediaText: BlockTransformer = (block, _options, context) => {
	const mediaId = attrNumber(block.attrs, "mediaId");
	const mediaUrl = attrString(block.attrs, "mediaUrl");
	const mediaType = attrString(block.attrs, "mediaType");
	const mediaPosition = attrString(block.attrs, "mediaPosition");
	const mediaAlt = attrString(block.attrs, "mediaAlt");

	const mediaBlock: PortableTextBlock[] =
		mediaType === "video"
			? [
					{
						_type: "embed",
						_key: context.generateKey(),
						url: mediaUrl || "",
						provider: "video",
					},
				]
			: [
					{
						_type: "image",
						_key: context.generateKey(),
						asset: {
							_type: "reference",
							_ref: String(mediaId || mediaUrl || ""),
							url: mediaUrl,
						},
						alt: mediaAlt,
					},
				];

	const contentBlocks = context.transformBlocks(block.innerBlocks);

	const mediaTextColumns =
		mediaPosition === "right"
			? [
					{ _type: "column" as const, _key: context.generateKey(), content: contentBlocks },
					{ _type: "column" as const, _key: context.generateKey(), content: mediaBlock },
				]
			: [
					{ _type: "column" as const, _key: context.generateKey(), content: mediaBlock },
					{ _type: "column" as const, _key: context.generateKey(), content: contentBlocks },
				];

	return [
		{
			_type: "columns",
			_key: context.generateKey(),
			columns: mediaTextColumns,
		},
	];
};
