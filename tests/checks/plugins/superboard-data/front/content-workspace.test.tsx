import { FrontContextProvider } from "@superboard/front-ui/context";
import { ApiError } from "@superboard/front-ui/lib/ApiError.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ContentPage from "../../../../../packages/plugins/superboard-data/src/front/content/ContentPage.js";
import { fireEvent, render, screen, waitFor } from "../../../packages/supbrd-front-ui/render.js";

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
vi.mock(
	"../../../../../packages/plugins/superboard-data/src/front/content/transport.js",
	() => api,
);
beforeEach(() => {
	window.history.replaceState(null, "", "/data/content");
});
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

it("gives the document sheet its own address and leaves it with the browser back button", async () => {
	window.history.replaceState(null, "", "/data/content?lang=en");
	let listedTitle = "Hello world";
	mockContent();
	const content = api.GET.getMockImplementation();
	api.GET.mockImplementation(async (path: string) =>
		path.startsWith("/_emdash/api/content/articles?")
			? { data: { data: { items: [{ ...article, data: { title: listedTitle } }] } } }
			: content?.(path),
	);
	render(<ContentPage />);
	fireEvent.change(await screen.findByLabelText("Search"), { target: { value: "hello" } });
	await waitFor(() => {
		expect(api.GET).toHaveBeenCalledWith(expect.stringMatching(/articles\?.*q=hello/));
	});
	fireEvent.click(await screen.findByRole("button", { name: "Hello world" }));
	expect(await screen.findByRole("heading", { name: "Hello world" })).toBeVisible();
	const address = new URLSearchParams(window.location.search);
	expect(address.get("document")).toBe("doc-1");
	expect(address.get("collection")).toBe("articles");
	expect(address.get("lang")).toBe("en");
	listedTitle = "Hello again";
	window.history.back();
	expect(await screen.findByRole("button", { name: "Hello again" })).toBeVisible();
	expect(screen.queryByRole("heading", { name: "Hello world" })).not.toBeInTheDocument();
	expect(new URLSearchParams(window.location.search).get("document")).toBeNull();
	expect(screen.getByLabelText("Search")).toHaveValue("hello");
});

it("removes the document from the address when returning to the list", async () => {
	mockContent();
	render(<ContentPage />);
	fireEvent.click(await screen.findByRole("button", { name: "Hello world" }));
	expect(new URLSearchParams(window.location.search).get("document")).toBe("doc-1");
	fireEvent.click(await screen.findByRole("button", { name: "Back to documents" }));
	expect(await screen.findByRole("button", { name: "Hello world" })).toBeVisible();
	expect(new URLSearchParams(window.location.search).get("document")).toBeNull();
});

it("opens a document of any collection directly from its address", async () => {
	const page = { ...article, id: "doc-2", slug: "about", data: { title: "About us" } };
	window.history.replaceState(null, "", "/data/content?collection=pages&document=doc-2");
	api.GET.mockImplementation(async (path: string) => {
		const [route = ""] = path.split("?");
		const data =
			route === "/_emdash/api/schema/collections"
				? {
						items: [
							{ slug: "articles", label: "Articles" },
							{ slug: "pages", label: "Pages" },
						],
					}
				: route.endsWith("/fields")
					? { items: [{ slug: "title", label: "Title", type: "string" }] }
					: route === "/_emdash/api/content/pages/doc-2"
						? { item: page, _rev: "r1" }
						: route.endsWith("/revisions")
							? { items: [], total: 0 }
							: route.endsWith("/translations")
								? { translations: [page] }
								: route.startsWith("/_emdash/api/content/")
									? { items: [page] }
									: { taxonomies: [] };
		return { data: { data } };
	});
	render(<ContentPage />);
	expect(await screen.findByRole("heading", { name: "About us" })).toBeVisible();
	expect(screen.getByLabelText("Title")).toHaveValue("About us");
	fireEvent.click(screen.getByRole("button", { name: "Back to documents" }));
	expect(await screen.findByLabelText("Collection")).toHaveValue("pages");
});

it.each([
	{
		locale: "en",
		message: "Document not found. It may have been deleted or moved to the trash.",
		retry: "Retry",
		back: "Back to documents",
	},
	{
		locale: "fr",
		message: "Document introuvable. Il a peut-être été supprimé ou mis à la corbeille.",
		retry: "Réessayer",
		back: "Retour aux documents",
	},
] as const)(
	"explains in $locale that the document of an address does not exist",
	async ({ locale, message, retry, back }) => {
		window.history.replaceState(null, "", "/data/content?collection=articles&document=missing");
		mockContent();
		const content = api.GET.getMockImplementation();
		api.GET.mockImplementation(async (path: string) => {
			if (path.startsWith("/_emdash/api/content/articles/missing?"))
				throw new ApiError("Content item not found: missing", 404, "NOT_FOUND");
			return content?.(path);
		});
		render(
			<FrontContextProvider
				value={{
					instanceId: "1",
					pluginId: "superboard-content",
					path: "/data/content",
					parameters: {},
					locale,
					operator: null,
					projectScope: null,
					activePluginIds: ["superboard-content"],
				}}
			>
				<ContentPage />
			</FrontContextProvider>,
		);
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent(message);
		expect(alert).not.toHaveTextContent("Content item not found");
		expect(screen.getByRole("button", { name: retry })).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: back }));
		expect(await screen.findByRole("button", { name: "Hello world" })).toBeVisible();
		expect(new URLSearchParams(window.location.search).get("document")).toBeNull();
	},
);

it("opens the new document form from its address and replaces it with the created document", async () => {
	const created = { ...article, id: "doc-9", slug: "fresh", data: { title: "Fresh" } };
	mockContent(async () => ({ item: article, _rev: "r1" }));
	const listed = api.GET.getMockImplementation();
	api.GET.mockImplementation(async (path: string) =>
		path.startsWith("/_emdash/api/content/articles/doc-9?")
			? { data: { data: { item: created, _rev: "r1" } } }
			: listed?.(path),
	);
	api.POST.mockResolvedValue({ data: { data: { item: created } } });
	render(<ContentPage />);
	await screen.findByRole("button", { name: "Hello world" });
	fireEvent.click(screen.getByRole("button", { name: "New document" }));
	expect(await screen.findByRole("heading", { name: "New document" })).toBeVisible();
	expect(new URLSearchParams(window.location.search).get("document")).toBe("new");
	fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Fresh" } });
	fireEvent.click(screen.getByRole("button", { name: "Create document" }));
	expect(await screen.findByRole("heading", { name: "Fresh" })).toBeVisible();
	expect(new URLSearchParams(window.location.search).get("document")).toBe("doc-9");
	window.history.back();
	expect(await screen.findByRole("button", { name: "Hello world" })).toBeVisible();
	expect(screen.queryByRole("heading", { name: "Fresh" })).not.toBeInTheDocument();
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
