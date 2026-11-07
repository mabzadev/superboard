import { useFrontContext } from "@superboard/front-ui/context";
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

import { accessSections } from "./authentication-navigation.js";
import { settingsTabs, type SettingsTab } from "./authentication-settings-layout.js";
import { useAuthenticationSettings } from "./authentication-settings-query.js";
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
const Roles = lazy(() => import("./app/(protected)/identity/[lang]/roles/page.js"));
const Permissions = lazy(() => import("./app/(protected)/identity/[lang]/scopes/page.js"));
const Fields = lazy(() => import("./app/(protected)/identity/[lang]/user-attributes/page.js"));
const AccessKeys = lazy(() => import("./components/app/AccessKeyPageContent.js"));

const accessPanels: Record<(typeof accessSections)[number], ComponentType> = {
	roles: Roles,
	permissions: Permissions,
	apps: Apps,
};

function isSettingsTab(tab: string): tab is SettingsTab {
	return (settingsTabs as readonly string[]).includes(tab);
}

function useSavedSetting(key: string) {
	return useAuthenticationSettings().query.data?.values[key];
}

function AccessPanels({ section }: { section: string | null }) {
	return accessSections.map((name) => {
		const AccessPanel = accessPanels[name];
		return (
			<AuthenticationSection key={name} name={name} open={section === name}>
				<IdentityPanel>
					<AccessPanel />
				</IdentityPanel>
			</AuthenticationSection>
		);
	});
}

function WhenEnabled({ setting, children }: { setting: string; children: ReactNode }) {
	return useSavedSetting(setting) === false ? null : children;
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
	if (moved || !isSettingsTab(selected)) return <p role="status">{i18n._("loading")}</p>;
	return (
		<AuthenticationTabs view="settings" selected={selected} select={select}>
			<AuthenticationSettingsPage
				tab={selected}
				onInvalidField={(tab) => {
					select(tab);
				}}
			/>
			{selected === "access" && <AccessPanels section={section} />}
			{selected === "fields" && (
				<WhenEnabled setting="ENABLE_USER_ATTRIBUTE">
					<IdentityPanel>
						<Fields />
					</IdentityPanel>
				</WhenEnabled>
			)}
			<AuthenticationEditor view="settings" />
		</AuthenticationTabs>
	);
}
