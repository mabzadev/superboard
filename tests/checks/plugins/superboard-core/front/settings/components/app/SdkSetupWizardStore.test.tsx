import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FrontContextProvider } from "../../../../../../../../packages/supbrd-front-ui/src/context.js";
import { fireEvent, render, screen } from "../../../../../../packages/supbrd-front-ui/render.js";

const app = vi.hoisted(() => ({
	getSdkConfiguration: vi.fn(),
	getAccessKey: vi.fn(),
	saveSdkConfiguration: vi.fn(),
	testSdkConfiguration: vi.fn(),
	deleteSdkConfiguration: vi.fn(),
}));
const network = vi.hoisted(() => ({ getProjectConfigurationAPICall: vi.fn() }));

vi.mock(
	"../../../../../../../../packages/plugins/superboard-core/src/front/settings/api/app/appService.js",
	() => app,
);
vi.mock(
	"../../../../../../../../packages/plugins/superboard-core/src/front/settings/api/applications/configApplicationsService.js",
	() => network,
);
vi.mock(
	"../../../../../../../../packages/plugins/superboard-core/src/front/settings/components/developers/RenderCodeBlock.js",
	() => ({ default: () => null }),
);
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

beforeEach(() => {
	vi.clearAllMocks();
	app.getSdkConfiguration.mockResolvedValue({
		platform: "ios",
		status: "configured",
		configuration: {
			bundle_id: "com.example.fake",
			team_id: "FAKETEAM12",
			store_credential_reference: "secret://store/app-store-main",
		},
		updated_at: "2026-11-05T00:00:00Z",
	});
	app.getAccessKey.mockResolvedValue(null);
	network.getProjectConfigurationAPICall.mockResolvedValue({ data: { configurations: [] } });
});

describe("SDK setup store integration step", () => {
	it("collects the App Store server credentials next to the existing secret reference", async () => {
		render(<SdkSetupWizard platform="ios" />, { wrapper: wrapper("en") });
		fireEvent.click(await screen.findByRole("button", { name: /Store Integration/u }));

		expect(
			await screen.findByRole("heading", { name: "App Store Server API" }),
		).toBeInTheDocument();
		expect(await screen.findByText("Not configured")).toBeInTheDocument();
		expect(screen.getByLabelText("Private key (.p8)")).toBeInTheDocument();
		expect(screen.getByLabelText("Secret reference (optional)")).toHaveValue(
			"secret://store/app-store-main",
		);
	});

	it("explains in French that purchase verification does not read the reference", async () => {
		render(<SdkSetupWizard platform="android" />, { wrapper: wrapper("fr") });
		fireEvent.click(await screen.findByRole("button", { name: /Store Integration/u }));

		expect(
			await screen.findByRole("heading", { name: "Google Play Developer API" }),
		).toBeInTheDocument();
		expect(screen.getByLabelText("Référence de secret (facultatif)")).toBeInTheDocument();
		expect(
			screen.getByText(
				/La vérification des achats utilise les identifiants enregistrés ci-dessus/u,
			),
		).toBeInTheDocument();
	});
});
