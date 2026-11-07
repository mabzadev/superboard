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

const transport = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() }));
vi.mock(
	"../../../../../../packages/plugins/superboard-core/src/front/mcp/transport.js",
	() => transport,
);

import McpToolsPage from "../../../../../../packages/plugins/superboard-core/src/front/mcp/McpToolsPage.js";

function french({ children }: { children: ReactNode }) {
	return (
		<FrontContextProvider
			value={{
				instanceId: "1",
				pluginId: "superboard-mcp",
				path: "/core/mcp",
				parameters: {},
				locale: "fr",
				operator: null,
				projectScope: null,
				activePluginIds: ["superboard-mcp"],
			}}
		>
			{children}
		</FrontContextProvider>
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	transport.GET.mockImplementation(async (path: string) =>
		path === "/api/v1/mcp/tokens"
			? {
					data: {
						tokens: [{ id: "token-1", name: "Desk assistant", created_at: "2026-11-01T10:00:00Z" }],
					},
				}
			: {
					data: {
						data: {
							tools: [{ name: "get_status", inputSchema: {} }],
							items: path.includes("/sessions")
								? [
										{
											session_id: "session-1",
											status: "active",
											expires_at: "2026-11-06T10:00:00Z",
										},
									]
								: [],
							next_cursor: null,
						},
					},
				},
	);
	transport.DELETE.mockResolvedValue({});
});

describe("AI assistant access", () => {
	it("revokes an authorized application only after confirmation", async () => {
		render(<McpToolsPage />);

		const revoke = await screen.findByRole("button", { name: "Revoke access" });
		fireEvent.click(revoke);
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("Revoke access for Desk assistant?")).toBeInTheDocument();
		expect(transport.DELETE).not.toHaveBeenCalled();

		fireEvent.click(within(dialog).getByRole("button", { name: "Revoke access" }));
		await waitFor(() => {
			expect(transport.DELETE).toHaveBeenCalledWith("/api/v1/mcp/tokens/token-1");
		});
	});

	it("keeps the application when the confirmation is cancelled", async () => {
		render(<McpToolsPage />);

		fireEvent.click(await screen.findByRole("button", { name: "Revoke access" }));
		fireEvent.click(
			within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }),
		);

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect(transport.DELETE).not.toHaveBeenCalled();
	});

	it("shows the sections and session states in French", async () => {
		render(<McpToolsPage />, { wrapper: french });

		expect(
			screen.getByRole("heading", { level: 1, name: "Accès des assistants IA" }),
		).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Applications autorisées" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Avancé" })).toBeInTheDocument();
		expect(await screen.findByText("Desk assistant")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Révoquer l’accès" })).toBeInTheDocument();
		expect(await screen.findByText("Active")).toHaveAttribute("data-slot", "badge");
	});
});
