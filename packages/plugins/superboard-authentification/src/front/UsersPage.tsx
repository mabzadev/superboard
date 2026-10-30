import { lazy } from "react";

import AuthenticationEditor from "./AuthenticationEditor.js";
import {
	AuthenticationTabs,
	useAuthenticationTab,
	AuthenticationSection,
} from "./AuthenticationTabs.js";
import IdentityPanel from "./IdentityPanel.js";

const Accounts = lazy(() => import("./components/app/ApplicationUsersPage.js"));
const Profiles = lazy(() =>
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
const tabs = ["accounts", "profiles", "devices", "referrals"] as const;

export default function UsersPage() {
	const { selected, select } = useAuthenticationTab(tabs, "accounts");
	return (
		<AuthenticationTabs view="users" tabs={tabs} selected={selected} select={select}>
			{selected === "accounts" && (
				<>
					<Accounts />
					<AuthenticationSection name="directory">
						<IdentityPanel>
							<Directory />
						</IdentityPanel>
					</AuthenticationSection>
				</>
			)}
			{(selected === "profiles" || selected === "devices") && (
				<Profiles key={selected} mode={selected} />
			)}
			{selected === "referrals" && <Referrals />}
			<AuthenticationEditor view="users" />
		</AuthenticationTabs>
	);
}
