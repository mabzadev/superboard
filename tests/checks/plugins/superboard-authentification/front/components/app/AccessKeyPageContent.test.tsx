import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FrontContextProvider } from "../../../../../../../packages/supbrd-front-ui/src/context.js";
import {
	fireEvent,
	render,
	screen,
	waitFor,
} from "../../../../../packages/supbrd-front-ui/render.js";

const mocks = vi.hoisted(() => ({
	getAccessKey: vi.fn(),
	rotateAccessKey: vi.fn(),
}));

vi.mock(
	"../../../../../../../packages/plugins/superboard-authentification/src/front/api/app/appService.js",
	() => mocks,
);
vi.mock(
	"../../../../../../../packages/plugins/superboard-authentification/src/front/components/developers/RenderCodeBlock.js",
	() => ({ default: () => null }),
);
vi.mock(
	"../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({
			selectedInstance: { id: "10", role: "owner" },
			selectedProject: { id: "10-prod", name: "Production" },
		}),
	}),
);
vi.mock("../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js", () => ({
	showSuccessNotification: vi.fn(),
	showErrorNotification: vi.fn(),
}));

import AccessKeyPageContent from "../../../../../../../packages/plugins/superboard-authentification/src/front/components/app/AccessKeyPageContent.js";

function french({ children }: { children: ReactNode }) {
	return (
		<FrontContextProvider
			value={{
				instanceId: "1",
				pluginId: "superboard-authentification",
				path: "/auth/settings",
				parameters: {},
				locale: "fr",
				operator: null,
				projectScope: null,
				activePluginIds: ["superboard-authentification"],
			}}
		>
			{children}
		</FrontContextProvider>
	);
}

describe("API key page", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getAccessKey.mockResolvedValue({
			id: "key-1",
			prefix: "sb_live_abcd",
			created_at: "2026-11-01T10:00:00.000Z",
			last_used_at: null,
		});
		mocks.rotateAccessKey.mockResolvedValue({
			id: "key-2",
			prefix: "sb_live_efgh",
			created_at: "2026-11-06T10:00:00.000Z",
			last_used_at: null,
			secret: "sb_live_efgh_full_secret",
		});
	});

	it("renders the key state and actions in French", async () => {
		render(<AccessKeyPageContent />, { wrapper: french });

		expect(await screen.findByText("Active")).toBeInTheDocument();
		expect(screen.getByRole("heading", { level: 1, name: "Clé d’accès" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Clé d’accès du projet" })).toBeInTheDocument();
		expect(screen.getByText("Jamais")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Copier la clé d’accès complète" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Actualiser l’état" })).toBeInTheDocument();
		expect(screen.queryByText(/Rotate|Refresh status|Last used/u)).toBeNull();
	});

	it("shows an unconfigured key without pretending it is active", async () => {
		mocks.getAccessKey.mockResolvedValue(null);
		render(<AccessKeyPageContent />);

		expect(await screen.findByText("Not configured")).toBeInTheDocument();
		expect(screen.queryByText("Active")).toBeNull();
		expect(screen.getByRole("button", { name: "Create Access Key" })).toBeInTheDocument();
	});

	it("does not report a missing key when its state cannot be loaded", async () => {
		mocks.getAccessKey.mockRejectedValue(new Error("offline"));
		render(<AccessKeyPageContent />);

		expect(await screen.findByText("Unavailable")).toBeInTheDocument();
		expect(screen.queryByText("Not configured")).toBeNull();
	});

	it("rotates the key only after confirmation and reveals the one-time secret", async () => {
		render(<AccessKeyPageContent />, { wrapper: french });
		fireEvent.click(await screen.findByRole("button", { name: "Renouveler la clé d’accès" }));

		expect(mocks.rotateAccessKey).not.toHaveBeenCalled();
		expect(await screen.findByText("Renouveler la clé d’accès ?")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Renouveler la clé" }));

		await waitFor(() => {
			expect(mocks.rotateAccessKey).toHaveBeenCalledWith("10-prod");
		});
		expect(await screen.findByText("sb_live_efgh_full_secret")).toBeInTheDocument();
		expect(screen.getByText("Secret affiché une seule fois")).toBeInTheDocument();
	});
});
