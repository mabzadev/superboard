import { afterEach, describe, expect, it, vi } from "vitest";

import { DataSettingsForm } from "../../../../../packages/plugins/superboard-data/src/front/files/DataSettingsForm.js";
import DataSettingsPage from "../../../../../packages/plugins/superboard-data/src/front/files/DataSettingsPage.js";
import { fireEvent, render, screen, waitFor } from "../../../packages/supbrd-front-ui/render.js";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("@superboard/front-ui/section-navigation.js", () => ({ SectionNavigation: () => null }));
vi.mock("@superboard/front-ui/navigation", () => ({ useRouter: () => router }));
afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	window.history.replaceState(null, "", "/");
});

describe("Data settings", () => {
	it("clears the load error after a successful retry", async () => {
		let available = false;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				if (!available) throw new Error("offline");
				return Response.json({ data: { values: { "superboard-content__default_locale": "fr" } } });
			}),
		);
		render(<DataSettingsForm section="content" locale="en" />);
		expect(await screen.findByRole("alert")).toBeInTheDocument();
		available = true;
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByLabelText("Default language")).toHaveValue("fr");
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});
	it("loads existing content settings and saves only the edited value", async () => {
		const values = {
			"superboard-content__default_locale": "fr",
			"superboard-content__required_locales": "fr\nen",
			"superboard-content__publishing_mode": "draft_review",
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
		render(<DataSettingsForm section="content" locale="en" />);
		const locale = await screen.findByLabelText("Default language");
		await waitFor(() => expect(locale).toHaveValue("fr"));
		fireEvent.change(locale, { target: { value: "en" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(await screen.findByRole("status")).toHaveTextContent("Settings saved");
		expect(writes).toEqual([{ "superboard-content__default_locale": "en" }]);
		expect(screen.getByLabelText("Required languages")).toHaveValue("fr\nen");
	});
	it("points to Plugins for diagnostics and links to content and file settings", () => {
		render(<DataSettingsPage />);
		expect(screen.queryByRole("tab", { name: "Configuration" })).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Open in Plugins" })).toHaveAttribute(
			"href",
			expect.stringMatching(/^\/_emdash\/admin\/plugins-manager\/[^/]+\/configuration$/),
		);
		expect(screen.getByRole("link", { name: "Content settings" })).toHaveAttribute(
			"href",
			"/data/content?tab=settings&lang=en",
		);
		expect(screen.getByRole("link", { name: "File settings" })).toHaveAttribute(
			"href",
			"/data/files?tab=settings&lang=en",
		);
		expect(router.replace).not.toHaveBeenCalled();
	});
	it.each([
		["content", "/data/content?tab=settings&lang=en"],
		["files", "/data/files?tab=settings&lang=en"],
	])("opens legacy %s settings links in their page", async (tab, destination) => {
		window.history.replaceState(null, "", `/data/settings?tab=${tab}`);
		render(<DataSettingsPage />);
		await waitFor(() => expect(router.replace).toHaveBeenCalledWith(destination));
		expect(screen.queryByRole("link", { name: "Open in Plugins" })).not.toBeInTheDocument();
	});
	it("keeps legacy configuration links on the settings page", () => {
		window.history.replaceState(null, "", "/data/settings?tab=configuration");
		render(<DataSettingsPage />);
		expect(screen.getByRole("link", { name: "Content settings" })).toBeInTheDocument();
		expect(router.replace).not.toHaveBeenCalled();
	});
});
