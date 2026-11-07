import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import StoragePage from "../../../../../packages/plugins/superboard-data/src/front/storage/StoragePage.js";
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
vi.mock("../../../../../packages/plugins/superboard-data/src/front/storage/transport.js", () => api);
vi.mock("@superboard/front-ui/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: { id: "prod" } }),
}));

const base = "/api/v1/data/storage/projects/prod";
const avatars = {
	name: "avatars",
	public: false,
	max_bytes: 5 * 1024 * 1024,
	allowed_types: ["image/*"],
	rules: { read: "owner", write: "owner", delete: "owner" },
	created_at: "2026-11-07T10:00:00.000Z",
	updated_at: "2026-11-07T10:00:00.000Z",
};
const object = {
	bucket: "avatars",
	path: "users/u1/photo.png",
	owner_id: "u1",
	content_type: "image/png",
	size: 2048,
	etag: "abc",
	created_at: "2026-11-07T10:00:00.000Z",
	updated_at: "2026-11-07T10:00:00.000Z",
};

function serve() {
	api.GET.mockImplementation(async (path: string) => {
		const [route = ""] = path.split("?");
		if (route === `${base}/buckets`) return { data: { items: [avatars] } };
		if (route === `${base}/buckets/avatars/objects`) return { data: { items: [object] } };
		throw new Error(`Unexpected GET ${path}`);
	});
}

function renderIn(locale: "en" | "fr", ui: ReactNode) {
	const value: FrontContextValue = {
		instanceId: "1",
		pluginId: "superboard-storage",
		path: "/data/storage",
		parameters: {},
		locale,
		operator: null,
		projectScope: null,
		activePluginIds: ["superboard-storage"],
	};
	return render(<FrontContextProvider value={value}>{ui}</FrontContextProvider>);
}

beforeAll(() => {
	if (!("PointerEvent" in window))
		Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });
});
beforeEach(() => {
	window.history.replaceState(null, "", "/data/storage");
});
afterEach(() => {
	cleanup();
	vi.resetAllMocks();
	window.history.replaceState(null, "", "/");
});

it("lists the buckets with their limits in French", async () => {
	serve();
	renderIn("fr", <StoragePage />);
	expect(await screen.findByRole("heading", { name: "Buckets d’application" })).toBeVisible();
	const row = (await screen.findByRole("button", { name: "avatars" })).closest("tr");
	if (!row) throw new Error("Bucket row missing");
	expect(within(row).getByText("Privé")).toBeVisible();
	expect(within(row).getByText("5 Mo")).toBeVisible();
	expect(within(row).getByText("image/*")).toBeVisible();
});

it("creates a public bucket whose read rule is replaced by a public notice", async () => {
	serve();
	api.POST.mockResolvedValue({ data: { ...avatars, name: "media", public: true } });
	renderIn("en", <StoragePage />);
	fireEvent.change(await screen.findByLabelText("Bucket name"), { target: { value: "media" } });
	expect(screen.getByRole("combobox", { name: "Read" })).toBeInTheDocument();
	fireEvent.click(screen.getByRole("switch", { name: "Public bucket" }));
	expect(screen.queryByRole("combobox", { name: "Read" })).not.toBeInTheDocument();
	expect(screen.getByText("Everyone can read the files of a public bucket.")).toBeVisible();
	fireEvent.change(screen.getByLabelText("Maximum file size (MB)"), { target: { value: "10" } });
	fireEvent.change(screen.getByLabelText("Accepted file types"), {
		target: { value: "image/*, application/pdf" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Create the bucket" }));
	await waitFor(() => {
		expect(api.POST).toHaveBeenCalledWith(`${base}/buckets`, {
			name: "media",
			public: true,
			max_bytes: 10 * 1024 * 1024,
			allowed_types: ["image/*", "application/pdf"],
			rules: { read: "owner", write: "owner", delete: "owner" },
		});
	});
	await waitFor(() => {
		expect(new URLSearchParams(window.location.search).get("bucket")).toBe("media");
	});
});

it("uploads a file with its body and content type to the chosen folder", async () => {
	window.history.replaceState(null, "", "/data/storage?bucket=avatars");
	serve();
	api.PUT.mockResolvedValue({ data: { ...object, path: "users/u2/logo.svg" } });
	renderIn("en", <StoragePage />);
	expect(await screen.findByRole("cell", { name: "users/u1/photo.png" })).toBeVisible();
	fireEvent.change(screen.getByLabelText("Folder or path prefix"), {
		target: { value: "users/u2" },
	});
	await waitFor(() => {
		expect(api.GET).toHaveBeenCalledWith(
			`${base}/buckets/avatars/objects?limit=100&prefix=users%2Fu2`,
		);
	});
	const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
	fireEvent.change(screen.getByLabelText("File to upload"), { target: { files: [file] } });
	expect(screen.getByLabelText("Path in the bucket")).toHaveAttribute(
		"placeholder",
		"users/u2/logo.svg",
	);
	fireEvent.click(screen.getByRole("button", { name: "Upload" }));
	await waitFor(() => {
		expect(api.PUT).toHaveBeenCalledWith(
			`${base}/buckets/avatars/objects/users/u2/logo.svg`,
			file,
			expect.objectContaining({ headers: { "Content-Type": "image/svg+xml" } }),
		);
	});
	expect(await screen.findByText("File uploaded")).toBeVisible();
});

it("asks for confirmation before deleting a file", async () => {
	window.history.replaceState(null, "", "/data/storage?bucket=avatars");
	serve();
	api.DELETE.mockResolvedValue({ data: { deleted: true, item: object } });
	renderIn("en", <StoragePage />);
	fireEvent.click(await screen.findByRole("button", { name: "Delete users/u1/photo.png" }));
	expect(api.DELETE).not.toHaveBeenCalled();
	const dialog = screen.getByRole("alertdialog", { name: "Delete users/u1/photo.png" });
	fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
	await waitFor(() => {
		expect(api.DELETE).toHaveBeenCalledWith(`${base}/buckets/avatars/objects/users/u1/photo.png`);
	});
	expect(await screen.findByText("File deleted")).toBeVisible();
});

it("explains that a bucket must be emptied before it is deleted", async () => {
	window.history.replaceState(null, "", "/data/storage?bucket=avatars&tab=advanced");
	serve();
	api.DELETE.mockRejectedValue(new ApiError("Delete the objects first", 409, "bucket_not_empty"));
	renderIn("fr", <StoragePage />);
	fireEvent.click(await screen.findByRole("button", { name: "Supprimer le bucket" }));
	const dialog = screen.getByRole("alertdialog");
	fireEvent.change(within(dialog).getByLabelText("Saisissez avatars pour confirmer."), {
		target: { value: "avatars" },
	});
	fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer le bucket" }));
	await waitFor(() => {
		expect(api.DELETE).toHaveBeenCalledWith(`${base}/buckets/avatars?confirm=avatars`);
	});
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Supprimez d’abord les fichiers de ce bucket.",
	);
});

it("saves the bucket settings automatically", async () => {
	window.history.replaceState(null, "", "/data/storage?bucket=avatars&tab=settings");
	serve();
	api.PATCH.mockResolvedValue({ data: { ...avatars, public: true } });
	renderIn("en", <StoragePage />);
	fireEvent.click(await screen.findByRole("switch", { name: "Public bucket" }));
	await waitFor(
		() => {
			expect(api.PATCH).toHaveBeenCalledWith(`${base}/buckets/avatars`, {
				public: true,
				max_bytes: 5 * 1024 * 1024,
				allowed_types: ["image/*"],
				rules: avatars.rules,
			});
		},
		{ timeout: 2000 },
	);
	expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
});
