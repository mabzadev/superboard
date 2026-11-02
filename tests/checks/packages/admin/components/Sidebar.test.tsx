import {
	Plug,
	Gear,
	Trophy,
	ClockCounterClockwise,
	IdentificationCard,
} from "@phosphor-icons/react";
import * as React from "react";
import { describe, it, expect } from "vitest";

import {
	BYLINE_SCHEMA_NAV_ITEM,
	filterNavItemsByRole,
	getSidebarTaxonomies,
	isItemActive,
	resolveItemPath,
	resolveNavIcon,
	resolvePluginPageLabel,
	toPhosphorIconName,
	visibleCollectionEntries,
} from "../../../../../packages/admin/src/components/Sidebar";
import { render } from "../utils/render.tsx";

const ROLE_SUBSCRIBER = 10;
const ROLE_CONTRIBUTOR = 20;
const ROLE_AUTHOR = 30;
const ROLE_EDITOR = 40;
const ROLE_ADMIN = 50;

describe("getSidebarTaxonomies", () => {
	const taxonomies = [
		{ id: "course-en", name: "course", label: "Courses", locale: "en", translationGroup: "course" },
		{ id: "course-de", name: "course", label: "Gänge", locale: "de", translationGroup: "course" },
		{
			id: "course-fr",
			name: "course",
			label: "Types de plats",
			locale: "fr",
			translationGroup: "course",
		},
	];

	it("renders one logical taxonomy using the active route locale", () => {
		expect(getSidebarTaxonomies(taxonomies, "de").map((taxonomy) => taxonomy.label)).toEqual([
			"Gänge",
		]);
	});

	it("falls back to the configured default locale, then deterministically", () => {
		expect(getSidebarTaxonomies(taxonomies, "it", "fr")[0]?.label).toBe("Types de plats");
		expect(getSidebarTaxonomies(taxonomies, "it")[0]?.label).toBe("Gänge");
	});
});

describe("resolveItemPath", () => {
	it("preserves the active locale on taxonomy-management links", () => {
		expect(
			resolveItemPath({
				to: "/taxonomies/$taxonomy",
				label: "Gänge",
				icon: Gear,
				params: { taxonomy: "course" },
				search: { locale: "de" },
			}),
		).toBe("/taxonomies/course?locale=de");
	});
});

describe("isItemActive", () => {
	it("matches taxonomy links independently of their locale query", () => {
		expect(isItemActive("/taxonomies/course?locale=de", "/taxonomies/course")).toBe(true);
	});
});

describe("BYLINE_SCHEMA_NAV_ITEM invariants", () => {
	it("points to the /byline-schema route", () => {
		expect(BYLINE_SCHEMA_NAV_ITEM.to).toBe("/byline-schema");
		expect(BYLINE_SCHEMA_NAV_ITEM.icon).toBe(IdentificationCard);
	});

	it("gates on ROLE_ADMIN — editors and below must not see it", () => {
		expect(BYLINE_SCHEMA_NAV_ITEM.minRole).toBe(50);
	});
});

describe("filterNavItemsByRole", () => {
	const items = [
		{ to: "/", minRole: undefined },
		{ to: "/bylines", minRole: ROLE_EDITOR },
		{ to: "/byline-schema", minRole: ROLE_ADMIN },
	];

	it("passes items without minRole at every role", () => {
		for (const role of [ROLE_SUBSCRIBER, ROLE_CONTRIBUTOR, ROLE_AUTHOR, ROLE_EDITOR, ROLE_ADMIN]) {
			expect(filterNavItemsByRole(items, role).map((i) => i.to)).toContain("/");
		}
	});

	it("excludes /byline-schema for EDITOR", () => {
		const visible = filterNavItemsByRole(items, ROLE_EDITOR).map((i) => i.to);
		expect(visible).not.toContain("/byline-schema");
	});

	it("excludes /byline-schema for AUTHOR, CONTRIBUTOR, SUBSCRIBER", () => {
		for (const role of [ROLE_SUBSCRIBER, ROLE_CONTRIBUTOR, ROLE_AUTHOR]) {
			const visible = filterNavItemsByRole(items, role).map((i) => i.to);
			expect(visible).not.toContain("/byline-schema");
		}
	});

	it("includes /byline-schema for ADMIN", () => {
		const visible = filterNavItemsByRole(items, ROLE_ADMIN).map((i) => i.to);
		expect(visible).toContain("/byline-schema");
	});

	it("treats role=0 (unauthenticated / pre-fetch) as below every gate", () => {
		const visible = filterNavItemsByRole(items, 0).map((i) => i.to);
		expect(visible).toEqual(["/"]);
	});
});

describe("visibleCollectionEntries", () => {
	const collections = {
		posts: { label: "Posts" },
		contact_submissions: { label: "Contact Submissions", hidden: true },
		lead_notes: { label: "Lead Notes", hidden: true },
		pages: { label: "Pages", hidden: false },
	};

	it("drops collections flagged hidden", () => {
		expect(visibleCollectionEntries(collections).map(([slug]) => slug)).toEqual(["posts", "pages"]);
	});

	it("keeps manifest order for visible collections", () => {
		expect(visibleCollectionEntries({ b: { label: "B" }, a: { label: "A" } })).toEqual([
			["b", { label: "B" }],
			["a", { label: "A" }],
		]);
	});

	it("treats a missing hidden flag as visible", () => {
		expect(visibleCollectionEntries({ posts: { label: "Posts" } })).toHaveLength(1);
	});
});

describe("resolvePluginPageLabel", () => {
	const translate = (id: string) => (id === "Orders" ? "Bestellungen" : id);

	it("translates a declared label through the shared i18n instance", () => {
		expect(resolvePluginPageLabel("Orders", "my-shop", translate)).toBe("Bestellungen");
	});

	it("falls back to the literal label when no catalog entry exists", () => {
		expect(resolvePluginPageLabel("Products", "my-shop", translate)).toBe("Products");
	});

	it("prettifies the plugin id when no label is declared (untranslated)", () => {
		expect(resolvePluginPageLabel(undefined, "my-shop", translate)).toBe("My Shop");
		expect(resolvePluginPageLabel(undefined, "orders", translate)).toBe("Orders");
	});
});

describe("toPhosphorIconName", () => {
	it("converts kebab/snake/space names to PascalCase (the lazy-path key)", () => {
		expect(toPhosphorIconName("chart-bar")).toBe("ChartBar");
		expect(toPhosphorIconName("clock-counter-clockwise")).toBe("ClockCounterClockwise");
		expect(toPhosphorIconName("magnifying-glass")).toBe("MagnifyingGlass");
		expect(toPhosphorIconName("heart")).toBe("Heart");
	});
});

describe("resolveNavIcon", () => {
	it("falls back to Plug when no icon is provided", () => {
		expect(resolveNavIcon(undefined)).toBe(Plug);
		expect(resolveNavIcon("")).toBe(Plug);
	});

	it("resolves common/documented names synchronously from the static map", () => {
		expect(resolveNavIcon("settings")).toBe(Gear);
		expect(resolveNavIcon("trophy")).toBe(Trophy);
		expect(resolveNavIcon("history")).toBe(ClockCounterClockwise);
	});

	it("returns a stable (memoized) lazy component for a name outside the map", () => {
		const first = resolveNavIcon("heart");
		const second = resolveNavIcon("heart");
		expect(first).toBe(second);
		expect(first).not.toBe(Plug);
		expect((first as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for("react.lazy"));
	});

	it("renders the Plug fallback for a name that doesn't exist in Phosphor", async () => {
		const Unknown = resolveNavIcon("definitely-not-a-real-icon-xyz");
		const screen = await render(
			<React.Suspense fallback={<span>loading</span>}>
				<Unknown data-testid="resolved" />
				<Plug data-testid="expected" />
			</React.Suspense>,
		);
		const resolved = screen.getByTestId("resolved");
		await expect.element(resolved).toBeInTheDocument();
		expect(resolved.element().innerHTML).toBe(screen.getByTestId("expected").element().innerHTML);
	});
});
