import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import ApiPage from "../../../../../packages/plugins/superboard-data/src/front/files/data/ApiPage.js";
import VectorsPage from "../../../../../packages/plugins/superboard-data/src/front/files/data/VectorsPage.js";
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
vi.mock("../../../../../packages/plugins/superboard-data/src/front/files/transport.js", () => api);
vi.mock("@superboard/front-ui/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: { id: "prod" } }),
}));

const base = "/api/v1/files/projects/prod/data";
const key = {
	id: "key-1",
	name: "Backend",
	hint: "sb_secret_abcd…",
	created_by: "op",
	created_at: "2026-11-07T10:00:00.000Z",
	last_used_at: null,
	revoked_at: null,
};
const secret = `sb_secret_${"x".repeat(43)}`;

function serve({ realtime = true, vectors = false } = {}) {
	api.GET.mockImplementation(async (path: string) => {
		const [route = ""] = path.split("?");
		if (route === `${base}/status`)
			return {
				data: {
					project_id: 12,
					features: {
						realtime,
						functions: true,
						function_secrets: false,
						image_transformations: false,
						vectors,
					},
					counts: { tables: 3, buckets: 1, functions: 2 },
				},
			};
		if (route === `${base}/settings`) return { data: { realtime_anonymous: false } };
		if (route === `${base}/keys`)
			return {
				data: { items: [key, { ...key, id: "key-0", name: "Old", revoked_at: key.created_at }] },
			};
		if (route === `${base}/vector-collections`)
			return {
				data: {
					available: vectors,
					items: [
						{
							name: "docs",
							rules: { read: "public", write: "service" },
							item_count: 7,
							created_at: key.created_at,
							updated_at: key.created_at,
						},
					],
				},
			};
		throw new Error(`Unexpected GET ${path}`);
	});
}

function renderIn(locale: "en" | "fr", ui: ReactNode, sdk = "https://sdk.example.test") {
	const value: FrontContextValue = {
		instanceId: "1",
		pluginId: "superboard-files",
		path: "/data/api",
		parameters: {},
		locale,
		operator: null,
		projectScope: null,
		activePluginIds: ["superboard-files"],
		publicEndpoints: { sdk },
	};
	return render(<FrontContextProvider value={value}>{ui}</FrontContextProvider>);
}

beforeAll(() => {
	if (!("PointerEvent" in window))
		Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });
});
beforeEach(() => {
	window.history.replaceState(null, "", "/data/api");
});
afterEach(() => {
	cleanup();
	vi.resetAllMocks();
	window.history.replaceState(null, "", "/");
});

it("shows every feature with its state and the public API address in French", async () => {
	serve();
	renderIn("fr", <ApiPage />);
	expect(await screen.findByRole("heading", { name: "API et clés" })).toBeVisible();
	const secrets = (await screen.findByText("Secrets des fonctions")).closest("div");
	if (!secrets) throw new Error("Feature row missing");
	expect(within(secrets).getByText("Secret manquant")).toBeVisible();
	const vectors = screen.getByText("Vecteurs").closest("div");
	if (!vectors) throw new Error("Feature row missing");
	expect(within(vectors).getByText("Indisponible")).toBeVisible();
	expect(screen.getByText("3 tables · 1 bucket · 2 fonctions")).toBeVisible();
	expect(screen.getByText("https://sdk.example.test/v1/data")).toBeVisible();
});

it("saves the anonymous realtime switch automatically", async () => {
	serve();
	api.PATCH.mockResolvedValue({ data: { realtime_anonymous: true } });
	renderIn("en", <ApiPage />);
	fireEvent.click(
		await screen.findByRole("switch", {
			name: "Let visitors join realtime channels without signing in",
		}),
	);
	await waitFor(
		() => {
			expect(api.PATCH).toHaveBeenCalledWith(`${base}/settings`, { realtime_anonymous: true });
		},
		{ timeout: 2000 },
	);
	expect(await screen.findByText("All changes saved.")).toBeVisible();
});

it("hides the anonymous realtime switch when realtime is unavailable", async () => {
	serve({ realtime: false });
	renderIn("en", <ApiPage />);
	const realtime = (await screen.findByText("Realtime")).closest("div");
	if (!realtime) throw new Error("Feature row missing");
	expect(within(realtime).getByText("Unavailable")).toBeVisible();
	expect(screen.queryByRole("switch")).not.toBeInTheDocument();
});

it("shows a new server key once, with a warning, and forgets it when dismissed", async () => {
	window.history.replaceState(null, "", "/data/api?tab=keys");
	serve();
	api.POST.mockResolvedValue({ data: { key: { ...key, id: "key-2", name: "Worker" }, secret } });
	renderIn("en", <ApiPage />);
	expect(await screen.findByText("Revoked")).toBeVisible();
	expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument();
	fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "Worker" } });
	fireEvent.click(screen.getByRole("button", { name: "Create the key" }));
	await waitFor(() => {
		expect(api.POST).toHaveBeenCalledWith(`${base}/keys`, { name: "Worker" });
	});
	expect(await screen.findByDisplayValue(secret)).toBeVisible();
	expect(screen.getByText(/This key is shown only once/u)).toBeVisible();
	expect(screen.getByRole("button", { name: "Copy" })).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "I have stored the key" }));
	expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument();
	expect(screen.queryByText(/This key is shown only once/u)).not.toBeInTheDocument();
});

it("asks for confirmation before revoking a server key", async () => {
	window.history.replaceState(null, "", "/data/api?tab=keys");
	serve();
	api.DELETE.mockResolvedValue({ data: { revoked: true } });
	renderIn("en", <ApiPage />);
	fireEvent.click(await screen.findByRole("button", { name: "Revoke the key Backend" }));
	expect(api.DELETE).not.toHaveBeenCalled();
	const dialog = screen.getByRole("alertdialog", { name: "Revoke the key Backend" });
	fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
	await waitFor(() => {
		expect(api.DELETE).toHaveBeenCalledWith(`${base}/keys/key-1`);
	});
	expect(await screen.findByText("Key revoked")).toBeVisible();
});

it("gives the OpenAPI address and a CLI snippet in the Advanced tab", async () => {
	window.history.replaceState(null, "", "/data/api?tab=advanced");
	serve();
	renderIn("en", <ApiPage />);
	expect(await screen.findByText("https://sdk.example.test/v1/data/openapi.json")).toBeVisible();
	expect(
		screen.getByText(
			/superboard login --url https:\/\/sdk\.example\.test\/v1\/data --key sb_secret_…/u,
		),
	).toBeVisible();
	expect(screen.getByText(/superboard gen types/u)).toBeVisible();
});

it("marks the API address as incomplete when no SDK domain is configured", async () => {
	window.history.replaceState(null, "", "/data/api?tab=advanced");
	serve();
	renderIn("fr", <ApiPage />, "");
	expect(
		await screen.findByText("Le domaine SDK n’est pas configuré pour cet environnement."),
	).toBeVisible();
	expect(screen.getByText("À compléter")).toBeVisible();
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
