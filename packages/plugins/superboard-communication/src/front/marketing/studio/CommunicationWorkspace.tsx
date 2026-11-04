import { useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import { SectionNavigationProvider } from "@superboard/front-ui/section-navigation.js";
import { useEffect } from "react";

import { MarketingJourneysPage } from "../components/modules/MarketingJourneyPages.js";
import { ActivityPage } from "./ActivityPage.js";
import { AudiencePage } from "./AudiencePage.js";
import CommunicationSettingsPage from "./CommunicationSettingsPage.js";
import EmailItemsPage, { type EmailFilter } from "./EmailItemsPage.js";
import { useStudioI18n } from "./i18n.js";
import InAppItemsPage from "./InAppItemsPage.js";
import { useWorkspaceTab, workspaceRedirect } from "./workspace-navigation.js";

export default function CommunicationWorkspace({
	initialTab = "emails",
	emailFilter = "all",
}: {
	initialTab?: string;
	emailFilter?: EmailFilter;
}) {
	const { t } = useStudioI18n();
	const router = useRouter();
	const redirect = workspaceRedirect(useSearchParams(), initialTab);
	const { section, tab } = useWorkspaceTab(initialTab);
	useEffect(() => {
		if (redirect) router.replace(redirect);
	}, [redirect, router]);
	if (redirect) return <p role="status">{t("Loading…")}</p>;
	return (
		// The site's local navigation repeats the sidebar's Communication entries.
		<SectionNavigationProvider value={null}>
			{section === "emails" && <EmailItemsPage defaultFilter={emailFilter} />}
			{section === "automations" && <MarketingJourneysPage />}
			{section === "in-app" && <InAppItemsPage />}
			{section === "audience" && <AudiencePage tab={tab} fallback={initialTab} />}
			{section === "activity" && <ActivityPage tab={tab} fallback={initialTab} />}
			{section === "settings" && <CommunicationSettingsPage tab={tab} fallback={initialTab} />}
		</SectionNavigationProvider>
	);
}
