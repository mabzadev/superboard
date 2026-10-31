import { describe, expect, it } from "vitest";

import {
	authenticationHref,
	authenticationTarget,
} from "../../../../../packages/plugins/superboard-authentification/src/front/authentication-navigation.js";

const target = (view: "users" | "settings", query: string) =>
	authenticationTarget(view, new URLSearchParams(query));

describe("authentication tabs", () => {
	it.each([
		["login", "sign-in", null],
		["security", "sign-in", null],
		["configuration", "sign-in", null],
		["keys", "sign-in", "keys"],
		["apps", "access", "apps"],
		["roles", "access", "roles"],
		["permissions", "access", "permissions"],
		["scopes", "access", "permissions"],
		["organizations", "access", "organizations"],
		["orgs", "access", "organizations"],
		["fields", "fields", null],
		["user-attributes", "fields", null],
		["appearance", "appearance", null],
	])("opens former settings tab %s in %s", (tab, expected, section) => {
		expect(target("settings", `tab=${tab}`)).toEqual({
			view: "settings",
			tab: expected,
			section,
		});
	});

	it.each([
		["accounts", "users"],
		["profiles", "devices"],
		["devices", "devices"],
		["referrals", "referrals"],
	])("opens former users tab %s in %s", (tab, expected) => {
		expect(target("users", `tab=${tab}`)).toMatchObject({ view: "users", tab: expected });
	});

	it("moves logs to Users › Activity and banners to Appearance", () => {
		expect(target("settings", "tab=logs&editor=email&id=7")).toMatchObject({
			view: "users",
			tab: "activity",
		});
		expect(target("settings", "tab=apps&editor=banners&id=3")).toMatchObject({
			view: "settings",
			tab: "appearance",
		});
	});

	it("keeps explicit sections and falls back on unknown tabs", () => {
		expect(target("settings", "tab=login&section=sso")).toEqual({
			view: "settings",
			tab: "sign-in",
			section: "sso",
		});
		expect(target("users", "tab=accounts&section=directory").section).toBe("directory");
		expect(target("settings", "tab=constructor")).toEqual({
			view: "settings",
			tab: "sign-in",
			section: null,
		});
	});

	it("rewrites former bookmarks to the view that now owns them", () => {
		expect(authenticationHref("/auth/logs/email/42?lang=fr")).toBe(
			"/auth/users?lang=fr&tab=activity&editor=email&id=42",
		);
		expect(authenticationHref("/auth/roles/new?lang=fr")).toBe(
			"/auth/settings?lang=fr&tab=access&editor=roles&id=new&section=roles",
		);
		expect(authenticationHref("/auth/account")).toBe("/auth/settings?tab=sign-in&editor=account");
		expect(authenticationHref("/analytics/events?user=1")).toBe("/analytics/events?user=1");
	});
});
