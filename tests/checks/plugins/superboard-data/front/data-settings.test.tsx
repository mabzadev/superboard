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

const prefix = "superboard-data.setting.";

function stubSettingsEndpoint(stored: Record<string, unknown>) {
	const writes: unknown[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url, options) => {
			if (options?.method === "PUT") {
				const values: Record<string, unknown> = JSON.parse(options.body).values;
				writes.push(values);
				for (const [key, value] of Object.entries(values)) if (key in stored) stored[key] = value;
			}
			return Response.json({ data: { values: { ...stored }, secretsSet: {} } });
		}),
	);
	return writes;
}

describe("Data settings", () => {
	it("clears the load error after a successful retry", async () => {
		let available = false;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				if (!available) throw new Error("offline");
				return Response.json({ data: { values: { [`${prefix}content_default_locale`]: "fr" } } });
			}),
		);
		render(<DataSettingsForm section="content" locale="en" />);
		expect(await screen.findByRole("alert")).toBeInTheDocument();
		available = true;
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByLabelText("Default language")).toHaveValue("fr");
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});
	it("shows and saves content settings under the keys returned by the Data settings endpoint", async () => {
		const writes = stubSettingsEndpoint({
			[`${prefix}content_default_locale`]: "fr",
			[`${prefix}content_required_locales`]: "fr\nen",
			[`${prefix}content_publishing_mode`]: "draft_review",
			[`${prefix}files_max_upload_bytes`]: null,
			[`${prefix}files_allowed_content_types`]: null,
			[`${prefix}files_signed_url_ttl_seconds`]: null,
		});
		render(<DataSettingsForm section="content" locale="en" />);
		const locale = await screen.findByLabelText("Default language");
		await waitFor(() => expect(locale).toHaveValue("fr"));
		expect(screen.getByLabelText("Required languages")).toHaveValue("fr\nen");
		expect(screen.getByLabelText("Publishing mode")).toHaveValue("draft_review");

		fireEvent.change(locale, { target: { value: "en" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		expect(await screen.findByRole("status")).toHaveTextContent("Settings saved");
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(writes).toEqual([{ [`${prefix}content_default_locale`]: "en" }]);
		expect(locale).toHaveValue("en");
		expect(screen.getByLabelText("Required languages")).toHaveValue("fr\nen");
	});
	it("shows and saves numeric file settings under the keys returned by the Data settings endpoint", async () => {
		const writes = stubSettingsEndpoint({
			[`${prefix}content_default_locale`]: null,
			[`${prefix}content_required_locales`]: null,
			[`${prefix}content_publishing_mode`]: null,
			[`${prefix}files_max_upload_bytes`]: 2097152,
			[`${prefix}files_allowed_content_types`]: "image/png",
			[`${prefix}files_signed_url_ttl_seconds`]: 900,
		});
		render(<DataSettingsForm section="files" locale="fr" />);
		const lifetime = await screen.findByLabelText("Durée des URL signées (secondes)");
		await waitFor(() => expect(lifetime).toHaveValue(900));
		expect(screen.getByLabelText("Taille maximale des fichiers (octets)")).toHaveValue(2097152);
		expect(screen.getByLabelText("Types de contenu autorisés")).toHaveValue("image/png");

		fireEvent.change(lifetime, { target: { value: "1200" } });
		fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

		expect(await screen.findByRole("status")).toHaveTextContent("Paramètres enregistrés");
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(writes).toEqual([{ [`${prefix}files_signed_url_ttl_seconds`]: 1200 }]);
		expect(lifetime).toHaveValue(1200);
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
