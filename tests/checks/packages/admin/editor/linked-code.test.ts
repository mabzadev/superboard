import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { CodeMarkExtension } from "../../../../../packages/admin/src/components/editor/CodeMarkExtension";

function createEditor() {
	return new Editor({
		extensions: [
			StarterKit.configure({
				code: false,
				link: {
					openOnClick: false,
					enableClickSelection: true,
				},
			}),
			CodeMarkExtension,
		],
		content: "<p>fetch</p>",
	});
}

function marksOnFirstText(editor: Editor): string[] {
	const names: string[] = [];
	editor.state.doc.descendants((node) => {
		if (node.isText && names.length === 0) {
			for (const mark of node.marks) {
				names.push(mark.type.name);
			}
		}
	});
	return names.toSorted();
}

function firstBlockType(editor: Editor): string | null {
	const first = editor.state.doc.firstChild;
	return first?.type.name ?? null;
}

describe("linked inline code marks", () => {
	let editor: Editor;

	beforeEach(() => {
		editor = createEditor();
	});

	afterEach(() => {
		editor.destroy();
	});

	it("allows code and link on the same text node (code then link)", () => {
		editor.chain().focus().selectAll().toggleCode().setLink({ href: "https://example.com" }).run();

		expect(editor.isActive("code")).toBe(true);
		expect(editor.isActive("link")).toBe(true);
		expect(marksOnFirstText(editor)).toEqual(["code", "link"]);
	});

	it("allows code and link on the same text node (link then code)", () => {
		editor.chain().focus().selectAll().setLink({ href: "https://example.com" }).toggleCode().run();

		expect(editor.isActive("code")).toBe(true);
		expect(editor.isActive("link")).toBe(true);
		expect(marksOnFirstText(editor)).toEqual(["code", "link"]);
	});

	it("allows code and link inside a heading", () => {
		editor.commands.setContent("<h2>fetch</h2>");
		editor
			.chain()
			.focus()
			.selectAll()
			.toggleCode()
			.setLink({ href: "https://example.com/api" })
			.run();

		expect(firstBlockType(editor)).toBe("heading");
		expect(editor.state.doc.firstChild?.attrs.level).toBe(2);
		expect(marksOnFirstText(editor)).toEqual(["code", "link"]);
	});
});
