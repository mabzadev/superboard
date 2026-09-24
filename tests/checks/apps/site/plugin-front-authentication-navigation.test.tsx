import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

import Applications from "../../../../packages/plugins/superboard-authentification/src/front/app/(protected)/identity/[lang]/apps/page.js";
import IdentityIntlProvider from "../../../../packages/plugins/superboard-authentification/src/front/identity/IdentityIntlProvider.js";
import messages from "../../../../packages/plugins/superboard-authentification/src/front/identity/translations/en.json";
import { SectionNavigationProvider } from "../../../../packages/supbrd-front-ui/src/section-navigation.js";

vi.mock(
	"../../../../packages/plugins/superboard-authentification/src/front/identity/services/auth/api.js",
	() => ({
		useGetApiV1AppsQuery: () => ({ data: { apps: [] }, isLoading: false }),
		useGetApiV1AppBannersQuery: () => ({ data: { appBanners: [] } }),
	}),
);
vi.mock(
	"../../../../packages/plugins/superboard-authentification/src/front/identity/melody-react.js",
	() => ({ useAuth: () => ({ userInfo: { roles: ["super_admin"] } }) }),
);

test("Applications shows one page title and one section navigation even with banners enabled", async () => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => {
			root.render(
				<IdentityIntlProvider locale="en" messages={messages}>
					<SectionNavigationProvider
						value={
							<nav aria-label="Section pages">
								<a href="/identity/en/apps">Applications</a>
							</nav>
						}
					>
						<Applications />
					</SectionNavigationProvider>
				</IdentityIntlProvider>,
			);
		});
		expect(container.querySelectorAll('nav[aria-label="Section pages"]')).toHaveLength(1);
		expect(container.querySelectorAll("h1")).toHaveLength(1);
		expect(container.querySelector('[data-testid="createBannerButton"]')).not.toBeNull();
	} finally {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	}
});
