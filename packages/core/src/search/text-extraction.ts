import { toPlainText } from "@portabletext/toolkit";

import type { PortableTextBlock } from "../content/converters/types.js";

function isPortableTextArray(value: unknown[]): value is PortableTextBlock[] {
	return value.every(
		(item) =>
			typeof item === "object" &&
			item !== null &&
			"_type" in item &&
			typeof item._type === "string",
	);
}

function extractCustomBlockText(block: PortableTextBlock): string {
	if (block._type === "code" && "code" in block && typeof block.code === "string") {
		return block.code;
	}

	if (block._type === "image") {
		const parts: string[] = [];
		if ("alt" in block && typeof block.alt === "string" && block.alt) {
			parts.push(block.alt);
		}
		if ("caption" in block && typeof block.caption === "string" && block.caption) {
			parts.push(block.caption);
		}
		return parts.join(" ");
	}

	return "";
}

export function extractPlainText(blocks: PortableTextBlock[] | string | null | undefined): string {
	if (!blocks) {
		return "";
	}

	let parsedBlocks: PortableTextBlock[];
	if (typeof blocks === "string") {
		try {
			parsedBlocks = JSON.parse(blocks);
		} catch {
			return blocks;
		}
	} else {
		parsedBlocks = blocks;
	}

	if (!Array.isArray(parsedBlocks)) {
		return "";
	}

	const toolkitBlocks = parsedBlocks.map((b) => {
		const obj: Record<string, unknown> & { _type: string } = { _type: b._type };
		for (const [key, val] of Object.entries(b)) {
			obj[key] = val;
		}
		return obj;
	});
	const standardText = toPlainText(toolkitBlocks);

	const customTexts = parsedBlocks.map(extractCustomBlockText).filter((text) => text.length > 0);

	const allTexts = [standardText, ...customTexts].filter((t) => t.length > 0);
	return allTexts.join("\n");
}

export function extractSearchableFields(
	entry: Record<string, unknown>,
	fields: string[],
): Record<string, string> {
	const result: Record<string, string> = {};

	for (const field of fields) {
		const value = entry[field];

		if (value === null || value === undefined) {
			result[field] = "";
			continue;
		}

		if (typeof value === "string") {
			if (value.startsWith("[")) {
				result[field] = extractPlainText(value);
			} else {
				result[field] = value;
			}
		} else if (Array.isArray(value)) {
			if (isPortableTextArray(value)) {
				result[field] = extractPlainText(value);
			} else {
				result[field] = JSON.stringify(value);
			}
		} else if (typeof value === "object") {
			result[field] = JSON.stringify(value);
		} else if (typeof value === "number" || typeof value === "boolean") {
			result[field] = `${value}`;
		} else {
			result[field] = "";
		}
	}

	return result;
}
