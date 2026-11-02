import * as React from "react";
import { describe, it, expect, vi } from "vitest";

import {
	ContentEditor,
	type ContentEditorProps,
} from "../../../../../packages/admin/src/components/ContentEditor";
import type { FieldDescriptor } from "../../../../../packages/admin/src/components/ContentEditor";
import type { ContentItem } from "../../../../../packages/admin/src/lib/api";
import { render } from "../utils/render.tsx";

let panelRenderCount = 0;

vi.mock("../../../../../packages/admin/src/components/ContentSettingsPanel", async () => {
	const actual = await vi.importActual<
		typeof import("../../../../../packages/admin/src/components/ContentSettingsPanel")
	>("../../../../../packages/admin/src/components/ContentSettingsPanel");
	return {
		...actual,
		ContentSettingsPanel: React.memo(function PanelProbe() {
			panelRenderCount++;
			return <div data-testid="panel-probe" />;
		}),
	};
});

vi.mock("@tanstack/react-router", async () => {
	const actual = await vi.importActual("@tanstack/react-router");
	return {
		...actual,
		Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
	};
});

const fields: Record<string, FieldDescriptor> = {
	title: { kind: "string", label: "Title", required: true },
	body: { kind: "string", label: "Body" },
};

function makeItem(): ContentItem {
	return {
		id: "item-1",
		type: "posts",
		slug: "my-post",
		status: "draft",
		data: { title: "My Post", body: "Some content" },
		authorId: null,
		createdAt: "2025-01-15T10:30:00Z",
		updatedAt: "2025-01-15T10:30:00Z",
		publishedAt: null,
		scheduledAt: null,
		liveRevisionId: null,
		draftRevisionId: null,
	};
}

describe("ContentSettingsPanel memo contract", () => {
	it("does not re-render the panel while the user types in the editor", async () => {
		const props: ContentEditorProps = {
			collection: "posts",
			collectionLabel: "Post",
			fields,
			isNew: false,
			item: makeItem(),
			onSave: vi.fn(),
			onAutosave: vi.fn(),
			onPublish: vi.fn(),
			onDelete: vi.fn(),
		};

		const screen = await render(<ContentEditor {...props} />);
		await expect.element(screen.getByTestId("panel-probe")).toBeInTheDocument();

		const baseline = panelRenderCount;
		expect(baseline).toBeGreaterThan(0);

		const titleInput = screen.getByLabelText("Title");
		await titleInput.fill("A completely new title");
		const bodyInput = screen.getByLabelText("Body");
		await bodyInput.fill("More typing in another field");

		await expect.element(screen.getByRole("button", { name: "Save" }).first()).toBeEnabled();

		expect(panelRenderCount).toBe(baseline);
	});
});
