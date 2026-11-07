const retiredAnalyticsPages = /^\/(?:dashboard|analytics\/dashboards)\/?$/u;
const retiredMembersPage = /^\/app\/members\/?$/u;
const retiredDataSettingsPage = /^\/data\/settings\/?$/u;
const retiredIdentityOverview = /^\/identity\/([a-zA-Z-]+)\/dashboard\/?$/u;
const retiredOrganizationsPage = /^\/auth\/orgs\/?$/u;
const retiredSamlPage = /^\/auth\/saml\/?$/u;

export function retiredFrontPageDestination(path: string): string | null {
	const identity = retiredIdentityOverview.exec(path);
	if (identity) return `/identity/${identity[1]}/settings`;
	if (retiredAnalyticsPages.test(path)) return "/analytics";
	if (retiredDataSettingsPage.test(path)) return "/data/content";
	if (retiredOrganizationsPage.test(path)) return "/auth/settings?tab=access";
	if (retiredSamlPage.test(path)) return "/auth/settings?tab=sign-in";
	return retiredMembersPage.test(path) ? "/auth/users" : null;
}
