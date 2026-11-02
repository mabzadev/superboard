import type { BlockTransformer } from "../types.js";
import { attrString } from "../types.js";

const IFRAME_SRC_PATTERN = /<iframe[^>]+src=["']([^"']+)["']/i;
const VIDEO_SRC_PATTERN = /<video[^>]+src=["']([^"']+)["']/i;
const VIDEO_SOURCE_PATTERN = /<source[^>]+src=["']([^"']+)["']/i;
const AUDIO_SRC_PATTERN = /<audio[^>]+src=["']([^"']+)["']/i;
const AUDIO_SOURCE_PATTERN = /<source[^>]+src=["']([^"']+)["']/i;

export const embed: BlockTransformer = (block, _options, context) => {
	const url = attrString(block.attrs, "url");
	const providerSlug = attrString(block.attrs, "providerNameSlug");

	const iframeMatch = block.innerHTML.match(IFRAME_SRC_PATTERN);
	const iframeSrc = iframeMatch?.[1];

	return [
		{
			_type: "embed",
			_key: context.generateKey(),
			url: url || iframeSrc || "",
			provider: providerSlug || detectProvider(url || iframeSrc || ""),
			html: block.innerHTML.trim() || undefined,
		},
	];
};

export const youtube: BlockTransformer = (block, options, context) => {
	return embed(block, options, context);
};

export const twitter: BlockTransformer = (block, options, context) => {
	return embed(block, options, context);
};

export const vimeo: BlockTransformer = (block, options, context) => {
	return embed(block, options, context);
};

export const video: BlockTransformer = (block, _options, context) => {
	const src = attrString(block.attrs, "src");

	const videoMatch = block.innerHTML.match(VIDEO_SRC_PATTERN);
	const sourceMatch = block.innerHTML.match(VIDEO_SOURCE_PATTERN);
	const videoSrc = src || videoMatch?.[1] || sourceMatch?.[1];

	return [
		{
			_type: "embed",
			_key: context.generateKey(),
			url: videoSrc || "",
			provider: "video",
			html: block.innerHTML.trim() || undefined,
		},
	];
};

export const audio: BlockTransformer = (block, _options, context) => {
	const src = attrString(block.attrs, "src");

	const audioMatch = block.innerHTML.match(AUDIO_SRC_PATTERN);
	const sourceMatch = block.innerHTML.match(AUDIO_SOURCE_PATTERN);
	const audioSrc = src || audioMatch?.[1] || sourceMatch?.[1];

	return [
		{
			_type: "embed",
			_key: context.generateKey(),
			url: audioSrc || "",
			provider: "audio",
			html: block.innerHTML.trim() || undefined,
		},
	];
};

function detectProvider(url: string): string | undefined {
	if (!url) return undefined;

	const urlLower = url.toLowerCase();

	if (urlLower.includes("youtube.com") || urlLower.includes("youtu.be")) {
		return "youtube";
	}
	if (urlLower.includes("vimeo.com")) {
		return "vimeo";
	}
	if (urlLower.includes("twitter.com") || urlLower.includes("x.com")) {
		return "twitter";
	}
	if (urlLower.includes("instagram.com")) {
		return "instagram";
	}
	if (urlLower.includes("facebook.com")) {
		return "facebook";
	}
	if (urlLower.includes("tiktok.com")) {
		return "tiktok";
	}
	if (urlLower.includes("spotify.com")) {
		return "spotify";
	}
	if (urlLower.includes("soundcloud.com")) {
		return "soundcloud";
	}
	if (urlLower.includes("codepen.io")) {
		return "codepen";
	}
	if (urlLower.includes("gist.github.com")) {
		return "gist";
	}

	return undefined;
}
