import { buildContentPath, getContentData, getContentString, getString } from "./content.js";

export interface StandardPublication {
	$type: "site.standard.publication";
	url: string;
	name: string;
	description?: string;
}

export interface StandardDocument {
	$type: "site.standard.document";
	site: string;
	title: string;
	publishedAt: string;
	path?: string;
	description?: string;
	textContent?: string;
	tags?: string[];
	updatedAt?: string;
	coverImage?: BlobRefLike;
	bskyPostRef?: { uri: string; cid: string };
}

interface BlobRefLike {
	$type: "blob";
	ref: { $link: string };
	mimeType: string;
	size: number;
}

export function buildPublication(
	siteUrl: string,
	siteName: string,
	description?: string,
): StandardPublication {
	return {
		$type: "site.standard.publication",
		url: stripTrailingSlash(siteUrl),
		name: siteName,
		...(description ? { description } : {}),
	};
}

export function buildDocument(opts: {
	publicationUri: string;
	collection?: string;
	content: Record<string, unknown>;
	coverImageBlob?: BlobRefLike;
	bskyPostRef?: { uri: string; cid: string };
}): StandardDocument {
	const { publicationUri, collection, content, coverImageBlob, bskyPostRef } = opts;

	const title = getContentString(content, "title") || "Untitled";
	const description =
		getContentString(content, "excerpt") || getContentString(content, "description");
	const publishedAt =
		getString(content, "publishedAt") ||
		getString(content, "published_at") ||
		new Date().toISOString();
	const updatedAt = getString(content, "updatedAt") || getString(content, "updated_at");
	const tags = extractTags(content);

	const doc: StandardDocument = {
		$type: "site.standard.document",
		site: publicationUri,
		title,
		publishedAt,
	};

	const path = buildContentPath(collection, content);
	if (path) doc.path = path;

	if (description) {
		doc.description = description;
	}

	const plainText = extractPlainText(content);
	if (plainText) {
		doc.textContent = plainText;
	}

	if (tags.length > 0) {
		doc.tags = tags;
	}

	if (updatedAt) {
		doc.updatedAt = updatedAt;
	}

	if (coverImageBlob) {
		doc.coverImage = coverImageBlob;
	}

	if (bskyPostRef) {
		doc.bskyPostRef = bskyPostRef;
	}

	return doc;
}

function stripTrailingSlash(url: string): string {
	return url.endsWith("/") ? url.slice(0, -1) : url;
}

const HTML_TAG_RE = /<[^>]+>/g;
const NBSP_RE = /&nbsp;/g;
const AMP_RE = /&amp;/g;
const LT_RE = /&lt;/g;
const GT_RE = /&gt;/g;
const QUOT_RE = /&quot;/g;
const APOS_RE = /&#39;/g;
const WHITESPACE_RE = /\s+/g;
const HASH_PREFIX_RE = /^#/;
const MAX_TEXT_CONTENT_LENGTH = 10_000;

function extractTags(content: Record<string, unknown>): string[] {
	const raw = content.tags || getContentData(content).tags;
	if (!Array.isArray(raw)) return [];

	const tags: string[] = [];
	for (const item of raw) {
		if (typeof item === "string") {
			tags.push(item.replace(HASH_PREFIX_RE, ""));
		} else if (
			typeof item === "object" &&
			item !== null &&
			"name" in item &&
			typeof (item as Record<string, unknown>).name === "string"
		) {
			tags.push(((item as Record<string, unknown>).name as string).replace(HASH_PREFIX_RE, ""));
		}
	}
	return tags;
}

export function extractPlainText(content: Record<string, unknown>): string | undefined {
	const body =
		getContentString(content, "body") ||
		getContentString(content, "content") ||
		getContentString(content, "text");

	if (!body) return undefined;

	let text = body
		.replace(HTML_TAG_RE, " ")
		.replace(NBSP_RE, " ")
		.replace(LT_RE, "<")
		.replace(GT_RE, ">")
		.replace(QUOT_RE, '"')
		.replace(APOS_RE, "'")
		.replace(AMP_RE, "&")
		.replace(WHITESPACE_RE, " ")
		.trim();

	if (!text) return undefined;

	if (text.length > MAX_TEXT_CONTENT_LENGTH) {
		text = text.slice(0, MAX_TEXT_CONTENT_LENGTH - 1) + "\u2026";
	}

	return text;
}
