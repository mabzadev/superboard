import { describe, expect, it } from "vitest";

import {
	FRONT_COMMAND_MESSAGES,
	frontCommandMessage,
} from "../../../../apps/site/src/lib/front-command-messages.js";
import {
	commandPathname,
	filterCommands,
	menuDestination,
	navigationCommands,
	recentCommands,
	scoreCommand,
	type FrontCommand,
} from "../../../../apps/site/src/lib/front-command-palette.js";
import type { NativeFrontNavigationGroup } from "../../../../apps/site/src/lib/native-front-presentation.js";

const item = (label: string, href: string, children?: NativeFrontNavigationGroup["items"]) => ({
	route_id: href,
	label,
	href,
	order: 0,
	permission: "allow",
	...(children ? { children } : {}),
});

const navigation: NativeFrontNavigationGroup[] = [
	{ group_id: "home", label: "Overview", order: 0, direct: true, items: [item("Overview", "/")] },
	{
		group_id: "settings",
		label: "Environment settings",
		order: 1,
		items: [
			item("General", "/core/settings"),
			item("API keys", "/auth/settings?tab=security&section=keys"),
		],
	},
	{
		group_id: "acquisition",
		label: "Acquisition",
		order: 2,
		items: [
			item("Acquisition", "/acquisition/paywalls", [
				item("Paywalls", "/acquisition/paywalls"),
				item("Dynamic links", "/acquisition/dynamic-links"),
			]),
		],
	},
];

describe("command palette entries", () => {
	it("lists every section, page and local tab once with its location", () => {
		const commands = navigationCommands(navigation);
		expect(commands.map(({ label, hint }) => [label, hint])).toEqual([
			["Overview", undefined],
			["General", "Environment settings"],
			["API keys", "Environment settings"],
			["Acquisition", undefined],
			["Paywalls", "Acquisition"],
			["Dynamic links", "Acquisition"],
		]);
		expect(commands.every(({ group }) => group === "pages")).toBe(true);
	});

	it("matches words regardless of case, accents and order, ranking label prefixes first", () => {
		const commands = navigationCommands(navigation);
		expect(filterCommands(commands, "keys api").map(({ label }) => label)).toEqual(["API keys"]);
		expect(filterCommands(commands, "ENVIRONMENT").map(({ label }) => label)).toEqual([
			"General",
			"API keys",
		]);
		const french: FrontCommand = { id: "fr", group: "pages", label: "Paramètres généraux" };
		expect(scoreCommand(french, "parametres gen")).toBeGreaterThan(0);
		expect(scoreCommand(french, "billing")).toBe(0);
		expect(filterCommands(commands, "links")[0]?.label).toBe("Dynamic links");
	});

	it("orders recent pages, then quick actions, then pages, and hides recents while searching", () => {
		const commands: FrontCommand[] = [
			{ id: "p", group: "pages", label: "Dynamic links", href: "/acquisition/dynamic-links" },
			{ id: "a", group: "actions", label: "Create a dynamic link", href: "/x?create=1" },
			{ id: "r", group: "recent", label: "Dynamic links", href: "/acquisition/dynamic-links" },
		];
		expect(filterCommands(commands, "").map(({ id }) => id)).toEqual(["r", "a", "p"]);
		expect(filterCommands(commands, "dynamic").map(({ id }) => id)).toEqual(["a", "p"]);
	});

	it("derives quick-action destinations from the menu entries the operator can open", () => {
		const commands = navigationCommands(navigation);
		expect(menuDestination(commands, "/acquisition/dynamic-links", { create: "1" })).toBe(
			"/acquisition/dynamic-links?create=1",
		);
		expect(menuDestination(commands, "/core/settings", { tab: "team" })).toBe(
			"/core/settings?tab=team",
		);
		expect(menuDestination(commands, "/communication/marketing-email")).toBeUndefined();
	});

	it("lets a quick action replace the identical menu page", () => {
		const commands: FrontCommand[] = [
			{ id: "p", group: "pages", label: "API keys", href: "/auth/settings?section=keys" },
			{ id: "a", group: "actions", label: "API keys", href: "/auth/settings?section=keys" },
		];
		expect(filterCommands(commands, "").map(({ id }) => id)).toEqual(["a"]);
	});

	it("skips the current page in recent pages and compares canonical paths", () => {
		const recent = recentCommands(
			[
				{ href: "/core/settings", label: "General" },
				{ href: "/acquisition/dynamic-links", label: "Dynamic links", hint: "Acquisition" },
			],
			"/core/settings",
		);
		expect(recent.map(({ label, hint }) => [label, hint])).toEqual([
			["Dynamic links", "Acquisition"],
		]);
		expect(commandPathname("/auth/settings?tab=security&section=keys")).toBe("/auth/settings");
	});

	it("ships every palette string in English and French", () => {
		expect(Object.keys(FRONT_COMMAND_MESSAGES.fr).toSorted()).toEqual(
			Object.keys(FRONT_COMMAND_MESSAGES.en).toSorted(),
		);
		expect(frontCommandMessage("fr", "empty", { query: "clés" })).toBe(
			"Aucun résultat pour « clés »",
		);
	});
});
