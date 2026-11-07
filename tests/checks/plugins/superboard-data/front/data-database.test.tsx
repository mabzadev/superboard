import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import DatabasePage from "../../../../../packages/plugins/superboard-data/src/front/files/data/DatabasePage.js";
import {
	FrontContextProvider,
	type FrontContextValue,
} from "../../../../../packages/supbrd-front-ui/src/context.js";
import { ApiError } from "../../../../../packages/supbrd-front-ui/src/shared/lib/ApiError.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../../packages/supbrd-front-ui/render.js";

const api = vi.hoisted(() => ({
	GET: vi.fn(),
	POST: vi.fn(),
	PUT: vi.fn(),
	PATCH: vi.fn(),
	DELETE: vi.fn(),
}));
vi.mock("../../../../../packages/plugins/superboard-data/src/front/files/transport.js", () => api);
vi.mock("@superboard/front-ui/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: { id: "prod" } }),
}));

const base = "/api/v1/files/projects/prod/data";
const posts = {
	name: "posts",
	label: "Blog posts",
	rules: { read: "public", insert: "owner", update: "owner", delete: "owner" },
	realtime: false,
	columns: [
		{
			name: "title",
			type: "text",
			nullable: false,
			default: null,
			unique: false,
			indexed: false,
			position: 0,
		},
		{
			name: "views",
			type: "integer",
			nullable: true,
			default: 0,
			unique: false,
			indexed: true,
			position: 1,
		},
		{
			name: "meta",
			type: "json",
			nullable: true,
			default: null,
			unique: false,
			indexed: false,
			position: 2,
		},
	],
	created_at: "2026-11-07T10:00:00.000Z",
	updated_at: "2026-11-07T10:00:00.000Z",
};
const notes = { ...posts, name: "notes", label: null, realtime: true, columns: [] };

function serve(overrides: Record<string, unknown> = {}) {
	api.GET.mockImplementation(async (path: string) => {
		const [route = "", query = ""] = path.split("?");
		if (route in overrides) return { data: overrides[route] };
		if (route === `${base}/status`)
			return {
				data: {
					project_id: 12,
					features: {
						realtime: true,
						functions: true,
						function_secrets: true,
						image_transformations: false,
						vectors: false,
					},
					counts: { tables: 2, buckets: 0, functions: 0 },
				},
			};
		if (route === `${base}/tables`) return { data: { items: [notes, posts] } };
		if (route === `${base}/tables/posts`) return { data: { ...posts, row_count: 1234 } };
		if (route === `${base}/tables/notes`) return { data: { ...notes, row_count: 0 } };
		if (route === `${base}/tables/posts/rows`)
			return {
				data: new URLSearchParams(query).get("cursor")
					? {
							items: [{ id: "row-2", title: "Second", views: 2, meta: null, owner_id: null }],
							count: 2,
						}
					: {
							items: [
								{ id: "row-1", title: "First", views: 1, meta: { tag: "a" }, owner_id: "u1" },
							],
							count: 2,
							nextCursor: "cursor-1",
						},
			};
		throw new Error(`Unexpected GET ${path}`);
	});
}

function second<T>(items: T[]): T {
	const item = items[1];
	if (item === undefined) throw new Error("Second element missing");
	return item;
}

function renderIn(locale: "en" | "fr", ui: ReactNode) {
	const value: FrontContextValue = {
		instanceId: "1",
		pluginId: "superboard-files",
		path: "/data/database",
		parameters: {},
		locale,
		operator: null,
		projectScope: null,
		activePluginIds: ["superboard-files"],
	};
	return render(<FrontContextProvider value={value}>{ui}</FrontContextProvider>);
}

beforeAll(() => {
	if (!("PointerEvent" in window))
		Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });
});
beforeEach(() => {
	window.history.replaceState(null, "", "/data/database");
});
afterEach(() => {
	cleanup();
	vi.resetAllMocks();
	window.history.replaceState(null, "", "/");
});

it("lists the tables of the project with their row counts from the operator routes", async () => {
	serve();
	renderIn("en", <DatabasePage />);
	const row = (await screen.findByRole("button", { name: "posts" })).closest("tr");
	if (!row) throw new Error("Table row missing");
	await waitFor(() => {
		expect(within(row).getByText("1,234")).toBeVisible();
	});
	expect(within(row).getByText("Blog posts")).toBeVisible();
	expect(api.GET).toHaveBeenCalledWith(`${base}/tables`);
	expect(api.GET).toHaveBeenCalledWith(`${base}/tables/posts`);
	expect(api.GET).toHaveBeenCalledWith(`${base}/tables/notes`);
});

it("shows the database page and table states in French", async () => {
	serve();
	renderIn("fr", <DatabasePage />);
	expect(await screen.findByRole("heading", { name: "Base de données" })).toBeVisible();
	const row = (await screen.findByRole("button", { name: "notes" })).closest("tr");
	if (!row) throw new Error("Table row missing");
	expect(within(row).getByText("Activé")).toBeVisible();
	expect(screen.getByRole("columnheader", { name: "Lignes" })).toBeVisible();
	expect(screen.getByRole("heading", { name: "Créer une table" })).toBeVisible();
});

it("creates a table with typed columns and keeps options hidden until they apply", async () => {
	serve();
	api.POST.mockResolvedValue({ data: { ...posts, name: "events", label: null } });
	renderIn("en", <DatabasePage />);
	fireEvent.change(await screen.findByLabelText("Table name"), { target: { value: "events" } });
	fireEvent.change(screen.getByLabelText("Column name"), { target: { value: "score" } });
	expect(screen.queryByLabelText("Value used when a row has none")).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("switch", { name: "Default value" }));
	fireEvent.change(screen.getByLabelText("Value used when a row has none"), {
		target: { value: "seed" },
	});
	fireEvent.click(screen.getByRole("switch", { name: "Required" }));
	fireEvent.click(screen.getByRole("button", { name: "Add a column" }));
	fireEvent.change(second(screen.getAllByLabelText("Column name")), { target: { value: "slug" } });
	fireEvent.click(second(screen.getAllByRole("switch", { name: "Unique" })));
	expect(screen.getAllByRole("switch", { name: "Indexed" })).toHaveLength(1);
	expect(screen.getAllByRole("switch", { name: "Default value" })).toHaveLength(1);
	fireEvent.click(screen.getByRole("button", { name: "Create the table" }));
	await waitFor(() => {
		expect(api.POST).toHaveBeenCalledWith(`${base}/tables`, {
			name: "events",
			label: null,
			columns: [
				{
					name: "score",
					type: "text",
					nullable: false,
					unique: false,
					indexed: false,
					default: "seed",
				},
				{ name: "slug", type: "text", nullable: true, unique: true, indexed: true, default: null },
			],
		});
	});
	await waitFor(() => {
		expect(new URLSearchParams(window.location.search).get("table")).toBe("events");
	});
});

it("browses the rows of a table page by page", async () => {
	window.history.replaceState(null, "", "/data/database?table=posts");
	serve();
	renderIn("en", <DatabasePage />);
	expect(await screen.findByRole("cell", { name: "First" })).toBeVisible();
	expect(screen.getByRole("cell", { name: '{"tag":"a"}' })).toBeVisible();
	expect(screen.getByText("2 rows")).toBeVisible();
	expect(api.GET).toHaveBeenCalledWith(`${base}/tables/posts/rows?limit=50&count=exact`);
	fireEvent.click(screen.getByRole("button", { name: "Next page" }));
	expect(await screen.findByRole("cell", { name: "Second" })).toBeVisible();
	expect(api.GET).toHaveBeenCalledWith(
		`${base}/tables/posts/rows?limit=50&count=exact&cursor=cursor-1`,
	);
	fireEvent.click(screen.getByRole("button", { name: "First page" }));
	expect(await screen.findByRole("cell", { name: "First" })).toBeVisible();
});

it("inserts a row with values converted to the column types", async () => {
	window.history.replaceState(null, "", "/data/database?table=posts");
	serve();
	api.POST.mockResolvedValue({ data: { id: "row-3" } });
	renderIn("en", <DatabasePage />);
	fireEvent.click(await screen.findByRole("button", { name: "Add a row" }));
	fireEvent.change(screen.getByLabelText("title"), { target: { value: "Hello" } });
	fireEvent.change(screen.getByLabelText("views"), { target: { value: "42" } });
	fireEvent.change(screen.getByLabelText("meta"), { target: { value: '{"draft": true}' } });
	fireEvent.click(screen.getByRole("button", { name: "Insert the row" }));
	await waitFor(() => {
		expect(api.POST).toHaveBeenCalledWith(`${base}/tables/posts/rows`, {
			title: "Hello",
			views: 42,
			meta: { draft: true },
		});
	});
	expect(await screen.findByText("Row saved")).toBeVisible();
});

it("refuses invalid JSON before sending a row", async () => {
	window.history.replaceState(null, "", "/data/database?table=posts");
	serve();
	renderIn("en", <DatabasePage />);
	fireEvent.click(await screen.findByRole("button", { name: "Add a row" }));
	fireEvent.change(screen.getByLabelText("title"), { target: { value: "Hello" } });
	fireEvent.change(screen.getByLabelText("meta"), { target: { value: "{draft" } });
	fireEvent.click(screen.getByRole("button", { name: "Insert the row" }));
	expect(await screen.findByRole("alert")).toHaveTextContent("meta must contain valid JSON.");
	expect(api.POST).not.toHaveBeenCalled();
});

it("asks for confirmation before deleting a column and sends its name as confirmation", async () => {
	window.history.replaceState(null, "", "/data/database?table=posts&tab=columns");
	serve();
	api.DELETE.mockResolvedValue({ data: { ...posts, columns: posts.columns.slice(1) } });
	renderIn("en", <DatabasePage />);
	fireEvent.click(await screen.findByRole("button", { name: "Delete the column title" }));
	const dialog = screen.getByRole("alertdialog", { name: "Delete the column title" });
	expect(api.DELETE).not.toHaveBeenCalled();
	fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
	await waitFor(() => {
		expect(api.DELETE).toHaveBeenCalledWith(`${base}/tables/posts/columns/title?confirm=title`);
	});
});

it("deletes a table only once its name is typed", async () => {
	window.history.replaceState(null, "", "/data/database?table=posts&tab=advanced");
	serve();
	api.DELETE.mockResolvedValue({ data: { deleted: true } });
	renderIn("en", <DatabasePage />);
	expect(await screen.findByText("adb_12_posts")).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Delete the table" }));
	const dialog = screen.getByRole("alertdialog");
	const confirm = within(dialog).getByRole("button", { name: "Delete the table" });
	expect(confirm).toBeDisabled();
	fireEvent.change(within(dialog).getByLabelText("Type posts to confirm."), {
		target: { value: "post" },
	});
	expect(confirm).toBeDisabled();
	fireEvent.change(within(dialog).getByLabelText("Type posts to confirm."), {
		target: { value: "posts" },
	});
	fireEvent.click(confirm);
	await waitFor(() => {
		expect(api.DELETE).toHaveBeenCalledWith(`${base}/tables/posts?confirm=posts`);
	});
	await waitFor(() => {
		expect(new URLSearchParams(window.location.search).get("table")).toBeNull();
	});
});

it("saves the access rules and the realtime switch automatically", async () => {
	window.history.replaceState(null, "", "/data/database?table=posts&tab=access");
	serve();
	api.PATCH.mockResolvedValue({ data: { ...posts, realtime: true } });
	renderIn("en", <DatabasePage />);
	fireEvent.click(await screen.findByRole("switch", { name: "Send changes in realtime" }));
	await waitFor(
		() => {
			expect(api.PATCH).toHaveBeenCalledWith(`${base}/tables/posts`, {
				rules: posts.rules,
				realtime: true,
			});
		},
		{ timeout: 2000 },
	);
	expect(await screen.findByText("All changes saved.")).toBeVisible();
	expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
});

it("runs a read-only SQL query and shows its columns, rows and truncation", async () => {
	window.history.replaceState(null, "", "/data/database?section=sql");
	serve();
	api.POST.mockResolvedValue({
		data: { columns: ["title", "views"], rows: [["First", 1]], truncated: true },
	});
	renderIn("en", <DatabasePage />);
	expect(await screen.findByText(/Tables are named adb_12_<table>/u)).toBeVisible();
	fireEvent.change(screen.getByLabelText("Query"), {
		target: { value: "SELECT title, views FROM adb_12_posts" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Run the query" }));
	expect(await screen.findByRole("cell", { name: "First" })).toBeVisible();
	expect(screen.getByRole("columnheader", { name: "views" })).toBeVisible();
	expect(screen.getByText("Only the first 500 rows are shown.")).toBeVisible();
	expect(api.POST).toHaveBeenCalledWith(`${base}/sql`, {
		query: "SELECT title, views FROM adb_12_posts",
	});
});

it("explains a refused SQL query with a translated message", async () => {
	window.history.replaceState(null, "", "/data/database?section=sql");
	serve();
	api.POST.mockRejectedValue(new ApiError("Only SELECT queries are allowed", 422, "sql_read_only"));
	renderIn("fr", <DatabasePage />);
	fireEvent.change(await screen.findByLabelText("Requête"), {
		target: { value: "DELETE FROM adb_12_posts" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Exécuter la requête" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Seules les requêtes SELECT et WITH sont autorisées ici.",
	);
});
