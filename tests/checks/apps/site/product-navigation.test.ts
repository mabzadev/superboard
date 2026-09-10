import { expect, test } from "vitest";

import { organizeProductNavigation } from "../../../../apps/site/src/lib/product-navigation.js";

test("the core home remains reachable without analytics and is not duplicated by an editorial link", () => {
	const result = organizeProductNavigation(
		[
			{
				group_id: "custom",
				label: "Custom",
				order: 0,
				items: [
					{
						route_id: "edited-home",
						href: "/superboard-system/home",
						label: "Home",
						permission: "allow",
						order: 0,
					},
				],
			},
		],
		"/superboard-system/home",
	);
	expect(result.groups.flatMap(({ items }) => items).map(({ href }) => href)).toEqual([
		"/superboard-system/home",
	]);
	expect(result.activeHref).toBe("/superboard-system/home");
});

test("nested EmDash menu entries supply the local pages without inventing destinations", () => {
	const children = [
		{ route_id: "inbox", href: "/support/inbox", label: "Inbox", permission: "read", order: 0 },
		{
			route_id: "contacts",
			href: "/support/contacts",
			label: "Contacts",
			permission: "read",
			order: 1,
		},
	];
	const input = [
		{
			group_id: "edited",
			label: "Communication",
			order: 0,
			items: [{ ...children[0]!, label: "Support", children }],
		},
	];
	const result = organizeProductNavigation(input, "/support/contacts/123");
	expect(result.groups).toEqual(input);
	expect(result.localItems).toEqual(children);
	expect(result.activeItem?.route_id).toBe("contacts");
	expect(result.activeHref).toBe("/support/inbox");
	expect(organizeProductNavigation([], "/support/inbox").groups).toEqual([]);
});

test("the front preserves EmDash labels, order and deleted destinations", () => {
	const groups = [
		{
			group_id: "edited",
			label: "Mon menu",
			order: 0,
			items: [
				{
					route_id: "contacts",
					href: "/support/contacts",
					label: "Mes contacts",
					order: 0,
					permission: "read",
				},
				{
					route_id: "overview",
					href: "/analytics",
					label: "Mes chiffres",
					order: 1,
					permission: "read",
				},
			],
		},
	];
	const result = organizeProductNavigation(groups, "/analytics");
	expect(result.groups).toEqual(groups);
	expect(result.activeItem?.label).toBe("Mes chiffres");
});
