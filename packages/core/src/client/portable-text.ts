export interface PortableTextBlock {
	_type: string;
	_key?: string;
	style?: string;
	level?: number;
	listItem?: string;
	markDefs?: MarkDef[];
	children?: PortableTextSpan[];
	[key: string]: unknown;
}

interface PortableTextSpan {
	_type: string;
	_key?: string;
	text?: string;
	marks?: string[];
	[key: string]: unknown;
}

interface MarkDef {
	_key: string;
	_type: string;
	href?: string;
	[key: string]: unknown;
}

interface ParsedInline {
	spans: PortableTextSpan[];
	markDefs: MarkDef[];
}

export function portableTextToMarkdown(blocks: PortableTextBlock[]): string {
	const lines: string[] = [];
	let prevWasList = false;

	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];

		if (block._type === "block") {
			const isList = !!block.listItem;

			if (i > 0 && (!isList || !prevWasList)) {
				lines.push("");
			}

			lines.push(renderStandardBlock(block));
			prevWasList = isList;
		} else if (block._type === "code") {
			if (i > 0) lines.push("");
			const lang = (block.language as string) || "";
			const code = (block.code as string) || "";
			lines.push("```" + lang);
			lines.push(code);
			lines.push("```");
			prevWasList = false;
		} else if (block._type === "image") {
			if (i > 0) lines.push("");
			const alt = (block.alt as string) || "";
			const url = (block.asset as { url?: string })?.url || "";
			lines.push(`![${alt}](${url})`);
			prevWasList = false;
		} else {
			if (i > 0) lines.push("");
			lines.push(`<!--ec:block ${JSON.stringify(block)} -->`);
			prevWasList = false;
		}
	}

	return lines.join("\n") + "\n";
}

function renderStandardBlock(block: PortableTextBlock): string {
	const text = renderSpans(block.children ?? [], block.markDefs ?? []);

	if (block.listItem) {
		const indent = "  ".repeat(Math.max(0, (block.level ?? 1) - 1));
		const marker = block.listItem === "number" ? "1." : "-";
		return `${indent}${marker} ${text}`;
	}

	if (block.style && block.style.startsWith("h")) {
		const level = parseInt(block.style.substring(1), 10);
		if (level >= 1 && level <= 6) {
			return `${"#".repeat(level)} ${text}`;
		}
	}

	if (block.style === "blockquote") {
		return `> ${text}`;
	}

	return text;
}

function renderSpans(spans: PortableTextSpan[], markDefs: MarkDef[]): string {
	let result = "";

	for (const span of spans) {
		if (span._type !== "span") continue;

		let text = span.text ?? "";
		const marks = span.marks ?? [];

		for (const mark of marks) {
			const def = markDefs.find((d) => d._key === mark);
			if (def) {
				if (def._type === "link") {
					text = `[${text}](${def.href ?? ""})`;
				}
			} else {
				switch (mark) {
					case "strong":
						text = `**${text}**`;
						break;
					case "em":
						text = `_${text}_`;
						break;
					case "code":
						text = `\`${text}\``;
						break;
					case "strike-through":
					case "strikethrough":
						text = `~~${text}~~`;
						break;
				}
			}
		}

		result += text;
	}

	return result;
}

const OPAQUE_FENCE_PATTERN = /^<!--ec:block (.+) -->$/;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const UNORDERED_LIST_PATTERN = /^(\s*)[-*+]\s+(.+)$/;
const ORDERED_LIST_PATTERN = /^(\s*)\d+\.\s+(.+)$/;
const IMAGE_PATTERN = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const INLINE_MARKDOWN_PATTERN =
	/(\*\*(.+?)\*\*)|(_(.+?)_)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))|(~~(.+?)~~)/g;

export function markdownToPortableText(markdown: string): PortableTextBlock[] {
	const blocks: PortableTextBlock[] = [];
	const lines = markdown.split("\n");
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		const opaqueMatch = line.match(OPAQUE_FENCE_PATTERN);
		if (opaqueMatch) {
			try {
				blocks.push(JSON.parse(opaqueMatch[1]) as PortableTextBlock);
			} catch {
				blocks.push(makeBlock(line));
			}
			i++;
			continue;
		}

		if (line.startsWith("```")) {
			const lang = line.slice(3).trim();
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !lines[i].startsWith("```")) {
				codeLines.push(lines[i]);
				i++;
			}
			blocks.push({
				_type: "code",
				_key: generateKey(),
				language: lang || undefined,
				code: codeLines.join("\n"),
			});
			i++;
			continue;
		}

		if (line.trim() === "") {
			i++;
			continue;
		}

		const headingMatch = line.match(HEADING_PATTERN);
		if (headingMatch) {
			blocks.push(makeBlock(headingMatch[2], `h${headingMatch[1].length}`));
			i++;
			continue;
		}

		if (line.startsWith("> ")) {
			blocks.push(makeBlock(line.slice(2), "blockquote"));
			i++;
			continue;
		}

		const ulMatch = line.match(UNORDERED_LIST_PATTERN);
		if (ulMatch) {
			const level = Math.floor(ulMatch[1].length / 2) + 1;
			blocks.push(makeListBlock(ulMatch[2], "bullet", level));
			i++;
			continue;
		}

		const olMatch = line.match(ORDERED_LIST_PATTERN);
		if (olMatch) {
			const level = Math.floor(olMatch[1].length / 2) + 1;
			blocks.push(makeListBlock(olMatch[2], "number", level));
			i++;
			continue;
		}

		const imgMatch = line.match(IMAGE_PATTERN);
		if (imgMatch) {
			blocks.push({
				_type: "image",
				_key: generateKey(),
				alt: imgMatch[1],
				asset: { url: imgMatch[2] },
			});
			i++;
			continue;
		}

		blocks.push(makeBlock(line));
		i++;
	}

	return blocks;
}

function makeBlock(text: string, style: string = "normal"): PortableTextBlock {
	const { spans, markDefs } = parseInline(text);
	return { _type: "block", _key: generateKey(), style, markDefs, children: spans };
}

function makeListBlock(text: string, listItem: string, level: number): PortableTextBlock {
	const { spans, markDefs } = parseInline(text);
	return {
		_type: "block",
		_key: generateKey(),
		style: "normal",
		listItem,
		level,
		markDefs,
		children: spans,
	};
}

function parseInline(text: string): ParsedInline {
	const spans: PortableTextSpan[] = [];
	const markDefs: MarkDef[] = [];
	const regex = INLINE_MARKDOWN_PATTERN;

	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(text)) !== null) {
		if (match.index > lastIndex) {
			spans.push({
				_type: "span",
				_key: generateKey(),
				text: text.slice(lastIndex, match.index),
				marks: [],
			});
		}

		if (match[2] != null) {
			spans.push({ _type: "span", _key: generateKey(), text: match[2], marks: ["strong"] });
		} else if (match[4] != null) {
			spans.push({ _type: "span", _key: generateKey(), text: match[4], marks: ["em"] });
		} else if (match[6] != null) {
			spans.push({ _type: "span", _key: generateKey(), text: match[6], marks: ["code"] });
		} else if (match[8] != null && match[9] != null) {
			const key = generateKey();
			markDefs.push({ _key: key, _type: "link", href: match[9] });
			spans.push({ _type: "span", _key: generateKey(), text: match[8], marks: [key] });
		} else if (match[11] != null) {
			spans.push({
				_type: "span",
				_key: generateKey(),
				text: match[11],
				marks: ["strike-through"],
			});
		}

		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < text.length) {
		spans.push({ _type: "span", _key: generateKey(), text: text.slice(lastIndex), marks: [] });
	}

	if (spans.length === 0) {
		spans.push({ _type: "span", _key: generateKey(), text, marks: [] });
	}

	return { spans, markDefs };
}

let keyCounter = 0;

function generateKey(): string {
	return `k${(keyCounter++).toString(36)}`;
}

export function resetKeyCounter(): void {
	keyCounter = 0;
}

export interface FieldSchema {
	slug: string;
	type: string;
}

export function convertDataForRead(
	data: Record<string, unknown>,
	fields: FieldSchema[],
	raw: boolean = false,
): Record<string, unknown> {
	if (raw) return data;

	const result = { ...data };
	for (const field of fields) {
		if (field.type === "portableText" && Array.isArray(result[field.slug])) {
			result[field.slug] = portableTextToMarkdown(result[field.slug] as PortableTextBlock[]);
		}
	}
	return result;
}

export function convertDataForWrite(
	data: Record<string, unknown>,
	fields: FieldSchema[],
): Record<string, unknown> {
	const result = { ...data };
	for (const field of fields) {
		if (field.type === "portableText" && typeof result[field.slug] === "string") {
			result[field.slug] = markdownToPortableText(result[field.slug] as string);
		}
	}
	return result;
}
