import { canonicalFrontHref } from "@superboard/contracts/front-paths";

export type AuthenticationView = "users" | "settings";

export const authenticationTabs = {
	users: ["users", "directory", "devices", "referrals", "activity"],
	settings: ["sign-in", "access", "fields", "appearance"],
} as const satisfies Record<AuthenticationView, readonly string[]>;

export const accessSections = ["roles", "permissions", "organizations", "apps"] as const;

type Target = readonly [AuthenticationView, string, string?];

const legacyTabs: Readonly<Record<string, Target>> = {
	accounts: ["users", "users"],
	directory: ["users", "directory"],
	profiles: ["users", "devices"],
	logs: ["users", "activity"],
	login: ["settings", "sign-in"],
	security: ["settings", "sign-in"],
	configuration: ["settings", "sign-in"],
	keys: ["settings", "sign-in", "keys"],
	apps: ["settings", "access", "apps"],
	roles: ["settings", "access", "roles"],
	permissions: ["settings", "access", "permissions"],
	scopes: ["settings", "access", "permissions"],
	organizations: ["settings", "access", "organizations"],
	orgs: ["settings", "access", "organizations"],
	"user-attributes": ["settings", "fields"],
};

export interface AuthenticationTarget {
	view: AuthenticationView;
	tab: string;
	section: string | null;
}

export function authenticationTarget(
	view: AuthenticationView,
	params: URLSearchParams,
): AuthenticationTarget {
	const raw = params.get("tab") ?? "";
	const current = (["users", "settings"] as const).find((candidate) =>
		(authenticationTabs[candidate] as readonly string[]).includes(raw),
	);
	let target: Target = current
		? [current, raw]
		: Object.hasOwn(legacyTabs, raw)
			? legacyTabs[raw]
			: [view, authenticationTabs[view][0]];
	if (params.get("editor") === "banners") target = ["settings", "appearance"];
	const section = params.get("section") || target[2] || null;
	if (target[0] === "users" && target[1] === "users" && section === "directory")
		return { view: "users", tab: "directory", section: null };
	return { view: target[0], tab: target[1], section };
}

export function authenticationHref(href: string): string {
	const canonical = canonicalFrontHref(href);
	if (!canonical.startsWith("/") || canonical.startsWith("//")) return canonical;
	const url = new URL(canonical, "https://superboard.invalid");
	const view =
		url.pathname === "/auth/users"
			? "users"
			: url.pathname === "/auth/settings"
				? "settings"
				: null;
	if (!view || (!url.searchParams.has("tab") && !url.searchParams.has("editor"))) return canonical;
	const target = authenticationTarget(view, url.searchParams);
	url.pathname = `/auth/${target.view}`;
	url.searchParams.set("tab", target.tab);
	if (target.section) url.searchParams.set("section", target.section);
	else url.searchParams.delete("section");
	return `${url.pathname}${url.search}${url.hash}`;
}
