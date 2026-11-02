import type { BlockTransformer, PortableTextBlock } from "../types.js";
import * as core from "./core.js";
import * as embed from "./embed.js";

export const defaultTransformers: Record<string, BlockTransformer> = {
	"core/paragraph": core.paragraph,
	"core/heading": core.heading,
	"core/list": core.list,
	"core/quote": core.quote,
	"core/code": core.code,
	"core/preformatted": core.preformatted,
	"core/pullquote": core.pullquote,
	"core/verse": core.verse,

	"core/image": core.image,
	"core/gallery": core.gallery,
	"core/file": core.file,
	"core/media-text": core.mediaText,
	"core/cover": core.cover,

	"core/columns": core.columns,
	"core/group": core.group,
	"core/separator": core.separator,
	"core/spacer": core.separator,
	"core/table": core.table,
	"core/buttons": core.buttons,
	"core/button": core.button,

	"core/more": core.more,
	"core/nextpage": core.nextpage,

	"core/html": core.html,
	"core/shortcode": core.shortcode,

	"core/embed": embed.embed,
	"core/video": embed.video,
	"core/audio": embed.audio,

	"core-embed/youtube": embed.youtube,
	"core-embed/twitter": embed.twitter,
	"core-embed/vimeo": embed.vimeo,
	"core-embed/facebook": embed.embed,
	"core-embed/instagram": embed.embed,
	"core-embed/soundcloud": embed.embed,
	"core-embed/spotify": embed.embed,
};

export const fallbackTransformer: BlockTransformer = (
	block,
	_options,
	context,
): PortableTextBlock[] => {
	if (!block.innerHTML.trim() && block.innerBlocks.length === 0) {
		return [];
	}

	if (block.innerBlocks.length > 0) {
		return context.transformBlocks(block.innerBlocks);
	}

	return [
		{
			_type: "htmlBlock",
			_key: context.generateKey(),
			html: block.innerHTML,
			originalBlockName: block.blockName,
			originalAttrs: Object.keys(block.attrs).length > 0 ? block.attrs : undefined,
		},
	];
};

export function getTransformer(
	blockName: string | null,
	customTransformers?: Record<string, BlockTransformer>,
): BlockTransformer {
	if (!blockName) {
		return fallbackTransformer;
	}

	if (customTransformers?.[blockName]) {
		return customTransformers[blockName];
	}

	if (defaultTransformers[blockName]) {
		return defaultTransformers[blockName];
	}

	return fallbackTransformer;
}
