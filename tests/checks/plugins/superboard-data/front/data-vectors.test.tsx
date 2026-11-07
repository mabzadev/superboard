import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import VectorsPage from "../../../../../packages/plugins/superboard-data/src/front/vectors/VectorsPage.js";
import {
	FrontContextProvider,
	type FrontContextValue,
} from "../../../../../packages/supbrd-front-ui/src/context.js";
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
vi.mock("../../../../../packages/plugins/superboard-data/src/front/vectors/transport.js", () => api);
vi.mock("@superboard/front-ui/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: { id: "prod" } }),
}));

const base = "/api/v1/data/vectors/projects/prod";
const createdAt = "2026-11-07T10:00:00.000Z";

function serve({ vectors = false } = {}) {
	api.GET.mockImplementation(async (path: string) => {
		const [route = ""] = path.split("?");
		if (route === `${base}/vector-collections`)
			return {
				data: {
					available: vectors,
					items: [
						{
							name: "docs",
							rules: { read: "public", write: "service" },
							item_count: 7,
							created_at: createdAt,
							updated_at: createdAt,
						},
					],
				},
			};
		throw new Error(`Unexpected GET ${path}`);
	});
}

function renderIn(locale: "en" | "fr", ui: ReactNode) {
	const value: FrontContextValue = {
		instanceId: "1",
		pluginId: "superboard-vectors",
		path: "/data/vectors",
		parameters: {},
		locale,
		operator: null,
		projectScope: null,
		activePluginIds: ["superboard-vectors"],
	};
	return render(<FrontContextProvider value={value}>{ui}</FrontContextProvider>);
}

beforeAll(() => {
	if (!("PointerEvent" in window))
		Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });
});
beforeEach(() => {
	window.history.replaceState(null, "", "/data/vectors");
});
afterEach(() => {
	cleanup();
	vi.resetAllMocks();
	window.history.replaceState(null, "", "/");
});

it("explains that vectors are unavailable and still lists the collections", async () => {
	serve({ vectors: false });
	renderIn("fr", <VectorsPage />);
	expect(await screen.findByText(/Les vecteurs ne sont pas disponibles/u)).toBeVisible();
	expect(screen.getByText("Indisponible")).toBeVisible();
	expect(screen.getByText("docs")).toBeVisible();
	expect(screen.getByText("7 éléments")).toBeVisible();
});

it("creates a vector collection with its rules", async () => {
	serve({ vectors: true });
	api.POST.mockResolvedValue({ data: { name: "faq", rules: { read: "owner", write: "owner" } } });
	renderIn("en", <VectorsPage />);
	expect(await screen.findByText("Enabled")).toBeVisible();
	fireEvent.change(screen.getByLabelText("Collection name"), { target: { value: "faq" } });
	fireEvent.click(screen.getByRole("button", { name: "Create the collection" }));
	await waitFor(() => {
		expect(api.POST).toHaveBeenCalledWith(`${base}/vector-collections`, {
			name: "faq",
			rules: { read: "owner", write: "owner" },
		});
	});
});

it("deletes a vector collection only after its name is typed", async () => {
	serve({ vectors: true });
	api.DELETE.mockResolvedValue({ data: { deleted: true } });
	renderIn("en", <VectorsPage />);
	fireEvent.click(await screen.findByRole("button", { name: "Delete the collection docs" }));
	const dialog = screen.getByRole("alertdialog");
	const confirm = within(dialog).getByRole("button", { name: "Delete" });
	expect(confirm).toBeDisabled();
	fireEvent.change(within(dialog).getByLabelText("Type docs to confirm."), {
		target: { value: "docs" },
	});
	fireEvent.click(confirm);
	await waitFor(() => {
		expect(api.DELETE).toHaveBeenCalledWith(`${base}/vector-collections/docs?confirm=docs`);
	});
});
