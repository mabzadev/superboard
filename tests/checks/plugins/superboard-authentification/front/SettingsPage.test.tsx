import {
	authenticationSettingsFromEnvironment,
	type AuthenticationSettings,
} from "@superboard/contracts/authentication-settings";
import { QueryClient, QueryClientProvider } from "@superboard/front-ui/query";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render as renderUi, screen } from "../../../packages/supbrd-front-ui/render.js";

const settings = vi.hoisted(() => {
	const values: AuthenticationSettings = {};
	return { values };
});
vi.mock(
	"../../../../../packages/plugins/superboard-authentification/src/front/transport.js",
	() => ({
		GET: async () => ({
			data: {
				revision: 0,
				updatedAt: null,
				values: settings.values,
				deployment: {
					providerSecrets: { github: true, apple: true },
				},
			},
		}),
		PUT: vi.fn(),
	}),
);
vi.mock(
	"../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({ useProjectSelection: () => ({ selectedProject: { id: "1-test" } }) }),
);

vi.mock(
	"../../../../../packages/plugins/superboard-authentification/src/front/app/(protected)/identity/[lang]/roles/page.js",
	() => ({
		default: () => <p>roles panel</p>,
	}),
);
vi.mock(
	"../../../../../packages/plugins/superboard-authentification/src/front/app/(protected)/identity/[lang]/scopes/page.js",
	() => ({
		default: () => <p>permissions panel</p>,
	}),
);
vi.mock(
	"../../../../../packages/plugins/superboard-authentification/src/front/app/(protected)/identity/[lang]/apps/page.js",
	() => ({
		default: () => <p>apps panel</p>,
	}),
);
vi.mock(
	"../../../../../packages/plugins/superboard-authentification/src/front/AuthenticationSettingsPage.js",
	() => ({ default: () => null }),
);
vi.mock(
	"../../../../../packages/plugins/superboard-authentification/src/front/IdentityPanel.js",
	() => ({
		default: ({ children }: { children: ReactNode }) => <>{children}</>,
	}),
);

import SettingsPage from "../../../../../packages/plugins/superboard-authentification/src/front/SettingsPage.js";

function render(ui: ReactNode) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return renderUi(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeAll(() => {
	if (!("PointerEvent" in window))
		Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });
});

describe("authentication settings access control", () => {
	beforeEach(() => {
		settings.values = authenticationSettingsFromEnvironment({ SUPPORTED_LOCALES: ["en"] });
		window.history.replaceState({}, "", "/auth/settings?tab=access");
	});

	it("shows each access area behind its own switch instead of a second row of tabs", async () => {
		render(<SettingsPage />);
		expect(screen.queryByRole("group", { name: "Access control sections" })).toBeNull();
		for (const name of ["Roles", "Permissions", "Apps"])
			expect(screen.getByRole("switch", { name })).not.toBeChecked();
		expect(screen.queryByText("roles panel")).toBeNull();

		fireEvent.click(screen.getByRole("switch", { name: "Apps" }));
		expect(await screen.findByText("apps panel")).toBeInTheDocument();
	});

	it("opens the section named in a former address", async () => {
		window.history.replaceState({}, "", "/auth/settings?tab=access&section=permissions");
		render(<SettingsPage />);
		expect(await screen.findByText("permissions panel")).toBeInTheDocument();
		expect(screen.queryByText("roles panel")).toBeNull();
	});

	it("opens the section of a legacy tab address that names no section", async () => {
		window.history.replaceState({}, "", "/auth/settings?tab=roles");
		render(<SettingsPage />);
		expect(await screen.findByText("roles panel")).toBeInTheDocument();
		expect(screen.queryByText("permissions panel")).toBeNull();
	});
});
