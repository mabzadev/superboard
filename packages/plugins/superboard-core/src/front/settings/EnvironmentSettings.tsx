"use client";

import { deploymentI18n } from "@superboard/front-ui/deployment-i18n.js";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";

import GeneralSection from "./components/settings/GeneralSection.js";
import TeamMebersSection from "./components/settings/TeamMebersSection.js";
import UsageSection from "./components/settings/UsageSection.js";
import { useSettingsI18n } from "./i18n.js";
import InstanceConfiguration from "./InstanceConfiguration.js";
import { useTabParam } from "./lib/useTabParam.js";

export const environmentSettingsTabs = ["general", "team", "usage", "infrastructure"] as const;
export type EnvironmentSettingsTab = (typeof environmentSettingsTabs)[number];

/** Environment settings (`/core/settings`): one page, its sections kept in `?tab=`. */
export default function EnvironmentSettings() {
	const { locale, t } = useSettingsI18n();
	const title = deploymentI18n(locale)("title");
	const [tab, selectTab] = useTabParam(environmentSettingsTabs, { initialTab: "general" });

	return (
		<div className="ds-page space-y-5">
			<header className="ds-page-header">
				<div>
					<h1 className="ds-page-title">{title}</h1>
					<p className="ds-page-description">{t("environment.description")}</p>
				</div>
			</header>
			<SectionNavigation />
			<Tabs value={tab} onValueChange={selectTab}>
				<TabsList aria-label={t("environment.sections")} className="h-auto flex-wrap">
					{environmentSettingsTabs.map((value) => (
						<TabsTrigger key={value} value={value}>
							{t(`tab.${value}`)}
						</TabsTrigger>
					))}
				</TabsList>
				<TabsContent value="general">
					<GeneralSection />
				</TabsContent>
				<TabsContent value="team" className="max-w-[800px] py-4">
					<TeamMebersSection />
				</TabsContent>
				<TabsContent value="usage">
					<UsageSection />
				</TabsContent>
				<TabsContent value="infrastructure">
					<InstanceConfiguration />
				</TabsContent>
			</Tabs>
		</div>
	);
}
