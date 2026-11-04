import { authenticationSettingDefinitions } from "@superboard/contracts/authentication-settings";
import { useFrontContext } from "@superboard/front-ui/context";
import { lazy, Suspense, type ComponentType } from "react";

import { accessSections } from "./authentication-navigation.js";
import AuthenticationEditor from "./AuthenticationEditor.js";
import AuthenticationSettingsPage from "./AuthenticationSettingsPage.js";
import {
	AuthenticationSection,
	AuthenticationTabs,
	useAuthenticationI18n,
	useAuthenticationTab,
} from "./AuthenticationTabs.js";
import IdentityPanel from "./IdentityPanel.js";

const Apps = lazy(() => import("./app/(protected)/identity/[lang]/apps/page.js"));
const Banners = lazy(() =>
	import("./app/(protected)/identity/[lang]/apps/page.js").then((module) => ({
		default: module.AppBanners,
	})),
);
const Roles = lazy(() => import("./app/(protected)/identity/[lang]/roles/page.js"));
const Permissions = lazy(() => import("./app/(protected)/identity/[lang]/scopes/page.js"));
const Organizations = lazy(() => import("./app/(protected)/identity/[lang]/orgs/page.js"));
const Fields = lazy(() => import("./app/(protected)/identity/[lang]/user-attributes/page.js"));
const Saml = lazy(() => import("./app/(protected)/identity/[lang]/saml/page.js"));
const Recovery = lazy(() => import("./app/(protected)/identity/[lang]/account/page.js"));
const AccessKeys = lazy(() => import("./components/app/AccessKeyPageContent.js"));

const accessPanels: Record<(typeof accessSections)[number], ComponentType> = {
	roles: Roles,
	permissions: Permissions,
	organizations: Organizations,
	apps: Apps,
};
const settingTabs: Readonly<Record<string, string>> = {
	ENABLE_NAMES: "fields",
	NAMES_IS_REQUIRED: "fields",
	ENABLE_USER_ATTRIBUTE: "fields",
	ENABLE_ORG: "access",
	ENABLE_USER_APP_CONSENT: "access",
	ENABLE_APP_BANNER: "appearance",
};
function settingTab(key: string) {
	if (Object.hasOwn(settingTabs, key)) return settingTabs[key];
	return authenticationSettingDefinitions[key]?.group === "general" ? "appearance" : "sign-in";
}

export default function SettingsPage() {
	const { path } = useFrontContext();
	const i18n = useAuthenticationI18n();
	const { moved, selected, section, select } = useAuthenticationTab("settings");
	if (path === "/auth/access-key" || section === "keys")
		return (
			<section className="ds-page">
				<Suspense fallback={<p role="status">{i18n._("loading")}</p>}>
					<AccessKeys />
				</Suspense>
			</section>
		);
	if (moved) return <p role="status">{i18n._("loading")}</p>;
	return (
		<AuthenticationTabs view="settings" selected={selected} select={select}>
			<AuthenticationSettingsPage
				embedded={(key) => settingTab(key) === selected}
				onInvalidField={(key) => {
					select(settingTab(key));
				}}
			/>
			{selected === "sign-in" && (
				<>
					<AuthenticationSection name="sso">
						<IdentityPanel>
							<Saml />
						</IdentityPanel>
					</AuthenticationSection>
					<AuthenticationSection name="policies">
						<IdentityPanel>
							<Recovery />
						</IdentityPanel>
					</AuthenticationSection>
				</>
			)}
			{selected === "access" &&
				accessSections.map((name) => {
					const AccessPanel = accessPanels[name];
					return (
						<AuthenticationSection key={name} name={name}>
							<IdentityPanel>
								<AccessPanel />
							</IdentityPanel>
						</AuthenticationSection>
					);
				})}
			{selected === "fields" && (
				<IdentityPanel>
					<Fields />
				</IdentityPanel>
			)}
			{selected === "appearance" && (
				<IdentityPanel>
					<Banners />
				</IdentityPanel>
			)}
			<AuthenticationEditor view="settings" />
		</AuthenticationTabs>
	);
}
