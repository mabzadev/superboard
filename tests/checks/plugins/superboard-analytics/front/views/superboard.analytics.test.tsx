import { canonicalFrontHref } from "@superboard/contracts/front-paths";
import { FrontContextProvider, type FrontContextValue } from "@superboard/front-ui/context";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("@superboard/front-ui/navigation", () => ({ useRouter: () => router }));

import StatisticsOverview from "../../../../../../packages/plugins/superboard-analytics/src/front/views/superboard.analytics.js";

function openAt(href: string, locale: "en" | "fr" = "en") {
	window.history.replaceState(null, "", href);
	const context: FrontContextValue = {
		locale,
		path: window.location.pathname,
		parameters: {},
		instanceId: "instance-1",
		pluginId: "superboard-analytics",
		operator: null,
		projectScope: null,
		activePluginIds: ["superboard-analytics"],
	};
	return render(
		<FrontContextProvider value={context}>
			<StatisticsOverview />
		</FrontContextProvider>,
	);
}

async function destinationOf(href: string) {
	const served = canonicalFrontHref(href);
	if (new URL(served, "https://superboard.invalid").pathname !== "/analytics") return served;
	openAt(served);
	await waitFor(() => expect(router.replace).toHaveBeenCalledOnce());
	return router.replace.mock.calls[0]?.[0];
}

describe("Statistics overview address", () => {
	afterEach(() => {
		vi.clearAllMocks();
		window.history.replaceState(null, "", "/");
	});

	it("opens the single overview with the language, period and platform of the address", async () => {
		openAt(
			"/analytics?lang=fr&from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z&platform=ios#activity",
			"fr",
		);

		await waitFor(() =>
			expect(router.replace).toHaveBeenCalledWith(
				"/analytics/home?lang=fr&from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z&platform=ios#activity",
			),
		);
		expect(router.replace).toHaveBeenCalledOnce();
		expect(router.push).not.toHaveBeenCalled();
		expect(screen.getByRole("status")).toHaveTextContent("Ouverture de la vue d’ensemble…");
		expect(screen.queryByRole("heading")).toBeNull();
	});

	it.each([
		"/analytics?lang=en",
		"/dashboard?lang=fr&platform=android",
		"/analytics/dashboards?lang=en&from=2026-07-01&to=2026-08-01",
		"/?lang=fr",
	])("leads %s to the single overview", async (href) => {
		const destination = new URL(await destinationOf(href), "https://superboard.invalid");
		expect(destination.pathname).toBe("/analytics/home");
		expect(destination.search).toBe(new URL(href, "https://superboard.invalid").search);
	});
});
