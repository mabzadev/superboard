import { afterEach, beforeEach, expect, it, vi } from "vitest";

import FilesPage from "../../../../../packages/plugins/superboard-data/src/front/files/FilesPage.js";
import { fireEvent, render, screen, waitFor } from "../../../packages/supbrd-front-ui/render.js";
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
const project = vi.hoisted(() => ({ id: "test" }));
vi.mock("../../../../../packages/plugins/superboard-data/src/front/files/transport.js", () => api);
vi.mock("@superboard/front-ui/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: project }),
}));
beforeEach(() => {
	window.history.replaceState(null, "", "/data/files");
});
afterEach(() => {
	vi.resetAllMocks();
	window.history.replaceState(null, "", "/");
});
const items = [
	{ id: "1", filename: "photo.png", content_type: "image/png", byte_size: 42, deleted_at: null },
	{ id: "2", filename: "notes.txt", content_type: "text/plain", byte_size: 10, deleted_at: null },
];
function mockFiles() {
	api.GET.mockImplementation(async (path: string) => ({
		data: {
			data: path.endsWith("/usage")
				? { files: 3, bytes: 1052 }
				: path.split("?")[0]!.endsWith("/objects/9")
					? {
							id: "9",
							filename: "archive.zip",
							content_type: "application/zip",
							byte_size: 1000,
							deleted_at: null,
						}
					: { items, next_cursor: null },
		},
	}));
}
it("filters the file list and opens the selected file in place of the list", async () => {
	mockFiles();
	render(<FilesPage />);
	expect(await screen.findByRole("button", { name: "notes.txt" })).toBeVisible();
	fireEvent.change(screen.getByLabelText("Search this page"), { target: { value: "photo" } });
	expect(screen.queryByRole("button", { name: "notes.txt" })).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "photo.png" }));
	expect(screen.getByRole("heading", { name: "photo.png" })).toBeVisible();
	expect(screen.getByText("42", { selector: "dd" })).toBeVisible();
	expect(screen.queryByRole("table")).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "Back to files" }));
	expect(screen.queryByRole("heading", { name: "photo.png" })).not.toBeInTheDocument();
	expect(screen.getByRole("table")).toBeVisible();
	expect(screen.getByLabelText("Search this page")).toHaveValue("photo");
	expect(new URLSearchParams(window.location.search).get("file")).toBeNull();
});
it("gives the file sheet its own address and leaves it with the browser back button", async () => {
	window.history.replaceState(null, "", "/data/files?lang=en");
	mockFiles();
	render(<FilesPage />);
	const upload = new File(["a"], "pending.txt");
	fireEvent.change(screen.getByLabelText("Choose a file"), { target: { files: [upload] } });
	fireEvent.change(screen.getByLabelText("Search this page"), { target: { value: "photo" } });
	fireEvent.click(await screen.findByRole("button", { name: "photo.png" }));
	expect(screen.getByRole("heading", { name: "photo.png" })).toBeVisible();
	const address = new URLSearchParams(window.location.search);
	expect(address.get("file")).toBe("1");
	expect(address.get("lang")).toBe("en");
	window.history.back();
	expect(await screen.findByRole("table")).toBeVisible();
	expect(screen.queryByRole("heading", { name: "photo.png" })).not.toBeInTheDocument();
	expect(screen.getByLabelText("Search this page")).toHaveValue("photo");
	expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled();
});
it("opens a file sheet directly from its address", async () => {
	window.history.replaceState(null, "", "/data/files?file=9");
	mockFiles();
	render(<FilesPage />);
	expect(await screen.findByRole("heading", { name: "archive.zip" })).toBeVisible();
	expect(screen.getByText("application/zip", { selector: "dd" })).toBeVisible();
	expect(api.GET).toHaveBeenCalledWith(
		expect.stringMatching(/^\/api\/v1\/files\/projects\/test\/objects\/9(\?|$)/),
	);
	expect(screen.queryByRole("table")).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "Back to files" }));
	expect(await screen.findByRole("table")).toBeVisible();
	expect(window.location.search).toBe("");
});
it("explains that the file of an address cannot be found", async () => {
	window.history.replaceState(null, "", "/data/files?file=gone");
	mockFiles();
	const listing = api.GET.getMockImplementation();
	api.GET.mockImplementation(async (path: string) => {
		if (path.split("?")[0]!.endsWith("/objects/gone")) throw new Error("FILE_NOT_FOUND");
		return listing?.(path);
	});
	render(<FilesPage />);
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"File not found. It may have been deleted or moved to the trash.",
	);
	expect(screen.queryByRole("status")).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "Back to files" }));
	expect(await screen.findByRole("table")).toBeVisible();
	expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("opens a listed file directly from its address without another request", async () => {
	window.history.replaceState(null, "", "/data/files?file=2");
	mockFiles();
	render(<FilesPage />);
	expect(await screen.findByRole("heading", { name: "notes.txt" })).toBeVisible();
	expect(api.GET).not.toHaveBeenCalledWith(expect.stringMatching(/\/objects\/2(\?|$)/));
});
it("opens a trashed file directly from its address", async () => {
	window.history.replaceState(null, "", "/data/files?file=7");
	mockFiles();
	const listing = api.GET.getMockImplementation();
	api.GET.mockImplementation(async (path: string) => {
		const [route, query = ""] = path.split("?");
		if (!route!.endsWith("/objects/7")) return listing?.(path);
		if (new URLSearchParams(query).get("include_deleted") !== "true")
			throw new Error("FILE_NOT_FOUND");
		return {
			data: {
				data: {
					id: "7",
					filename: "old-contract.pdf",
					content_type: "application/pdf",
					byte_size: 12,
					deleted_at: "2026-11-01T00:00:00.000Z",
				},
			},
		};
	});
	render(<FilesPage />);
	expect(await screen.findByRole("heading", { name: "old-contract.pdf" })).toBeVisible();
	expect(screen.getByText("application/pdf", { selector: "dd" })).toBeVisible();
	expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("uploads every selected file and removes successful uploads from the pending queue", async () => {
	const completed: string[] = [];
	api.GET.mockResolvedValue({ data: { data: { items: [], files: 0, bytes: 0 } } });
	api.POST.mockImplementation(async (path: string, data: { filename?: string }) => {
		if (path.endsWith("/complete")) {
			completed.push(path);
			return { data: { data: {} } };
		}
		return { data: { data: { id: data.filename, upload_url: `/upload/${data.filename}` } } };
	});
	api.PUT.mockResolvedValue({ data: {} });
	render(<FilesPage />);
	fireEvent.change(screen.getByLabelText("Choose a file"), {
		target: { files: [new File(["a"], "first.txt"), new File(["b"], "second.txt")] },
	});
	fireEvent.click(screen.getByRole("button", { name: "Upload" }));
	await waitFor(() => expect(completed).toHaveLength(2));
	expect(await screen.findByRole("status")).toHaveTextContent("File saved");
	expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
});
it("opens file settings in a dialog from the Files page", async () => {
	api.GET.mockResolvedValue({ data: { data: { items: [], files: 0, bytes: 0 } } });
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json({ data: { values: { "superboard-files__signed_url_ttl_seconds": 600 } } }),
		),
	);
	render(<FilesPage />);
	fireEvent.click(screen.getByRole("button", { name: "File settings" }));
	const dialog = await screen.findByRole("dialog", { name: "File settings" });
	expect(dialog).toBeVisible();
	expect(await screen.findByLabelText("Signed URL lifetime (seconds)")).toHaveValue(600);
	vi.unstubAllGlobals();
});
