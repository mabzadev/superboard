import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

import type { PortableTextSpan, PortableTextMarkDef } from "./types.js";
import { sanitizeHref } from "./url.js";

const WHITESPACE_PATTERN = /\S/;

const BLOCK_TAG_PATTERNS: Record<string, { open: RegExp; close: RegExp }> = {
	p: { open: /^<p[^>]*>/i, close: /<\/p>$/i },
	h1: { open: /^<h1[^>]*>/i, close: /<\/h1>$/i },
	h2: { open: /^<h2[^>]*>/i, close: /<\/h2>$/i },
	h3: { open: /^<h3[^>]*>/i, close: /<\/h3>$/i },
	h4: { open: /^<h4[^>]*>/i, close: /<\/h4>$/i },
	h5: { open: /^<h5[^>]*>/i, close: /<\/h5>$/i },
	h6: { open: /^<h6[^>]*>/i, close: /<\/h6>$/i },
	li: { open: /^<li[^>]*>/i, close: /<\/li>$/i },
	blockquote: { open: /^<blockquote[^>]*>/i, close: /<\/blockquote>$/i },
	figcaption: { open: /^<figcaption[^>]*>/i, close: /<\/figcaption>$/i },
};

const IMG_ALT_PATTERN = /<img[^>]+alt=["']([^"']*)["']/i;
const FIGCAPTION_PATTERN = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i;
const IMG_SRC_PATTERN = /<img[^>]+src=["']([^"']*)["']/i;
const URL_AMP_ENTITY_PATTERN = /&amp;/g;
const URL_NUMERIC_AMP_ENTITY_PATTERN = /&#0?38;/g;
const URL_HEX_AMP_ENTITY_PATTERN = /&#x26;/gi;

type Node = DefaultTreeAdapterMap["node"];
type TextNode = DefaultTreeAdapterMap["textNode"];
type Element = DefaultTreeAdapterMap["element"];

interface ParseResult {
	children: PortableTextSpan[];
	markDefs: PortableTextMarkDef[];
}

export function parseInlineContent(html: string, generateKey: () => string): ParseResult {
	const children: PortableTextSpan[] = [];
	const markDefs: PortableTextMarkDef[] = [];
	const markDefMap = new Map<string, string>();

	if (html.length > 0 && !WHITESPACE_PATTERN.test(html)) {
		return {
			children: [{ _type: "span", _key: generateKey(), text: html }],
			markDefs: [],
		};
	}

	const strippedHtml = stripBlockTags(html);

	const fragment = parseFragment(strippedHtml);

	walkNodes(fragment.childNodes, [], children, markDefs, markDefMap, generateKey);

	if (children.length === 0) {
		children.push({
			_type: "span",
			_key: generateKey(),
			text: "",
		});
	}

	return { children, markDefs };
}

function stripBlockTags(html: string): string {
	let stripped = html.trim();

	const blockTags = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "figcaption"];

	for (const tag of blockTags) {
		const patterns = BLOCK_TAG_PATTERNS[tag];
		if (patterns && patterns.open.test(stripped) && patterns.close.test(stripped)) {
			stripped = stripped.replace(patterns.open, "").replace(patterns.close, "").trim();
			break;
		}
	}

	return stripped;
}

function walkNodes(
	nodes: Node[],
	currentMarks: string[],
	children: PortableTextSpan[],
	markDefs: PortableTextMarkDef[],
	markDefMap: Map<string, string>,
	generateKey: () => string,
): void {
	for (const node of nodes) {
		if (isTextNode(node)) {
			const text = node.value;
			if (text) {
				const parts = text.split("\n");
				for (let i = 0; i < parts.length; i++) {
					const part = parts[i];
					if (part || i > 0) {
						if (part) {
							children.push({
								_type: "span",
								_key: generateKey(),
								text: part,
								marks: currentMarks.length > 0 ? [...currentMarks] : undefined,
							});
						}
						if (i < parts.length - 1) {
							if (children.length > 0) {
								const lastChild = children.at(-1);
								if (lastChild) {
									lastChild.text += "\n";
								}
							} else {
								children.push({
									_type: "span",
									_key: generateKey(),
									text: "\n",
								});
							}
						}
					}
				}
			}
		} else if (isElement(node)) {
			const tagName = node.tagName.toLowerCase();

			if (tagName === "br") {
				if (children.length > 0) {
					const lastChild = children.at(-1);
					if (lastChild) {
						lastChild.text += "\n";
					}
				} else {
					children.push({
						_type: "span",
						_key: generateKey(),
						text: "\n",
					});
				}
				continue;
			}

			const markResult = getMarkForElement(node, markDefs, markDefMap, generateKey);
			const newMarks = markResult ? [...currentMarks, markResult] : currentMarks;

			walkNodes(node.childNodes, newMarks, children, markDefs, markDefMap, generateKey);
		}
	}
}

function getMarkForElement(
	element: Element,
	markDefs: PortableTextMarkDef[],
	markDefMap: Map<string, string>,
	generateKey: () => string,
): string | null {
	const tagName = element.tagName.toLowerCase();

	switch (tagName) {
		case "strong":
		case "b":
			return "strong";

		case "em":
		case "i":
			return "em";

		case "u":
			return "underline";

		case "s":
		case "strike":
		case "del":
			return "strike-through";

		case "code":
			return "code";

		case "sup":
			return "superscript";

		case "sub":
			return "subscript";

		case "a": {
			const href = sanitizeHref(getAttr(element, "href"));
			const target = getAttr(element, "target");

			const existingKey = markDefMap.get(href);
			if (existingKey) {
				return existingKey;
			}

			const key = generateKey();
			const markDef: PortableTextMarkDef = {
				_type: "link",
				_key: key,
				href,
			};
			if (target === "_blank") {
				markDef.blank = true;
			}
			markDefs.push(markDef);
			markDefMap.set(href, key);
			return key;
		}

		default:
			return null;
	}
}

function getAttr(element: Element, name: string): string | undefined {
	const attr = element.attrs.find((a) => a.name.toLowerCase() === name);
	return attr?.value;
}

function isTextNode(node: Node): node is TextNode {
	return node.nodeName === "#text";
}

function isElement(node: Node): node is Element {
	return "tagName" in node;
}

export function extractText(html: string): string {
	const fragment = parseFragment(html);
	return getTextContent(fragment.childNodes);
}

function getTextContent(nodes: Node[]): string {
	let text = "";
	for (const node of nodes) {
		if (isTextNode(node)) {
			text += node.value;
		} else if (isElement(node)) {
			text += getTextContent(node.childNodes);
		}
	}
	return text.trim();
}

export function extractAlt(html: string): string | undefined {
	const match = html.match(IMG_ALT_PATTERN);
	if (match) {
		return match[1];
	}
	return undefined;
}

export function extractCaption(html: string): string | undefined {
	const match = html.match(FIGCAPTION_PATTERN);
	if (match?.[1]) {
		return extractText(match[1]);
	}
	return undefined;
}

export function extractSrc(html: string): string | undefined {
	const match = html.match(IMG_SRC_PATTERN);
	if (!match?.[1]) return undefined;
	return decodeUrlEntities(match[1]);
}

function decodeUrlEntities(url: string): string {
	return url
		.replace(URL_AMP_ENTITY_PATTERN, "&")
		.replace(URL_NUMERIC_AMP_ENTITY_PATTERN, "&")
		.replace(URL_HEX_AMP_ENTITY_PATTERN, "&");
}
