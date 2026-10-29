import type { AuthenticationSettingsGroup } from "@superboard/contracts/authentication-settings";
import { useFrontContext } from "@superboard/front-ui/context";
import { PluginConfigurationTab } from "@superboard/front-ui/plugin-configuration-tab";
import { lazy, type ComponentType } from "react";

import AuthenticationEditor from "./AuthenticationEditor.js";
import AuthenticationSettingsPage from "./AuthenticationSettingsPage.js";
import {
	AuthenticationTabs,
	useAuthenticationTab,
	AuthenticationSection,
} from "./AuthenticationTabs.js";
import IdentityPanel from "./IdentityPanel.js";

const Apps = lazy(() => import("./app/(protected)/identity/[lang]/apps/page.js"));
const Roles = lazy(() => import("./app/(protected)/identity/[lang]/roles/page.js"));
const Permissions = lazy(() => import("./app/(protected)/identity/[lang]/scopes/page.js"));
const Organizations = lazy(() => import("./app/(protected)/identity/[lang]/orgs/page.js"));
const Fields = lazy(() => import("./app/(protected)/identity/[lang]/user-attributes/page.js"));
const Logs = lazy(() => import("./app/(protected)/identity/[lang]/logs/page.js"));
const Saml = lazy(() => import("./app/(protected)/identity/[lang]/saml/page.js"));
const Policies = lazy(() => import("./app/(protected)/identity/[lang]/account/page.js"));
const Keys = lazy(() => import("./components/app/AccessKeyPageContent.js"));
const panels: Record<string, ComponentType> = {
	apps: Apps,
	roles: Roles,
	permissions: Permissions,
	organizations: Organizations,
	fields: Fields,
	logs: Logs,
};
const tabs = [
	"login",
	"security",
	"apps",
	"roles",
	"permissions",
	"organizations",
	"fields",
	"appearance",
	"logs",
	"configuration",
];
const groups: Record<string, AuthenticationSettingsGroup[]> = {
	login: ["login", "providers"],
	security: ["security", "advanced"],
	appearance: ["general"],
};

export default function SettingsPage() {
	const { selected, select } = useAuthenticationTab(tabs, "login");
	const { locale } = useFrontContext();
	const Panel = Object.hasOwn(panels, selected) ? panels[selected] : null;
	return (
		<AuthenticationTabs view="settings" tabs={tabs} selected={selected} select={select}>
			<div hidden={!groups[selected]}>
				<AuthenticationSettingsPage
					embeddedGroups={groups[selected] ?? []}
					onInvalidGroup={(group) => {
						select(
							group === "general"
								? "appearance"
								: group === "providers"
									? "login"
									: group === "advanced"
										? "security"
										: group,
						);
					}}
				/>
			</div>
			{Panel && (
				<IdentityPanel>
					<Panel />
				</IdentityPanel>
			)}
			{selected === "configuration" && <PluginConfigurationTab locale={locale} />}
			{selected === "login" && (
				<AuthenticationSection name="sso">
					<IdentityPanel>
						<Saml />
					</IdentityPanel>
				</AuthenticationSection>
			)}
			{selected === "security" && (
				<>
					<AuthenticationSection name="policies">
						<IdentityPanel>
							<Policies />
						</IdentityPanel>
					</AuthenticationSection>
					<AuthenticationSection name="keys">
						<Keys />
					</AuthenticationSection>
				</>
			)}
			<AuthenticationEditor view="settings" />
		</AuthenticationTabs>
	);
}
