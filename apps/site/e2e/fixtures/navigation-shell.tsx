import { createRoot } from "react-dom/client";

import release from "../../../../config/superboard-parity-release.json";
import { NativeFrontApp } from "../../src/components/NativeFrontApp.js";
import {
	CORE_ADMIN_SHELL_DESCRIPTOR,
	CORE_FRONT_RENDERER_DESCRIPTORS,
	CORE_OPERATOR_HOME_RENDERER_ID,
} from "../../src/lib/core-front-contract.js";
import { USER_FRONT_CATALOGS } from "../../src/lib/user-front-catalogs.js";

import "../../src/styles/native-front.css";

const parameters = new URL(location.href).searchParams;
const locale = parameters.get("lang") === "en" ? "en" : "fr";
document.documentElement.lang = locale;
document.documentElement.dir = "ltr";
const operator = {
	id: "navigation-fixture",
	name: "Navigation",
	email: "navigation@example.test",
	role: 50,
	disabled: false,
};
const home = CORE_FRONT_RENDERER_DESCRIPTORS.find(
	({ renderer_id }) => renderer_id === CORE_OPERATOR_HOME_RENDERER_ID,
)!;
const path = parameters.get("path") ?? "/support/inbox";
const mount = {
	route_id: "emdash.core.operator_home",
	path,
	view_title: null,
	parameters: {},
	operator,
};
createRoot(document.getElementById("navigation-fixture")!).render(
	<NativeFrontApp
		projection={{
			instance_id: "navigation-fixture",
			release_id: "navigation-fixture",
			operator,
			path,
			locale,
			plugin_lock: release.release.payload.plugin_lock,
			navigation: [
				{
					group_id: "users",
					label: locale === "fr" ? "Utilisateurs et accès" : "Users and access",
					order: 0,
					items: [
						{
							route_id: "users",
							label: locale === "fr" ? "Utilisateurs" : "Users",
							href: "/app/users",
							permission: "allow",
							order: 0,
						},
					],
				},
				{
					group_id: "communication",
					label: "Communication",
					order: 1,
					items: [
						{
							route_id: "support",
							label: "Conversations",
							href: "/support/inbox",
							permission: "allow",
							order: 0,
						},
					],
				},
			],
			layout_mounts: [{ ...mount, renderer: CORE_ADMIN_SHELL_DESCRIPTOR! }],
			content_mounts: [{ ...mount, renderer: home }],
			state_mount: null,
			theme: {},
			messages: USER_FRONT_CATALOGS[locale],
			deployment: {
				id: "navigation-fixture.local",
				application: "Vplusflare · Navigation",
				label: "Local",
				environment: "local",
				apiUrl: "http://localhost:8787",
				consoleUrl: "http://localhost:9321",
			},
		}}
	/>,
);
