import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { PluginConfigurationTab } from "@superboard/front-ui/plugin-configuration-tab";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { useState } from "react";

import { EmailAdministration } from "../../email/components/modules/EmailAdministration.js";
import { MarketingChannelsPage } from "../components/modules/MarketingJourneyPages.js";
import { MarketingDeliveryPanel } from "../components/modules/MarketingPages.js";
import { EmailContacts } from "./EmailContacts.js";
import { useStudioI18n } from "./i18n.js";
import { LanguageSettings } from "./LanguageSettings.js";

const sections = {
	delivery: "Delivery settings",
	languages: "Languages",
	contacts: "Contacts",
	channels: "Channels",
	webhooks: "Marketing webhooks",
	email: "Transactional email",
	"email-webhooks": "Email webhooks",
	configuration: "Configuration",
};

export default function CommunicationSettingsPage({
	initialTab = "delivery",
}: { initialTab?: string } = {}) {
	const { t, locale } = useStudioI18n();
	const { selectedProject } = useProjectSelection();
	const [tab, setTab] = useState(() => {
		const requested =
			typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
		return requested && Object.hasOwn(sections, requested) ? requested : initialTab;
	});

	return (
		<section className="ds-page space-y-5">
			<header className="ds-page-header">
				<h1 className="ds-page-title">{t("Communication settings")}</h1>
			</header>
			<SectionNavigation />
			<Tabs
				value={tab}
				onValueChange={(value) => {
					setTab(value);
					const url = new URL(window.location.href);
					url.searchParams.set("tab", value);
					window.history.replaceState(null, "", url);
				}}
			>
				<TabsList aria-label={t("Settings sections")} className="h-auto flex-wrap">
					{Object.entries(sections).map(([value, label]) => (
						<TabsTrigger key={value} value={value}>
							{t(label)}
						</TabsTrigger>
					))}
				</TabsList>
				<TabsContent value="languages">
					{selectedProject && <LanguageSettings project={selectedProject.id} />}
				</TabsContent>
				<TabsContent value="contacts">
					{selectedProject && <EmailContacts project={selectedProject.id} />}
				</TabsContent>
				<TabsContent value="channels">
					<MarketingChannelsPage />
				</TabsContent>
				<TabsContent value="delivery">
					<MarketingDeliveryPanel key={selectedProject?.id} section="delivery" />
				</TabsContent>
				<TabsContent value="webhooks">
					<MarketingDeliveryPanel key={selectedProject?.id} section="webhooks" />
				</TabsContent>
				<TabsContent value="email">
					<EmailAdministration key={selectedProject?.id} section="delivery" />
				</TabsContent>
				<TabsContent value="email-webhooks">
					<EmailAdministration key={selectedProject?.id} section="webhooks" />
				</TabsContent>
				<TabsContent value="configuration">
					<PluginConfigurationTab locale={locale} />
				</TabsContent>
			</Tabs>
		</section>
	);
}
