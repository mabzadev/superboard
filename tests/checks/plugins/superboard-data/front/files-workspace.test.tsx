import { afterEach, expect, it, vi } from "vitest";

import FilesPage from "../../../../../packages/plugins/superboard-data/src/front/files/FilesPage.js";
import { fireEvent, render, screen, waitFor } from "../../../packages/supbrd-front-ui/render.js";
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
const project = vi.hoisted(() => ({ id: "test" }));
vi.mock("../../../../../packages/plugins/superboard-data/src/front/files/transport.js", () => api);
vi.mock("@superboard/front-ui/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: project }),
}));
afterEach(() => vi.resetAllMocks());
it("filters the file list and opens metadata for the selected file", async () => {
	const items = [
		{ id: "1", filename: "photo.png", content_type: "image/png", byte_size: 42, deleted_at: null },
		{ id: "2", filename: "notes.txt", content_type: "text/plain", byte_size: 10, deleted_at: null },
	];
	api.GET.mockImplementation(async (path: string) => ({
		data: {
			data: path.endsWith("/usage") ? { files: 2, bytes: 52 } : { items, next_cursor: null },
		},
	}));
	render(<FilesPage />);
	expect(await screen.findByRole("button", { name: "notes.txt" })).toBeVisible();
	fireEvent.change(screen.getByLabelText("Search this page"), { target: { value: "photo" } });
	expect(screen.queryByRole("button", { name: "notes.txt" })).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "photo.png" }));
	expect(screen.getByRole("heading", { name: "Details" })).toBeVisible();
	expect(screen.getByText("42", { selector: "dd" })).toBeVisible();
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
