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

test.each(["en", "fr"])(
	"authentication settings owns its menu highlight instead of the environment keys shortcut (%s)",
	(locale) => {
		const settings = {
			route_id: "settings",
			href: `/auth/settings?lang=${locale}`,
			label: "Settings",
			permission: "read",
			order: 1,
		};
		const groups = [
			{
				group_id: "authentication",
				label: "Authentication",
				order: 0,
				items: [
					{ route_id: "users", href: "/auth/users", label: "Users", permission: "read", order: 0 },
					settings,
				],
			},
			{
				group_id: "environment",
				label: "Environment",
				order: 1,
				items: [
					{
						route_id: "environment",
						href: "/core/settings",
						label: "Environment settings",
						permission: "read",
						order: 0,
						children: [
							{
								route_id: "keys",
								href: "/auth/settings?tab=security&section=keys",
								label: "API keys",
								permission: "read",
								order: 0,
							},
						],
					},
				],
			},
		];
		for (const path of [
			"/auth/settings",
			`/auth/settings?lang=${locale}`,
			`/auth/settings?lang=${locale}&tab=configuration`,
		]) {
			const navigation = organizeProductNavigation(groups, path);
			expect(navigation.activeItem?.route_id).toBe("settings");
			expect(navigation.activeHref).toBe(settings.href);
			expect(
				navigation.groups.find((group) =>
					group.items.some((item) => item.href === navigation.activeHref),
				)?.group_id,
			).toBe("authentication");
		}
	},
);

test.each(["en", "fr"])(
	"the environment keys shortcut keeps Environment settings selected on its own tab (%s)",
	(locale) => {
		const keys = {
			route_id: "keys",
			href: "/auth/settings?tab=security&section=keys",
			label: "API keys",
			permission: "read",
			order: 1,
		};
		const groups = [
			{
				group_id: "authentication",
				label: "Authentication",
				order: 0,
				items: [
					{
						route_id: "settings",
						href: `/auth/settings?lang=${locale}`,
						label: "Settings",
						permission: "read",
						order: 0,
					},
				],
			},
			{
				group_id: "environment",
				label: "Environment",
				order: 1,
				items: [
					{
						route_id: "environment",
						href: "/core/settings",
						label: "Environment settings",
						permission: "read",
						order: 0,
						children: [
							{
								route_id: "general",
								href: "/core/settings",
								label: "General",
								permission: "read",
								order: 0,
							},
							keys,
						],
					},
				],
			},
		];
		const navigation = organizeProductNavigation(
			groups,
			`/auth/settings?tab=security&section=keys&lang=${locale}`,
		);
		expect(navigation.activeItem?.route_id).toBe("keys");
		expect(navigation.activeHref).toBe("/core/settings");
		expect(navigation.localItems.map(({ route_id }) => route_id)).toEqual(["general", "keys"]);
		expect(
			organizeProductNavigation(groups, `/auth/settings?tab=security&lang=${locale}`).activeItem
				?.route_id,
		).toBe("settings");
	},
);
