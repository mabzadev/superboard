import { useFrontContext } from "@superboard/front-ui/context";
import { PluginConfigurationTab } from "@superboard/front-ui/plugin-configuration-tab";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { useState } from "react";

import { DataSettingsForm } from "./DataSettingsForm.js";

const messages = {
	en: {
		title: "Data Settings",
		description: "Manage content and file settings, and inspect service configuration and health.",
		configuration: "Configuration",
		sections: "Settings sections",
		content: "Content",
		files: "Files",
	},
	fr: {
		title: "Paramètres Data",
		description:
			"Gérez les paramètres des contenus et fichiers, puis consultez la configuration et la santé des services.",
		configuration: "Configuration",
		sections: "Sections des paramètres",
		content: "Contenus",
		files: "Fichiers",
	},
};

export default function DataSettingsPage() {
	const { locale } = useFrontContext();
	const t = messages[locale === "fr" ? "fr" : "en"];
	const [tab, setTab] = useState(() => {
		if (typeof window === "undefined") return "content";
		const requested = new URLSearchParams(window.location.search).get("tab");
		return requested && ["content", "files", "configuration"].includes(requested)
			? requested
			: "content";
	});
	return (
		<section className="ds-page space-y-5">
			<header className="ds-page-header">
				<div>
					<h1 className="ds-page-title">{t.title}</h1>
					<p className="ds-page-description">{t.description}</p>
				</div>
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
				<TabsList aria-label={t.sections}>
					<TabsTrigger value="content">{t.content}</TabsTrigger>
					<TabsTrigger value="files">{t.files}</TabsTrigger>
					<TabsTrigger value="configuration">{t.configuration}</TabsTrigger>
				</TabsList>
				<TabsContent value="content" forceMount hidden={tab !== "content"}>
					<DataSettingsForm section="content" locale={locale === "fr" ? "fr" : "en"} />
				</TabsContent>
				<TabsContent value="files" forceMount hidden={tab !== "files"}>
					<DataSettingsForm section="files" locale={locale === "fr" ? "fr" : "en"} />
				</TabsContent>
				<TabsContent value="configuration">
					<PluginConfigurationTab locale={locale} />
				</TabsContent>
			</Tabs>
		</section>
	);
}
