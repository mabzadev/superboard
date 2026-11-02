import { Extension, InputRule, PasteRule } from "@tiptap/core";
import { isAllowedUri } from "@tiptap/extension-link";
import type { EditorState } from "@tiptap/pm/state";

const MARKDOWN_LINK_INPUT_REGEX = /\[([^\]]+)\]\(([^)]+)\)$/;

const MARKDOWN_LINK_PASTE_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;

interface RuleMatch {
	state: EditorState;
	range: { from: number; to: number };
	match: RegExpMatchArray;
}

function handleMarkdownLink({ state, range, match }: RuleMatch): null | void {
	const linkType = state.schema.marks["link"];
	const linkText = match[1];
	const href = match[2]?.trim();

	if (!linkType || !linkText || !href || !isAllowedUri(href)) return null;

	const { tr } = state;
	const mark = linkType.create({ href });

	tr.replaceWith(range.from, range.to, state.schema.text(linkText, [mark]));
	tr.removeStoredMark(linkType);
}

export const MarkdownLinkExtension = Extension.create({
	name: "markdownLink",

	addInputRules() {
		return [
			new InputRule({
				find: MARKDOWN_LINK_INPUT_REGEX,
				handler: handleMarkdownLink,
			}),
		];
	},

	addPasteRules() {
		return [
			new PasteRule({
				find: MARKDOWN_LINK_PASTE_REGEX,
				handler: handleMarkdownLink,
			}),
		];
	},
});
