import { describe, it, expect } from "vitest";

import {
	DEFAULT,
	FILE,
} from "../../../../../../../../../supbrd-front-ui/src/shared/constants/OptionsConstants.js";
import type { Link } from "../../../../../../../../../supbrd-front-ui/src/shared/types/index.js";
import {
	hasEditChanges,
	disableEditButton,
	getEditFirstErrorSection,
	type LinkEditFormValues,
} from "../useLinkEditValidation.js";
const selected: Link = {
	id: "link-a",
	name: "Campaign",
	path: "campaign",
	active: true,
	ads_platform: "google",
	tags: [],
	total_views: 0,
	total_opens: 0,
	total_installs: 0,
	total_reinstalls: 0,
	total_reactivations: 0,
	total_time_spent: 0,
	total_revenue: 0,
	created_at: "2026-01-01",
	updated_at: "2026-01-01",
};
const form: LinkEditFormValues = {
	name: "Campaign",
	path: "campaign",
	linkType: "google",
	socialMediaTitle: "",
	socialMediaSubTitle: "",
	imageType: FILE,
	imageFile: null,
	imageLink: "",
	tagList: [],
	iOSRedirectURL: null,
	iOSRedirectType: DEFAULT,
	androidRedirectURL: null,
	androidRedirectType: DEFAULT,
	desktopRedirectURL: null,
	desktopRedirectType: DEFAULT,
	showPreviewIOS: false,
	showPreviewAndroid: false,
	utmCampaign: "",
	utmMedium: "",
	utmSource: "",
	keyValuePair: [],
	pathAvailable: true,
};
describe("link editing validation", () => {
	it("keeps an unchanged link disabled when optional server fields are omitted", () => {
		expect(hasEditChanges(form, selected, [])).toBe(false);
		expect(disableEditButton(form, selected, [])).toBe(true);
	});
	it("allows changed metadata without requiring custom redirect values", () => {
		const edited = { ...form, name: "Renamed campaign" };
		expect(hasEditChanges(edited, selected, [])).toBe(true);
		expect(disableEditButton(edited, selected, [])).toBe(false);
	});
	it("points to an unavailable changed path before the remaining sections", () => {
		const edited = {
			...form,
			path: "reserved",
			pathAvailable: false,
			imageType: "link",
			imageLink: "invalid",
		};
		expect(disableEditButton(edited, selected, [])).toBe(true);
		expect(getEditFirstErrorSection(edited, selected)).toBe("details");
	});
	it("rejects an invalid social preview URL but accepts an uploaded file", () => {
		const edited = { ...form, name: "Edited", imageType: "link", imageLink: "invalid" };
		expect(disableEditButton(edited, selected, [])).toBe(true);
		expect(getEditFirstErrorSection(edited, selected)).toBe("social_media_preview");
		expect(
			disableEditButton(
				{ ...edited, imageType: FILE, imageFile: new File(["png"], "preview.png") },
				selected,
				[],
			),
		).toBe(false);
	});
	it.each(["android", "iOS", "desktop"] as const)(
		"requires HTTPS for a custom %s destination",
		(platform) => {
			const edited = {
				...form,
				name: "Edited",
				[platform + "RedirectType"]: "custom",
				[platform + "RedirectURL"]: { url: "http://example.test" },
			};
			expect(disableEditButton(edited, selected, [])).toBe(true);
			expect(getEditFirstErrorSection(edited, selected)).toBe("redirects");
			expect(
				disableEditButton(
					{ ...edited, [platform + "RedirectURL"]: { url: "https://example.test/path" } },
					selected,
					[],
				),
			).toBe(false);
		},
	);
	it("retains tracking, preview and metadata changes while preserving the original record", () => {
		for (const patch of [
			{ utmCampaign: "summer" },
			{ utmMedium: "email" },
			{ utmSource: "newsletter" },
			{ showPreviewIOS: true },
			{ showPreviewAndroid: true },
			{ tagList: ["summer"] },
			{ keyValuePair: [{ key: "offer", value: "summer" }] },
			{ socialMediaTitle: "Summer" },
			{ socialMediaSubTitle: "Preview" },
			{ imageType: "link", imageLink: "https://cdn.example.test/preview.png" },
		])
			expect(hasEditChanges({ ...form, ...patch }, selected, [])).toBe(true);
		expect(selected.tags).toEqual([]);
	});
});
