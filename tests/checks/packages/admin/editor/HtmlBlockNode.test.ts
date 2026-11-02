import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { HtmlBlockExtension } from "../../../../../packages/admin/src/components/editor/HtmlBlockNode";

describe("HtmlBlockExtension", () => {
	let editor: Editor;

	beforeEach(() => {
		editor = new Editor({
			extensions: [
				StarterKit.configure({
					heading: { levels: [1, 2, 3] },
				}),
				HtmlBlockExtension,
			],
			content: "",
		});
	});

	afterEach(() => {
		editor.destroy();
	});

	it("registers the htmlBlock schema node", () => {
		expect(editor.schema.nodes.htmlBlock).toBeDefined();
	});

	it("html attribute round-trips through the editor state", () => {
		editor.commands.insertContent({
			type: "htmlBlock",
			attrs: { html: '<div class="callout"><p>Hello</p></div>' },
		});
		const node = editor.getJSON().content?.find((n) => n.type === "htmlBlock");
		expect((node as { attrs?: { html?: string } }).attrs?.html).toBe(
			'<div class="callout"><p>Hello</p></div>',
		);
	});

	it("serializes markup to data-html-content, not a bare html attribute", () => {
		editor.commands.insertContent({
			type: "htmlBlock",
			attrs: { html: "<p>Injected</p>" },
		});
		const serialized = editor.getHTML();
		expect(serialized).toContain("data-html-content");
		expect(serialized).not.toMatch(/\shtml="/);
	});

	it("parses markup back from the data-html-content attribute", () => {
		editor.commands.setContent(
			'<div data-html-block data-html-content="&lt;p&gt;Round trip&lt;/p&gt;"></div>',
		);
		const node = editor.getJSON().content?.find((n) => n.type === "htmlBlock");
		expect(node).toBeDefined();
		expect((node as { attrs?: { html?: string } }).attrs?.html).toBe("<p>Round trip</p>");
	});
});
