const retiredAnalyticsPages = /^\/(?:dashboard|analytics\/dashboards)\/?$/u;
const retiredMembersPage = /^\/app\/members\/?$/u;

export function retiredFrontPageDestination(path: string): string | null {
	if (retiredAnalyticsPages.test(path)) return "/analytics";
	return retiredMembersPage.test(path) ? "/app/users" : null;
}
