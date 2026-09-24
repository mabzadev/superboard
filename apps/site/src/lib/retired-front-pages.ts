const retiredAnalyticsPages = /^\/(?:dashboard|analytics\/dashboards)\/?$/u;
const retiredMembersPage = /^\/app\/members\/?$/u;
const retiredIdentityOverview = /^\/identity\/([a-zA-Z-]+)\/dashboard\/?$/u;

export function retiredFrontPageDestination(path: string): string | null {
	const identity = retiredIdentityOverview.exec(path);
	if (identity) return `/identity/${identity[1]}/settings`;
	if (retiredAnalyticsPages.test(path)) return "/analytics";
	return retiredMembersPage.test(path) ? "/auth/users" : null;
}
