"use client";

import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";

import { useSettingsI18n } from "../../i18n.js";
import { useTabParam } from "../../lib/useTabParam.js";
import LibrariesPageContent from "./LibrariesPageContent.js";
import SdkSetupWizard from "./SdkSetupWizard.js";

const SDK_APPS_PATH = "/core/libraries";
export const sdkAppsTabs = ["libraries", "web", "ios", "android"] as const;
export type SdkAppsTab = (typeof sdkAppsTabs)[number];

/**
 * Environment settings › SDK & apps (`/core/libraries`). The legacy setup
 * routes render this workspace too; they only choose the initial tab.
 */
export default function SdkAppsWorkspace({ tab: routeTab = "libraries" }: { tab?: SdkAppsTab }) {
	const { t } = useSettingsI18n();
	const [tab, selectTab] = useTabParam(sdkAppsTabs, { initialTab: routeTab, path: SDK_APPS_PATH });

	return (
		<div className="ds-page space-y-5">
			<header className="ds-page-header">
				<div>
					<h1 className="ds-page-title">{t("sdk.title")}</h1>
					<p className="ds-page-description">{t("sdk.description")}</p>
				</div>
			</header>
			<SectionNavigation />
			<Tabs value={tab} onValueChange={selectTab}>
				<TabsList aria-label={t("sdk.sections")} className="h-auto flex-wrap">
					{sdkAppsTabs.map((value) => (
						<TabsTrigger key={value} value={value}>
							{t(`sdk.${value}`)}
						</TabsTrigger>
					))}
				</TabsList>
				<TabsContent value="libraries" className="pt-2">
					<LibrariesPageContent />
				</TabsContent>
				{(["web", "ios", "android"] as const).map((platform) => (
					<TabsContent key={platform} value={platform} className="pt-2">
						<SdkSetupWizard platform={platform} />
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
