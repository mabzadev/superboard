import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen } from "../../../packages/supbrd-front-ui/render.js";

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
	"../../../../../packages/plugins/superboard-authentification/src/front/app/(protected)/identity/[lang]/orgs/page.js",
	() => ({
		default: () => <p>organizations panel</p>,
	}),
);
vi.mock(
	"../../../../../packages/plugins/superboard-authentification/src/front/app/(protected)/identity/[lang]/apps/page.js",
	() => ({
		default: () => <p>apps panel</p>,
		AppBanners: () => <p>banners panel</p>,
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

describe("authentication settings access control", () => {
	beforeEach(() => {
		window.history.replaceState({}, "", "/auth/settings?tab=access");
	});

	it("lists the access areas as collapsible sections instead of a second row of tabs", async () => {
		render(<SettingsPage />);
		expect(screen.queryByRole("group", { name: "Access control sections" })).toBeNull();
		for (const name of ["Roles", "Permissions", "Organizations", "Apps"])
			expect(screen.getByText(name, { selector: "summary" })).toBeInTheDocument();
		expect(screen.queryByText("roles panel")).toBeNull();

		fireEvent.click(screen.getByText("Organizations", { selector: "summary" }));
		expect(await screen.findByText("organizations panel")).toBeInTheDocument();
	});

	it("opens the section named in a former address", async () => {
		window.history.replaceState({}, "", "/auth/settings?tab=access&section=permissions");
		render(<SettingsPage />);
		expect(await screen.findByText("permissions panel")).toBeInTheDocument();
		expect(screen.queryByText("roles panel")).toBeNull();
	});
});
