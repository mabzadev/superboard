import { afterEach, expect, it, vi } from "vitest";

import ContentPage from "../../../../../packages/plugins/superboard-data/src/front/content/ContentPage.js";
import { fireEvent, render, screen } from "../../../packages/supbrd-front-ui/render.js";

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
vi.mock(
	"../../../../../packages/plugins/superboard-data/src/front/content/transport.js",
	() => api,
);
afterEach(() => {
	vi.resetAllMocks();
	window.history.replaceState(null, "", "/");
});

it("keeps the collections view accessible when no collection exists", async () => {
	api.GET.mockResolvedValue({ data: { data: { items: [] } } });
	render(<ContentPage />);
	fireEvent.mouseDown(await screen.findByRole("tab", { name: "Collections" }), {
		button: 0,
		ctrlKey: false,
	});
	expect(await screen.findByRole("button", { name: "Create collection" })).toBeVisible();
	expect(screen.getByLabelText("Collection name")).toBeEnabled();
});

it("restores a trashed document and removes it from the trash listing", async () => {
	let trashed = true;
	window.history.replaceState(null, "", "/data/content?tab=trash");
	api.GET.mockImplementation(async (path: string) => ({
		data: {
			data: {
				items: path.includes("schema/collections")
					? [{ slug: "articles", label: "Articles" }]
					: trashed
						? [
								{
									id: "item-1",
									slug: "article",
									locale: "en",
									status: "draft",
									data: { title: "Deleted article" },
								},
							]
						: [],
			},
		},
	}));
	api.POST.mockImplementation(async () => {
		trashed = false;
		return { data: { data: {} } };
	});
	render(<ContentPage />);
	fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
	expect(await screen.findByText("No documents")).toBeVisible();
	expect(screen.queryByText("Deleted article")).not.toBeInTheDocument();
});
