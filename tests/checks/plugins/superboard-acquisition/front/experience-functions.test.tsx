import { expect, test } from "vitest";

import { ExperienceFunctionLinks } from "../../../../../packages/plugins/superboard-acquisition/src/front/ExperienceFunctions.js";
import { render, screen, within } from "../../../packages/supbrd-front-ui/render.js";

test("links the project-wide experience functions once from the experience lists", () => {
	render(<ExperienceFunctionLinks />);
	const navigation = screen.getByRole("navigation", {
		name: "These functions are shared by the experiences in this project.",
	});
	expect(
		within(navigation)
			.getAllByRole("link")
			.map((link) => [link.textContent, link.getAttribute("href")]),
	).toEqual([
		["Workflows", "/acquisition/workflows?lang=en"],
		["Launchpad", "/acquisition/launchpad?lang=en"],
		["Components", "/acquisition/components?lang=en"],
	]);
});
