import { lazy } from "react";

import AuthenticationEditor from "./AuthenticationEditor.js";
import {
	AuthenticationTabs,
	useAuthenticationI18n,
	useAuthenticationTab,
} from "./AuthenticationTabs.js";
import IdentityPanel from "./IdentityPanel.js";

const Accounts = lazy(() => import("./components/app/ApplicationUsersPage.js"));
const DevicesAndProfiles = lazy(() =>
	import("./components/app/AppAudiencePages.js").then((module) => ({
		default: module.CustomersAnalyticsPage,
	})),
);
const Referrals = lazy(() =>
	import("./components/app/AppAudiencePages.js").then((module) => ({
		default: module.ReferralsAnalyticsPage,
	})),
);
const Directory = lazy(() => import("./app/(protected)/identity/[lang]/users/page.js"));
const Activity = lazy(() => import("./app/(protected)/identity/[lang]/logs/page.js"));

export default function UsersPage() {
	const i18n = useAuthenticationI18n();
	const { moved, selected, select } = useAuthenticationTab("users");
	if (moved) return <p role="status">{i18n._("loading")}</p>;
	return (
		<AuthenticationTabs view="users" selected={selected} select={select}>
			{selected === "users" && <Accounts />}
			{selected === "directory" && (
				<IdentityPanel>
					<Directory />
				</IdentityPanel>
			)}
			{selected === "devices" && <DevicesAndProfiles />}
			{selected === "referrals" && <Referrals />}
			{selected === "activity" && (
				<>
					<p className="text-sm text-kumo-subtle">{i18n._("activityDescription")}</p>
					<IdentityPanel>
						<Activity />
					</IdentityPanel>
				</>
			)}
			<AuthenticationEditor view="users" />
		</AuthenticationTabs>
	);
}
