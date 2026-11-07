import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FrontContextProvider } from "../../../../../../../../packages/supbrd-front-ui/src/context.js";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../../../../../packages/supbrd-front-ui/render.js";

const app = vi.hoisted(() => ({
	getSdkConfiguration: vi.fn(),
	getAccessKey: vi.fn(),
	saveSdkConfiguration: vi.fn(),
	testSdkConfiguration: vi.fn(),
	deleteSdkConfiguration: vi.fn(),
}));

vi.mock(
	"../../../../../../../../packages/plugins/superboard-core/src/front/settings/api/app/appService.js",
	() => app,
);
vi.mock(
	"../../../../../../../../packages/plugins/superboard-core/src/front/settings/components/developers/RenderCodeBlock.js",
	() => ({ default: () => null }),
);
vi.mock("../../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js", () => ({
	showSuccessNotification: vi.fn(),
	showErrorNotification: vi.fn(),
}));
vi.mock(
	"../../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({
			selectedProject: { id: "10-prod" },
			selectedInstance: { id: "10", role: "owner" },
		}),
	}),
);

import SdkSetupWizard from "../../../../../../../../packages/plugins/superboard-core/src/front/settings/components/app/SdkSetupWizard.js";

if (!("PointerEvent" in window))
	Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });

function wrapper(locale: "en" | "fr") {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return function Providers({ children }: { children: ReactNode }) {
		return (
			<FrontContextProvider
				value={{
					instanceId: "1",
					pluginId: "superboard-settings",
					path: "/core/libraries",
					parameters: {},
					locale,
					operator: null,
					projectScope: null,
					activePluginIds: ["superboard-settings"],
				}}
			>
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			</FrontContextProvider>
		);
	};
}

const existing = {
	platform: "web",
	status: "configured",
	configuration: { domain: "app.example.test", minimum_version: "1.0.0", completed_steps: [0] },
	updated_at: "2026-11-05T00:00:00Z",
};

function pause(milliseconds: number) {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	app.getSdkConfiguration.mockResolvedValue(null);
	app.getAccessKey.mockResolvedValue(null);
	app.saveSdkConfiguration.mockImplementation(
		async (_project: string, platform: string, configuration: Record<string, unknown>) => ({
			platform,
			status: "configured",
			configuration,
			updated_at: "2026-11-06T00:00:00Z",
		}),
	);
	app.deleteSdkConfiguration.mockResolvedValue({ deleted: true });
});

describe("SDK setup runtime policy", () => {
	it("shows the maintenance message only once maintenance mode is on", async () => {
		render(<SdkSetupWizard platform="ios" />, { wrapper: wrapper("en") });

		expect(await screen.findByText("Not configured")).toBeInTheDocument();
		const maintenance = screen.getByRole("switch", { name: "Maintenance mode" });
		expect(screen.queryByLabelText("Maintenance message")).toBeNull();

		fireEvent.click(maintenance);

		expect(await screen.findByLabelText("Maintenance message")).toBeInTheDocument();
	});

	it("saves an edit of an existing setup without any button, and never the loaded values", async () => {
		app.getSdkConfiguration.mockResolvedValue(existing);
		render(<SdkSetupWizard platform="web" />, { wrapper: wrapper("en") });

		const domain = await screen.findByLabelText("Application domain");
		await waitFor(() => expect(domain).toHaveValue("app.example.test"));
		await pause(800);
		expect(app.saveSdkConfiguration).not.toHaveBeenCalled();

		fireEvent.change(domain, { target: { value: "shop.example.test" } });

		await waitFor(() => expect(app.saveSdkConfiguration).toHaveBeenCalledOnce(), {
			timeout: 2000,
		});
		expect(app.saveSdkConfiguration).toHaveBeenCalledWith(
			"10-prod",
			"web",
			expect.objectContaining({
				domain: "shop.example.test",
				minimum_version: "1.0.0",
				completed_steps: [0],
			}),
		);
		expect(await screen.findByText("All changes saved.")).toBeInTheDocument();
	});

	it("keeps an explicit save for a platform that is not configured yet", async () => {
		render(<SdkSetupWizard platform="web" />, { wrapper: wrapper("en") });

		fireEvent.change(await screen.findByLabelText("Application domain"), {
			target: { value: "app.example.test" },
		});
		await pause(800);
		expect(app.saveSdkConfiguration).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Save & Continue" })).toBeInTheDocument();
	});
});

describe("SDK setup removal", () => {
	it("asks for confirmation before removing the setup", async () => {
		app.getSdkConfiguration.mockResolvedValue(existing);
		render(<SdkSetupWizard platform="web" />, { wrapper: wrapper("en") });

		const remove = await screen.findByRole("button", { name: "Remove setup" });
		await waitFor(() => expect(remove).toBeEnabled());
		fireEvent.click(remove);

		const dialog = await screen.findByRole("alertdialog");
		expect(within(dialog).getByText("Remove the Web setup?")).toBeInTheDocument();
		expect(app.deleteSdkConfiguration).not.toHaveBeenCalled();
		fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(app.deleteSdkConfiguration).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Remove setup" }));
		fireEvent.click(
			within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }),
		);
		await waitFor(() => expect(app.deleteSdkConfiguration).toHaveBeenCalledWith("10-prod", "web"));
	});
});

describe("SDK setup in French", () => {
	it("renders the wizard and its status in French", async () => {
		app.getSdkConfiguration.mockResolvedValue({ ...existing, status: "verified" });
		render(<SdkSetupWizard platform="web" />, { wrapper: wrapper("fr") });

		expect(await screen.findByText("Vérifiée")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Politique d’exécution" })).toBeInTheDocument();
		expect(screen.getByLabelText("Domaine de l’application")).toBeInTheDocument();
		expect(screen.getByText("Étape 1 sur 3")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Supprimer la configuration" })).toBeInTheDocument();
	});
});
