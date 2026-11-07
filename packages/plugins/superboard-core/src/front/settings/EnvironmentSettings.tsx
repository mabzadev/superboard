"use client";

import { deploymentI18n } from "@superboard/front-ui/deployment-i18n.js";
import { useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { useEffect } from "react";

import GeneralSection from "./components/settings/GeneralSection.js";
import ProjectAdvancedSection from "./components/settings/ProjectAdvancedSection.js";
import TeamMebersSection from "./components/settings/TeamMebersSection.js";
import UsageSection from "./components/settings/UsageSection.js";
import { useSettingsI18n } from "./i18n.js";
import { useTabParam } from "./lib/useTabParam.js";

export const environmentSettingsTabs = ["general", "team", "usage", "advanced"] as const;
const SERVICE_HEALTH_PATH = "/core/infrastructure";
export type EnvironmentSettingsTab = (typeof environmentSettingsTabs)[number];

export default function EnvironmentSettings() {
	const { locale, t } = useSettingsI18n();
	const title = deploymentI18n(locale)("title");
	const [tab, selectTab] = useTabParam(environmentSettingsTabs, { initialTab: "general" });
	const router = useRouter();
	const moved = useSearchParams().get("tab") === "infrastructure";
	useEffect(() => {
		if (!moved || !globalThis.location) return;
		const url = new URL(globalThis.location.href);
		url.pathname = SERVICE_HEALTH_PATH;
		url.searchParams.delete("tab");
		router.replace(`${url.pathname}${url.search}`);
	}, [moved, router]);

	if (moved) return <p role="status">{t("environment.moved")}</p>;

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
				<TabsContent value="advanced">
					<ProjectAdvancedSection />
				</TabsContent>
			</Tabs>
		</div>
	);
}
