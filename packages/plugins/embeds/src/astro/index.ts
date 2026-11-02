import BlueskyComponent from "./Bluesky.astro";
import GistComponent from "./Gist.astro";
import LinkPreviewComponent from "./LinkPreview.astro";
import MastodonComponent from "./Mastodon.astro";
import TweetComponent from "./Tweet.astro";
import VimeoComponent from "./Vimeo.astro";
import YouTubeComponent from "./YouTube.astro";

export {
	YouTubeComponent as youtube,
	VimeoComponent as vimeo,
	TweetComponent as tweet,
	BlueskyComponent as bluesky,
	MastodonComponent as mastodon,
	LinkPreviewComponent as linkPreview,
	GistComponent as gist,
};

export {
	YouTubeComponent as YouTube,
	VimeoComponent as Vimeo,
	TweetComponent as Tweet,
	BlueskyComponent as Bluesky,
	MastodonComponent as Mastodon,
	LinkPreviewComponent as LinkPreview,
	GistComponent as Gist,
};

export const blockComponents = {
	youtube: YouTubeComponent,
	vimeo: VimeoComponent,
	tweet: TweetComponent,
	bluesky: BlueskyComponent,
	mastodon: MastodonComponent,
	linkPreview: LinkPreviewComponent,
	gist: GistComponent,
} as const;

export { blockComponents as embedComponents };
