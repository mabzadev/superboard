import type { Element } from "@emdash-cms/blocks";
import type { PluginDescriptor, ResolvedPlugin } from "emdash";
import { definePlugin } from "emdash";

import { EMBED_BLOCK_TYPES } from "./schemas.js";

const EMBED_BLOCK_META: Record<
	string,
	{
		label: string;
		icon?: string;
		description?: string;
		placeholder?: string;
		fields?: Element[];
	}
> = {
	youtube: {
		label: "YouTube Video",
		icon: "video",
		placeholder: "Paste YouTube URL...",
		fields: [
			{
				type: "text_input",
				action_id: "id",
				label: "YouTube URL",
				placeholder: "https://youtube.com/watch?v=...",
			},
			{ type: "text_input", action_id: "title", label: "Title" },
			{ type: "text_input", action_id: "poster", label: "Poster Image URL" },
			{
				type: "text_input",
				action_id: "params",
				label: "Player Parameters",
				placeholder: "start=57&end=75",
			},
		],
	},
	vimeo: {
		label: "Vimeo Video",
		icon: "video",
		placeholder: "Paste Vimeo URL...",
		fields: [
			{
				type: "text_input",
				action_id: "id",
				label: "Vimeo URL",
				placeholder: "https://vimeo.com/...",
			},
			{ type: "text_input", action_id: "poster", label: "Poster Image URL" },
			{ type: "text_input", action_id: "params", label: "Player Parameters" },
		],
	},
	tweet: { label: "Tweet (X)", icon: "link", placeholder: "Paste tweet URL..." },
	bluesky: { label: "Bluesky Post", icon: "link", placeholder: "Paste Bluesky post URL..." },
	mastodon: { label: "Mastodon Post", icon: "link", placeholder: "Paste Mastodon post URL..." },
	linkPreview: {
		label: "Link Preview",
		icon: "link-external",
		placeholder: "Paste any URL...",
	},
	gist: {
		label: "GitHub Gist",
		icon: "code",
		placeholder: "Paste Gist URL...",
		fields: [
			{
				type: "text_input",
				action_id: "id",
				label: "Gist URL",
				placeholder: "https://gist.github.com/.../...",
			},
			{
				type: "text_input",
				action_id: "file",
				label: "Specific File",
				placeholder: "Optional: filename to show",
			},
		],
	},
};

export interface EmbedsPluginOptions {
	types?: Array<(typeof EMBED_BLOCK_TYPES)[number]>;
}

export function embedsPlugin(
	options: EmbedsPluginOptions = {},
): PluginDescriptor<EmbedsPluginOptions> {
	return {
		id: "embeds",
		version: "0.0.1",
		entrypoint: "@emdash-cms/plugin-embeds",
		componentsEntry: "@emdash-cms/plugin-embeds/astro",
		options,
	};
}

export function createPlugin(options: EmbedsPluginOptions = {}): ResolvedPlugin {
	const _enabledTypes = options.types ?? [...EMBED_BLOCK_TYPES];

	return definePlugin({
		id: "embeds",
		version: "0.0.1",

		capabilities: [],

		admin: {
			portableTextBlocks: _enabledTypes.map((type) => {
				const meta = EMBED_BLOCK_META[type];
				return {
					type,
					label: meta?.label ?? type,
					icon: meta?.icon,
					description: meta?.description,
					placeholder: meta?.placeholder,
					fields: meta?.fields,
				};
			}),
		},
	});
}

export * from "./schemas.js";

export default createPlugin;

export { EMBED_BLOCK_TYPES };
