import { afterEach, describe, expect, it, vi } from "vitest";

import DataSettingsPage from "../../../../../packages/plugins/superboard-data/src/front/files/DataSettingsPage.js";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../../packages/supbrd-front-ui/render.js";

vi.mock("@superboard/front-ui/section-navigation.js", () => ({ SectionNavigation: () => null }));
afterEach(() => vi.unstubAllGlobals());

describe("Data settings", () => {
	it("clears the load error after a successful retry", async () => {
		let available = false;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				if (!available) throw new Error("offline");
				return Response.json({ data: { values: { "supbrd-plug-content__default_locale": "fr" } } });
			}),
		);
		render(<DataSettingsPage />);
		const panel = within(screen.getByRole("tabpanel", { name: "Content" }));
		expect(await panel.findByRole("alert")).toBeInTheDocument();
		available = true;
		fireEvent.click(panel.getByRole("button", { name: "Retry" }));
		expect(await panel.findByLabelText("Default language")).toHaveValue("fr");
		expect(panel.queryByRole("alert")).not.toBeInTheDocument();
	});
	it("loads existing content settings and saves only the edited value", async () => {
		const values = {
			"supbrd-plug-content__default_locale": "fr",
			"supbrd-plug-content__required_locales": "fr\nen",
			"supbrd-plug-content__publishing_mode": "draft_review",
		};
		const writes: unknown[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url, options) => {
				if (options?.method === "PUT") {
					const body = JSON.parse(options.body);
					writes.push(body.values);
					Object.assign(values, body.values);
				}
				return Response.json({ data: { values } });
			}),
		);
		render(<DataSettingsPage />);
		const locale = await screen.findByLabelText("Default language");
		await waitFor(() => expect(locale).toHaveValue("fr"));
		fireEvent.change(locale, { target: { value: "en" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(await screen.findByRole("status")).toHaveTextContent("Settings saved");
		expect(writes).toEqual([{ "supbrd-plug-content__default_locale": "en" }]);
		expect(screen.getByLabelText("Required languages")).toHaveValue("fr\nen");
	});
});
