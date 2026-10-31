import { SectionNavigationProvider } from "@superboard/front-ui/section-navigation.js";

import { MarketingJourneysPage } from "../components/modules/MarketingJourneyPages.js";
import { ActivityPage } from "./ActivityPage.js";
import { AudiencePage } from "./AudiencePage.js";
import CommunicationSettingsPage from "./CommunicationSettingsPage.js";
import EmailItemsPage, { type EmailFilter } from "./EmailItemsPage.js";
import InAppItemsPage from "./InAppItemsPage.js";
import { useWorkspaceTab, WorkspaceNavigation } from "./workspace-navigation.js";

/**
 * One Communication workspace behind every existing route. Each route only
 * chooses the tab that opens first; `?tab=` switches sections in place.
 */
export default function CommunicationWorkspace({
	initialTab = "emails",
	emailFilter = "all",
}: {
	initialTab?: string;
	emailFilter?: EmailFilter;
}) {
	const { section, tab } = useWorkspaceTab(initialTab);
	return (
		<SectionNavigationProvider value={<WorkspaceNavigation fallback={initialTab} />}>
			{section === "emails" && <EmailItemsPage defaultFilter={emailFilter} />}
			{section === "automations" && <MarketingJourneysPage />}
			{section === "in-app" && <InAppItemsPage />}
			{section === "audience" && <AudiencePage tab={tab} fallback={initialTab} />}
			{section === "activity" && <ActivityPage tab={tab} fallback={initialTab} />}
			{section === "settings" && <CommunicationSettingsPage tab={tab} fallback={initialTab} />}
		</SectionNavigationProvider>
	);
}
