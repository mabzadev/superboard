import { z } from "astro/zod";

const HTTP_SCHEME_RE = /^https?:\/\//i;

const httpUrl = z
	.string()
	.url()
	.refine((url) => HTTP_SCHEME_RE.test(url), "URL must use http or https");

export const youtubeBlockSchema = z.object({
	_type: z.literal("youtube"),
	_key: z.string(),
	id: z.string(),
	poster: httpUrl.optional(),
	posterQuality: z.enum(["max", "high", "default", "low"]).optional(),
	params: z.string().optional(),
	playlabel: z.string().optional(),
	title: z.string().optional(),
});

export type YouTubeBlock = z.infer<typeof youtubeBlockSchema>;

export const vimeoBlockSchema = z.object({
	_type: z.literal("vimeo"),
	_key: z.string(),
	id: z.string(),
	poster: httpUrl.optional(),
	posterQuality: z.enum(["max", "high", "default", "low"]).optional(),
	params: z.string().optional(),
	playlabel: z.string().optional(),
});

export type VimeoBlock = z.infer<typeof vimeoBlockSchema>;

export const tweetBlockSchema = z.object({
	_type: z.literal("tweet"),
	_key: z.string(),
	id: z.string(),
	theme: z.enum(["light", "dark"]).optional(),
});

export type TweetBlock = z.infer<typeof tweetBlockSchema>;

export const blueskyBlockSchema = z.object({
	_type: z.literal("bluesky"),
	_key: z.string(),
	id: z.string(),
});

export type BlueskyBlock = z.infer<typeof blueskyBlockSchema>;

export const mastodonBlockSchema = z.object({
	_type: z.literal("mastodon"),
	_key: z.string(),
	id: z.string(),
});

export type MastodonBlock = z.infer<typeof mastodonBlockSchema>;

export const linkPreviewBlockSchema = z.object({
	_type: z.literal("linkPreview"),
	_key: z.string(),
	id: httpUrl,
	hideMedia: z.boolean().optional(),
});

export type LinkPreviewBlock = z.infer<typeof linkPreviewBlockSchema>;

export const gistBlockSchema = z.object({
	_type: z.literal("gist"),
	_key: z.string(),
	id: httpUrl,
	file: z.string().optional(),
});

export type GistBlock = z.infer<typeof gistBlockSchema>;

export const embedBlockSchema = z.discriminatedUnion("_type", [
	youtubeBlockSchema,
	vimeoBlockSchema,
	tweetBlockSchema,
	blueskyBlockSchema,
	mastodonBlockSchema,
	linkPreviewBlockSchema,
	gistBlockSchema,
]);

export type EmbedBlock = z.infer<typeof embedBlockSchema>;

export const EMBED_BLOCK_TYPES = [
	"youtube",
	"vimeo",
	"tweet",
	"bluesky",
	"mastodon",
	"linkPreview",
	"gist",
] as const;

export type EmbedBlockType = (typeof EMBED_BLOCK_TYPES)[number];
