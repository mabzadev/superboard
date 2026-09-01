import {
	defineNativeFrontPlugin,
	navigationGroup,
	type NativeRendererMountInput,
} from "@superboard/supbrd-core";

import {
	USER_RENDERER_IDS,
	mountUserRenderer,
	userPluginManifest,
	type UserRendererProps,
} from "./index.js";

const application = navigationGroup({
	group_id: "application",
	group_label: "Application",
	group_order: 1,
});
const identity = navigationGroup({
	group_id: "identity",
	group_label: "Identity",
	group_order: 2,
});
const platform = navigationGroup({
	group_id: "platform",
	group_label: "Platform",
	group_order: 8,
});
const anonymous = {
	auth_policy: "anonymous_only" as const,
	permission_expression: "allow",
	renderer_id: USER_RENDERER_IDS.login,
};
const userRendererIds = new Set<string>(Object.values(USER_RENDERER_IDS));

const contribution = defineNativeFrontPlugin({
	plugin_id: "supbrd-plug-user",
	plugin_label: "Identity",
	description:
		"Manage operator access, application users, and identity resources through the active plugin contract.",
	permission_expression: "users.read",
	surfaces: [
		{
			...anonymous,
			path_pattern: "/login",
			title: "Sign in",
			route_id: "superboard.login",
			page_id: "page.superboard_login",
			transition: "login",
			actions: [{ label: "Continue with EmDash", href: "/_emdash/admin/login" }],
		},
		{ ...anonymous, path_pattern: "/accept-invite", title: "Accept invitation" },
		{ ...anonymous, path_pattern: "/new_password", title: "Recover operator access" },
		{ ...anonymous, path_pattern: "/register", title: "Operator account" },
		{ ...anonymous, path_pattern: "/register/with_email", title: "Operator account" },
		{ ...anonymous, path_pattern: "/reset_password", title: "Recover operator access" },
		{
			path_pattern: "/app/profile",
			title: "Profile",
			route_id: "superboard.profile",
			page_id: "page.superboard_profile",
			renderer_id: USER_RENDERER_IDS.profile,
			transition: "authenticated_home",
			navigation: application("Profile", -1),
		},
		{
			path_pattern: "/app/users",
			title: "App · Users",
			route_id: "superboard.users",
			page_id: "page.superboard_users",
			renderer_id: USER_RENDERER_IDS.admin,
			navigation: application("App · Users", 0),
		},
		{
			path_pattern: "/app/customers",
			title: "Customers",
			navigation: application("Customers", 1),
		},
		{
			path_pattern: "/app/referrals",
			title: "Referrals",
			navigation: application("Referrals", 2),
		},
		{
			path_pattern: "/app/access-key",
			title: "Access key",
			navigation: application("Access key", 3),
		},
		{
			path_pattern: "/account",
			title: "Operator account",
			navigation: platform("Operator account", 2),
		},
		{ path_pattern: "/identity", title: "Identity" },
		{ path_pattern: "/identity/:lang", title: "Identity" },
		{ path_pattern: "/identity/:lang/account", title: "Identity · Account" },
		{
			path_pattern: "/identity/:lang/dashboard",
			title: "Identity · Overview",
			navigation: identity("Overview", 0, "/identity/en/dashboard"),
		},
		{
			path_pattern: "/identity/:lang/users",
			title: "Identity · Users",
			navigation: identity("Users", 1, "/identity/en/users"),
		},
		{ path_pattern: "/identity/:lang/users/:authId", title: "Identity · User" },
		{
			path_pattern: "/identity/:lang/apps",
			title: "Identity · Applications",
			navigation: identity("Applications", 2, "/identity/en/apps"),
		},
		{ path_pattern: "/identity/:lang/apps/new", title: "Identity · New application" },
		{ path_pattern: "/identity/:lang/apps/:id", title: "Identity · Application" },
		{ path_pattern: "/identity/:lang/apps/banners/new", title: "Identity · New banner" },
		{ path_pattern: "/identity/:lang/apps/banners/:id", title: "Identity · Banner" },
		{
			path_pattern: "/identity/:lang/orgs",
			title: "Identity · Organizations",
			navigation: identity("Organizations", 3, "/identity/en/orgs"),
		},
		{ path_pattern: "/identity/:lang/orgs/new", title: "Identity · New organization" },
		{ path_pattern: "/identity/:lang/orgs/:id", title: "Identity · Organization" },
		{
			path_pattern: "/identity/:lang/roles",
			title: "Identity · Roles",
			navigation: identity("Roles", 4, "/identity/en/roles"),
		},
		{ path_pattern: "/identity/:lang/roles/new", title: "Identity · New role" },
		{ path_pattern: "/identity/:lang/roles/:id", title: "Identity · Role" },
		{
			path_pattern: "/identity/:lang/scopes",
			title: "Identity · Scopes",
			navigation: identity("Scopes", 5, "/identity/en/scopes"),
		},
		{ path_pattern: "/identity/:lang/scopes/new", title: "Identity · New scope" },
		{ path_pattern: "/identity/:lang/scopes/:id", title: "Identity · Scope" },
		{
			path_pattern: "/identity/:lang/user-attributes",
			title: "Identity · User attributes",
			navigation: identity("User attributes", 6, "/identity/en/user-attributes"),
		},
		{
			path_pattern: "/identity/:lang/user-attributes/new",
			title: "Identity · New user attribute",
		},
		{
			path_pattern: "/identity/:lang/user-attributes/:id",
			title: "Identity · User attribute",
		},
		{
			path_pattern: "/identity/:lang/saml",
			title: "Identity · SAML",
			navigation: identity("SAML", 7, "/identity/en/saml"),
		},
		{ path_pattern: "/identity/:lang/saml/new", title: "Identity · New SAML connection" },
		{ path_pattern: "/identity/:lang/saml/:id", title: "Identity · SAML connection" },
		{
			path_pattern: "/identity/:lang/logs",
			title: "Identity · Logs",
			navigation: identity("Logs", 8, "/identity/en/logs"),
		},
		{ path_pattern: "/identity/:lang/logs/email/:id", title: "Identity · Email log" },
		{ path_pattern: "/identity/:lang/logs/sign-in/:id", title: "Identity · Sign-in log" },
		{ path_pattern: "/identity/:lang/logs/sms/:id", title: "Identity · SMS log" },
	],
});

export const nativeFrontPlugin = {
	...contribution,
	renderer_ids: [...userRendererIds],
	renderer_builds: Object.fromEntries(
		userPluginManifest.renderers.map(({ renderer_id: rendererId, build_checksum: checksum }) => [
			rendererId,
			checksum,
		]),
	),
	mount_renderer(input: NativeRendererMountInput) {
		if (!userRendererIds.has(input.renderer.renderer_id)) return null;
		const view = mountUserRenderer({
			renderer_id: input.renderer.renderer_id,
			descriptor: input.renderer,
			props: rendererProps(input),
		});
		return {
			kind: "surface" as const,
			eyebrow: "Identity",
			title: input.page_title ?? "Identity",
			description: view.description_message_id,
			details: [
				{ label: "Plugin", value: "supbrd-plug-user" },
				{ label: "Renderer", value: view.renderer_id },
				{ label: "Path", value: input.path },
			],
			actions:
				view.kind === "login"
					? [{ label: "Continue with EmDash", href: "/_emdash/admin/login" }]
					: [],
		};
	},
};

function rendererProps(input: NativeRendererMountInput): UserRendererProps {
	const factories: Record<string, () => UserRendererProps> = {
		[USER_RENDERER_IDS.login]: () => ({
			kind: "login",
			title_message_id: "user.page.sign_in",
		}),
		[USER_RENDERER_IDS.profile]: () => {
			if (!input.operator) throw new Error("User profile renderer requires an operator");
			return { kind: "profile", operator: input.operator };
		},
		[USER_RENDERER_IDS.members]: () => ({ kind: "members", page_size: 25, members: [] }),
		[USER_RENDERER_IDS.admin]: () => ({
			kind: "admin_surface",
			route_id: input.route_id ?? "unknown",
			path: input.path,
		}),
	};
	const factory = factories[input.renderer.renderer_id];
	if (!factory) throw new Error(`User renderer is unavailable: ${input.renderer.renderer_id}`);
	return factory();
}
