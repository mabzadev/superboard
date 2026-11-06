import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import {
	PortableTextEditor,
	type PortableTextEditorProps,
} from "../../../../../packages/admin/src/components/PortableTextEditor";
import { render } from "../utils/render";

vi.mock("../../../../../packages/admin/src/components/MediaPickerModal", () => ({
	MediaPickerModal: () => null,
}));

vi.mock("../../../../../packages/admin/src/components/SectionPickerModal", () => ({
	SectionPickerModal: () => null,
}));

vi.mock("../../../../../packages/admin/src/components/editor/DragHandleWrapper", () => ({
	DragHandleWrapper: () => null,
}));

const pluginBlocks: NonNullable<PortableTextEditorProps["pluginBlocks"]> = [
	{
		type: "test.video",
		pluginId: "test-blocks",
		label: "Test Video",
		fields: [
			{
				type: "number_input",
				action_id: "episode",
				label: "Episode",
			},
		],
	},
];

describe("plugin block label", () => {
	it("shows a number field value when the block has no id", async () => {
		const screen = await render(
			<PortableTextEditor
				value={[{ _type: "test.video", _key: "video-1", episode: 42 }]}
				onChange={vi.fn()}
				pluginBlocks={pluginBlocks}
			/>,
		);

		await expect.element(screen.getByText("Test Video")).toBeVisible();
		await expect.element(screen.getByText("42")).toBeVisible();
		expect(screen.getByText("test.video").query()).toBeNull();
	});
});
