import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FrontContextProvider } from "../../../../../../packages/supbrd-front-ui/src/context.js";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../../../packages/supbrd-front-ui/render.js";

const transport = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() }));
vi.mock(
	"../../../../../../packages/plugins/superboard-core/src/front/gateway/transport.js",
	() => transport,
);

import GatewayPage from "../../../../../../packages/plugins/superboard-core/src/front/gateway/GatewayPage.js";

const health = {
	route_id: "health",
	method: "GET",
	path_pattern: "/health",
	target_path: "/health",
	rate_limit: 60,
	revision: 1,
};
const users = {
	route_id: "users",
	method: "GET",
	path_pattern: "/users",
	target_path: "/users",
	rate_limit: 30,
	revision: 3,
};
const orders = {
	route_id: "orders",
	method: "POST",
	path_pattern: "/orders",
	target_path: "/orders",
	rate_limit: 10,
	revision: 1,
};

function french({ children }: { children: ReactNode }) {
	return (
		<FrontContextProvider
			value={{
				instanceId: "1",
				pluginId: "superboard-gateway",
				path: "/core/gateway",
				parameters: {},
				locale: "fr",
				operator: null,
				projectScope: null,
				activePluginIds: ["superboard-gateway"],
			}}
		>
			{children}
		</FrontContextProvider>
	);
}

function routeRow(label: string) {
	const row = screen.getByRole("button", { name: label }).closest("div.p-4");
	if (!(row instanceof HTMLElement)) throw new Error(`Route row ${label} is missing`);
	return within(row);
}

beforeEach(() => {
	vi.clearAllMocks();
	transport.GET.mockImplementation(async (path: string) => ({
		data: {
			data: path.endsWith("/routes")
				? [health, users, orders]
				: path.endsWith("/active-manifest")
					? {
							manifest_id: "manifest-1",
							checksum: "checksum-1",
							routes: [health, { ...users, rate_limit: 120 }],
						}
					: [{ route_id: "health", window_start: 29_000_000, requests: 4 }],
		},
	}));
});

describe("API routing", () => {
	it("tells which draft routes the published manifest serves", async () => {
		render(<GatewayPage />, { wrapper: french });

		expect(await screen.findByRole("button", { name: "GET /health" })).toBeInTheDocument();
		expect(routeRow("GET /health").getByText("Publiée")).toHaveAttribute("data-slot", "badge");
		expect(routeRow("GET /users").getByText("Modifications non publiées")).toHaveAttribute(
			"data-slot",
			"badge",
		);
		expect(routeRow("POST /orders").getByText("Non publiée")).toHaveAttribute("data-slot", "badge");
		expect(screen.getByText("Publié")).toHaveAttribute("data-slot", "badge");
	});

	it("shows the publication state as not published without an active manifest", async () => {
		transport.GET.mockImplementation(async (path: string) => ({
			data: { data: path.endsWith("/active-manifest") ? null : [] },
		}));
		render(<GatewayPage />);

		expect(await screen.findByText("No route yet.")).toBeInTheDocument();
		expect(screen.getByText("Not published")).toHaveAttribute("data-slot", "badge");
		expect(screen.getByRole("button", { name: "Publish gateway manifest" })).toBeDisabled();
	});

	it("lists the rate counters as readable rows in the advanced section", async () => {
		render(<GatewayPage />, { wrapper: french });

		const counters = await screen.findByRole("table");
		expect(within(counters).getByRole("columnheader", { name: "Requêtes" })).toBeInTheDocument();
		expect(within(counters).getByRole("cell", { name: "4" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Avancé" })).toBeInTheDocument();
	});

	it("keeps the existing operators when the access policy is saved", async () => {
		transport.GET.mockImplementation(async (path: string) => ({
			data: path.endsWith("/routes")
				? {
						data: [health],
						access_policy: { allowed_operator_ids: ["operator-17", "operator-42"], version: 3 },
					}
				: { data: path.endsWith("/active-manifest") ? null : [] },
		}));
		transport.POST.mockResolvedValue({ data: { data: { version: 4 } } });
		render(<GatewayPage />);

		await screen.findByRole("button", { name: "GET /health" });
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Update access policy" })).toBeEnabled();
		});
		fireEvent.click(screen.getByRole("button", { name: "Update access policy" }));

		await waitFor(() => {
			expect(transport.POST).toHaveBeenCalled();
		});
		expect(transport.POST).toHaveBeenCalledWith("/api/v1/gateway/access-policy", {
			allowed_operator_ids: ["operator-17", "operator-42"],
		});
		expect(screen.getByDisplayValue("operator-17, operator-42")).toBeInTheDocument();
	});

	it("refuses to save the access policy when the current one could not be loaded", async () => {
		transport.GET.mockImplementation(async (path: string) => ({
			data: { data: path.endsWith("/active-manifest") ? null : [] },
		}));
		render(<GatewayPage />, { wrapper: french });

		expect(
			await screen.findByText(
				"La politique d’accès actuelle n’a pas pu être chargée. Rechargez la page avant de la modifier pour ne pas effacer les opérateurs autorisés.",
			),
		).toBeInTheDocument();
		const save = screen.getByRole("button", { name: "Mettre à jour la politique d’accès" });
		expect(save).toBeDisabled();
		fireEvent.click(save);
		expect(transport.POST).not.toHaveBeenCalled();
	});
});
