import { FrontContextProvider, type FrontContextValue } from "@superboard/front-ui/context";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SectionCards } from "../../../../../../../packages/plugins/superboard-analytics/src/front/components/layout/section-cards.js";

function renderCards(locale: "en" | "fr") {
	const context: FrontContextValue = {
		locale,
		path: "/analytics/home",
		parameters: {},
		instanceId: "instance-1",
		pluginId: "superboard-analytics",
		operator: null,
		projectScope: null,
		activePluginIds: ["superboard-analytics"],
	};
	return render(
		<FrontContextProvider value={context}>
			<SectionCards
				cards={[
					{ title: "Events", value: 1_234_567 },
					{ title: "Average session", value: "1m 35s" },
				]}
			/>
		</FrontContextProvider>,
	);
}

describe("Overview key figures", () => {
	it.each([
		["en", "1,234,567"],
		["fr", "1 234 567"],
	] as const)("groups the digits of a figure for the %s console", (locale, figure) => {
		renderCards(locale);
		expect(screen.getByText(figure)).toBeInTheDocument();
		expect(screen.getByText("1m 35s")).toBeInTheDocument();
	});
});
