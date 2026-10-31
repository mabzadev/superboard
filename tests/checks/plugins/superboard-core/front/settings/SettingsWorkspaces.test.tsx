import { afterEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen } from "../../../../packages/supbrd-front-ui/render.js";

vi.mock(
	"../../../../../../packages/plugins/superboard-core/src/front/settings/components/settings/GeneralSection.js",
	() => ({ default: () => <p>general section</p> }),
);
vi.mock(
	"../../../../../../packages/plugins/superboard-core/src/front/settings/components/settings/TeamMebersSection.js",
	() => ({ default: () => <p>team section</p> }),
);
vi.mock(
	"../../../../../../packages/plugins/superboard-core/src/front/settings/components/settings/UsageSection.js",
	() => ({ default: () => <p>usage section</p> }),
);
vi.mock(
	"../../../../../../packages/plugins/superboard-core/src/front/settings/InstanceConfiguration.js",
	() => ({ default: () => <p>infrastructure section</p> }),
);
vi.mock(
	"../../../../../../packages/plugins/superboard-core/src/front/settings/components/app/LibrariesPageContent.js",
	() => ({ default: () => <p>libraries section</p> }),
);
vi.mock(
	"../../../../../../packages/plugins/superboard-core/src/front/settings/components/app/SdkSetupWizard.js",
	() => ({ default: ({ platform }: { platform: string }) => <p>{platform} setup</p> }),
);

import SdkAppsWorkspace from "../../../../../../packages/plugins/superboard-core/src/front/settings/components/app/SdkAppsWorkspace.js";
import EnvironmentSettings from "../../../../../../packages/plugins/superboard-core/src/front/settings/EnvironmentSettings.js";

function at(url: string) {
	window.history.replaceState({}, "", url);
}

function selectTab(name: string) {
	fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false });
}

afterEach(() => at("/"));

describe("Environment settings", () => {
	it("opens General by default and for unknown tabs", () => {
		at("/core/settings?tab=unknown&lang=en");
		render(<EnvironmentSettings />);

		expect(
			screen.getByRole("heading", { level: 1, name: "Environment settings" }),
		).toBeInTheDocument();
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"General",
			"Team",
			"Usage",
			"Infrastructure",
		]);
		expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
		expect(screen.getByText("general section")).toBeInTheDocument();
	});

	it("keeps the selected section in ?tab= and preserves other parameters", () => {
		at("/core/settings?lang=en");
		render(<EnvironmentSettings />);

		selectTab("Usage");
		expect(window.location.pathname).toBe("/core/settings");
		expect(new URLSearchParams(window.location.search).get("tab")).toBe("usage");
		expect(new URLSearchParams(window.location.search).get("lang")).toBe("en");
		expect(screen.getByText("usage section")).toBeInTheDocument();

		selectTab("General");
		expect(window.location.search).toBe("?lang=en");
		expect(screen.getByText("general section")).toBeInTheDocument();
	});

	it("opens the requested section", () => {
		at("/core/settings?tab=team");
		render(<EnvironmentSettings />);

		expect(screen.getByText("team section")).toBeInTheDocument();
		expect(screen.queryByText("general section")).toBeNull();
	});
});

describe("SDK & apps", () => {
	it("opens the libraries by default", () => {
		at("/core/libraries");
		render(<SdkAppsWorkspace />);

		expect(screen.getByRole("heading", { level: 1, name: "SDK & apps" })).toBeInTheDocument();
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"SDK libraries",
			"Web",
			"iOS",
			"Android",
		]);
		expect(screen.getByText("libraries section")).toBeInTheDocument();
	});

	it("starts on the tab chosen by a legacy setup route", () => {
		at("/core/ios-setup");
		render(<SdkAppsWorkspace tab="ios" />);

		expect(screen.getByRole("tab", { name: "iOS" })).toHaveAttribute("aria-selected", "true");
		expect(screen.getByText("ios setup")).toBeInTheDocument();
	});

	it("honours ?tab= over the route tab and navigates within the workspace", () => {
		at("/core/libraries?tab=android");
		render(<SdkAppsWorkspace tab="web" />);
		expect(screen.getByText("android setup")).toBeInTheDocument();

		selectTab("Web");
		expect(`${window.location.pathname}${window.location.search}`).toBe("/core/libraries?tab=web");
		expect(screen.getByText("web setup")).toBeInTheDocument();

		// A legacy route view keeps the tab explicit so it does not reopen its own tab.
		selectTab("SDK libraries");
		expect(`${window.location.pathname}${window.location.search}`).toBe(
			"/core/libraries?tab=libraries",
		);
		expect(screen.getByText("libraries section")).toBeInTheDocument();
	});

	it("omits the default tab from the canonical workspace URL", () => {
		at("/core/libraries?tab=ios");
		render(<SdkAppsWorkspace />);

		selectTab("SDK libraries");
		expect(`${window.location.pathname}${window.location.search}`).toBe("/core/libraries");
		expect(screen.getByText("libraries section")).toBeInTheDocument();
	});
});
