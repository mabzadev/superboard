import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FrontContextProvider } from "../../../../../../packages/supbrd-front-ui/src/context.js";
import { fireEvent, render, screen } from "../../../../packages/supbrd-front-ui/render.js";

const transport = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock(
	"../../../../../../packages/plugins/superboard-core/src/front/audit/transport.js",
	() => transport,
);

import AuditPage from "../../../../../../packages/plugins/superboard-core/src/front/audit/AuditPage.js";

function french({ children }: { children: ReactNode }) {
	return (
		<FrontContextProvider
			value={{
				instanceId: "1",
				pluginId: "superboard-audit",
				path: "/core/audit",
				parameters: {},
				locale: "fr",
				operator: null,
				projectScope: null,
				activePluginIds: ["superboard-audit"],
			}}
		>
			{children}
		</FrontContextProvider>
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	transport.GET.mockImplementation(async (path: string) => ({
		data: {
			data: {
				items: path.includes("/archives")
					? []
					: [
							{
								sequence: 7,
								operation_id: "command:op-7",
								hash: "hash-7",
								payload: { action: "publish", status: "failed" },
							},
						],
				next_cursor: null,
			},
		},
	}));
});

describe("Audit log", () => {
	it("shows the ledger as not verified until a verification runs, then its state as a badge", async () => {
		transport.POST.mockResolvedValue({
			data: { data: { verified: false, entries: 12, broken_sequence: 9, has_more: false } },
		});
		render(<AuditPage />, { wrapper: french });

		expect(screen.getByText("Non vérifiée")).toHaveAttribute("data-slot", "badge");
		fireEvent.click(screen.getByRole("button", { name: "Synchroniser et vérifier" }));

		expect(await screen.findByText("Intégrité compromise")).toHaveAttribute("data-slot", "badge");
		expect(screen.getByText("La chaîne est rompue à la séquence 9.")).toBeInTheDocument();
		expect(screen.queryByText("Non vérifiée")).toBeNull();
		expect(screen.getByRole("button", { name: "Créer une archive immuable" })).toBeDisabled();
	});

	it("enables archiving once the chain is verified", async () => {
		transport.POST.mockResolvedValue({
			data: { data: { verified: true, entries: 2, has_more: false } },
		});
		render(<AuditPage />);

		expect(screen.getByRole("button", { name: "Create immutable archive" })).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "Synchronize and verify" }));

		expect(await screen.findByText("Verified")).toHaveAttribute("data-slot", "badge");
		expect(screen.getByRole("button", { name: "Create immutable archive" })).toBeEnabled();
	});

	it("labels receipt states in French", async () => {
		render(<AuditPage />, { wrapper: french });

		expect(await screen.findByText("Échec")).toHaveAttribute("data-slot", "badge");
		expect(screen.getByRole("heading", { name: "Avancé" })).toBeInTheDocument();
	});
});
