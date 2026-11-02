import type { BlobRef } from "./atproto.js";
import { buildContentPath, getContentString } from "./content.js";

const TEMPLATE_TITLE_RE = /\{title\}/g;
const TEMPLATE_URL_RE = /\{url\}/g;
const TEMPLATE_EXCERPT_RE = /\{excerpt\}/g;
const TRAILING_PUNCTUATION_RE = /[.,;:!?'"]+$/;
// Global regexes for facet detection -- reset lastIndex before each use
const URL_REGEX = /https?:\/\/[^\s)>\]]+/g;
const HASHTAG_REGEX = /(?<=\s|^)#([a-zA-Z0-9_]+)/g;

export interface BskyPost {
	$type: "app.bsky.feed.post";
	text: string;
	createdAt: string;
	langs?: string[];
	facets?: BskyFacet[];
	embed?: BskyEmbed;
}

export interface BskyFacet {
	index: { byteStart: number; byteEnd: number };
	features: Array<
		| { $type: "app.bsky.richtext.facet#link"; uri: string }
		| { $type: "app.bsky.richtext.facet#tag"; tag: string }
	>;
}

export type BskyEmbed = {
	$type: "app.bsky.embed.external";
	external: {
		uri: string;
		title: string;
		description: string;
		thumb?: BlobRef;
	};
};

export function buildBskyPost(opts: {
	template: string;
	collection?: string;
	content: Record<string, unknown>;
	siteUrl: string;
	thumbBlob?: BlobRef;
	langs?: string[];
}): BskyPost {
	const { template, collection, content, siteUrl, thumbBlob, langs } = opts;

	const title = getContentString(content, "title") || "Untitled";
	const excerpt =
		getContentString(content, "excerpt") || getContentString(content, "description") || "";
	const path = buildContentPath(collection, content);
	const url = path ? `${stripTrailingSlash(siteUrl)}${path}` : siteUrl;

	const fullText = template
		.replace(TEMPLATE_TITLE_RE, title)
		.replace(TEMPLATE_URL_RE, url)
		.replace(TEMPLATE_EXCERPT_RE, excerpt);

	const text = truncateGraphemes(fullText, 300);
	const wasTruncated = text !== fullText;

	const post: BskyPost = {
		$type: "app.bsky.feed.post",
		text,
		createdAt: new Date().toISOString(),
	};

	if (langs && langs.length > 0) {
		post.langs = langs.slice(0, 3);
	}

	if (!wasTruncated) {
		const facets = buildFacets(text);
		if (facets.length > 0) {
			post.facets = facets;
		}
	}

	post.embed = {
		$type: "app.bsky.embed.external",
		external: {
			uri: url,
			title,
			description: truncateGraphemes(excerpt, 300),
			...(thumbBlob ? { thumb: thumbBlob } : {}),
		},
	};

	return post;
}

export function buildFacets(text: string): BskyFacet[] {
	const encoder = new TextEncoder();
	const facets: BskyFacet[] = [];

	let match: RegExpExecArray | null;
	URL_REGEX.lastIndex = 0;
	while ((match = URL_REGEX.exec(text)) !== null) {
		const cleanUrl = match[0].replace(TRAILING_PUNCTUATION_RE, "");
		const beforeBytes = encoder.encode(text.slice(0, match.index));
		const matchBytes = encoder.encode(cleanUrl);
		facets.push({
			index: {
				byteStart: beforeBytes.length,
				byteEnd: beforeBytes.length + matchBytes.length,
			},
			features: [{ $type: "app.bsky.richtext.facet#link", uri: cleanUrl }],
		});
	}

	HASHTAG_REGEX.lastIndex = 0;
	while ((match = HASHTAG_REGEX.exec(text)) !== null) {
		const tag = match[1];
		if (!tag) continue;

		const beforeBytes = encoder.encode(text.slice(0, match.index));
		const matchBytes = encoder.encode(match[0]);
		facets.push({
			index: {
				byteStart: beforeBytes.length,
				byteEnd: beforeBytes.length + matchBytes.length,
			},
			features: [{ $type: "app.bsky.richtext.facet#tag", tag }],
		});
	}

	return facets;
}

function truncateGraphemes(text: string, maxGraphemes: number): string {
	const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
	const segments = [...segmenter.segment(text)];

	if (segments.length <= maxGraphemes) return text;

	return (
		segments
			.slice(0, maxGraphemes - 1)
			.map((s) => s.segment)
			.join("") + "\u2026"
	);
}

function stripTrailingSlash(url: string): string {
	return url.endsWith("/") ? url.slice(0, -1) : url;
}
