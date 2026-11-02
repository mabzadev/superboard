import DOMPurify from "dompurify";
import { Marked, Renderer } from "marked";

import { SAFE_URL_RE } from "./url.js";

const HTML_ESCAPE_MAP: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

const HTML_ESCAPE_RE = /[&<>"']/g;

function escapeHtml(str: string): string {
	return str.replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPE_MAP[ch]!);
}

const renderer = new Renderer();

renderer.link = function (this: Renderer, { href, tokens }) {
	const inner = this.parser.parseInline(tokens);
	if (!SAFE_URL_RE.test(href)) return inner;
	return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
};

renderer.image = ({ text }) => escapeHtml(text);

renderer.html = () => "";

const md = new Marked({ renderer, async: false });

const SANITIZE_CONFIG = {
	ALLOWED_TAGS: [
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"p",
		"a",
		"ul",
		"ol",
		"li",
		"blockquote",
		"pre",
		"code",
		"em",
		"strong",
		"del",
		"br",
		"hr",
		"table",
		"thead",
		"tbody",
		"tr",
		"th",
		"td",
		"details",
		"summary",
		"sup",
		"sub",
	],
	ALLOWED_ATTR: ["href", "target", "rel"],
};

export function renderMarkdown(markdown: string): string {
	const result = md.parse(markdown);
	const html = typeof result === "string" ? result : "";
	return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}
