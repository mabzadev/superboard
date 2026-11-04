import { afterEach, expect, it, vi } from "vitest";

import ContentPage from "../../../../../packages/plugins/superboard-data/src/front/content/ContentPage.js";
import { fireEvent, render, screen, waitFor } from "../../../packages/supbrd-front-ui/render.js";

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

it("opens content settings from the Settings tab of the Content page", async () => {
	window.history.replaceState(null, "", "/data/content?tab=settings");
	api.GET.mockResolvedValue({ data: { data: { items: [] } } });
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json({ data: { values: { "superboard-content__default_locale": "fr" } } }),
		),
	);
	render(<ContentPage />);
	expect(await screen.findByRole("tab", { name: "Settings", selected: true })).toBeVisible();
	expect(await screen.findByLabelText("Default language")).toHaveValue("fr");
	vi.unstubAllGlobals();
});

const article = {
	id: "doc-1",
	slug: "hello",
	locale: "en",
	status: "draft",
	data: { title: "Hello world" },
	liveRevisionId: null,
};
function mockContent(item: () => Promise<unknown> = async () => ({ item: article, _rev: "r1" })) {
	api.GET.mockImplementation(async (path: string) => {
		const [route = ""] = path.split("?");
		const data =
			route === "/_emdash/api/schema/collections"
				? { items: [{ slug: "articles", label: "Articles" }] }
				: route.endsWith("/fields")
					? { items: [{ slug: "title", label: "Title", type: "string" }] }
					: route === "/_emdash/api/content/articles"
						? { items: [article] }
						: route === "/_emdash/api/content/articles/doc-1"
							? await item()
							: route.endsWith("/revisions")
								? { items: [], total: 0 }
								: route.endsWith("/translations")
									? { translations: [article] }
									: { taxonomies: [] };
		return { data: { data } };
	});
}

it("edits a document in place of the list with stacked sections instead of a second tab row", async () => {
	mockContent();
	render(<ContentPage />);
	fireEvent.click(await screen.findByRole("button", { name: "Hello world" }));
	expect(await screen.findByRole("heading", { name: "Hello world" })).toBeVisible();
	expect(screen.queryByRole("button", { name: "Hello world" })).not.toBeInTheDocument();
	expect(screen.queryByLabelText("Collection")).not.toBeInTheDocument();
	expect(screen.getAllByRole("tablist")).toHaveLength(1);
	for (const section of ["Publication", "Revisions", "Translations", "Categories and tags"])
		expect(screen.getByRole("heading", { name: section })).toBeVisible();
	expect(screen.getByLabelText("Title")).toHaveValue("Hello world");
	fireEvent.click(screen.getByRole("button", { name: "Back to documents" }));
	expect(await screen.findByRole("button", { name: "Hello world" })).toBeVisible();
	expect(screen.getByLabelText("Collection")).toHaveValue("articles");
});

it("keeps the document sections on screen while the document reloads after publishing", async () => {
	let reload = false;
	mockContent(async () => (reload ? new Promise(() => {}) : { item: article, _rev: "r1" }));
	api.POST.mockImplementation(async () => {
		reload = true;
		return { data: { data: {} } };
	});
	render(<ContentPage />);
	fireEvent.click(await screen.findByRole("button", { name: "Hello world" }));
	fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
	await waitFor(() => {
		expect(
			api.GET.mock.calls.filter(([path]) =>
				String(path).startsWith("/_emdash/api/content/articles/doc-1?"),
			),
		).toHaveLength(2);
	});
	expect(screen.getByRole("heading", { name: "Hello world" })).toBeVisible();
	expect(screen.getByRole("heading", { name: "Publication" })).toBeVisible();
});

it("searches documents while typing in the toolbar", async () => {
	mockContent();
	render(<ContentPage />);
	fireEvent.change(await screen.findByLabelText("Search"), { target: { value: " hello " } });
	await waitFor(() => {
		expect(api.GET).toHaveBeenCalledWith(
			expect.stringMatching(/^\/_emdash\/api\/content\/articles\?.*q=hello/),
		);
	});
	expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
});
