import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Button } from "@superboard/front-ui/kumo";
import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { PluginDiagnosticsLink } from "@superboard/front-ui/plugin-diagnostics-link";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { useEffect, useState } from "react";

import { getSmtpSettings as getEmailSenders } from "../../email/api/email/emailService.js";
import { EmailAdministration } from "../../email/components/modules/EmailAdministration.js";
import {
	getSmtpSettings as getMarketingSenders,
	migrateMarketingSenders,
	type SmtpSettings,
} from "../api/marketing/marketingService.js";
import { MarketingChannelsPage } from "../components/modules/MarketingJourneyPages.js";
import { BrandKitSettings, GrowthPreferences } from "./BrandKitSettings.js";
import { useStudioI18n } from "./i18n.js";
import { LanguageSettings } from "./LanguageSettings.js";
import { ProviderWebhooks } from "./ProviderWebhooks.js";
import { useWorkspaceTab } from "./workspace-navigation.js";

const sections = {
	senders: "Senders & domains",
	preferences: "Sending preferences",
};

export default function CommunicationSettingsPage({
	tab = "senders",
	fallback = "senders",
}: {
	tab?: string;
	fallback?: string;
}) {
	const { t, locale } = useStudioI18n();
	const { selectedProject } = useProjectSelection();
	const { open } = useWorkspaceTab(fallback);
	const project = selectedProject?.id;
	return (
		<section className="ds-page space-y-5">
			<header className="ds-page-header">
				<div>
					<h1 className="ds-page-title">{t("Communication settings")}</h1>
					<p className="ds-page-description">
						{t("Who your messages come from, and how and when they are sent.")}
					</p>
				</div>
			</header>
			<SectionNavigation />
			<Tabs
				value={tab}
				onValueChange={(value) => {
					open(String(value)).catch(() => undefined);
				}}
			>
				<TabsList aria-label={t("Settings sections")} className="h-auto flex-wrap">
					{Object.entries(sections).map(([value, label]) => (
						<TabsTrigger key={value} value={value}>
							{t(label)}
						</TabsTrigger>
					))}
				</TabsList>
				<TabsContent value="senders">
					{tab === "senders" && project && (
						<div className="space-y-8">
							<EmailAdministration key={project} section="delivery" />
							<LegacyMarketingSenders key={`legacy:${project}`} project={project} />
							<MarketingChannelsPage />
						</div>
					)}
				</TabsContent>
				<TabsContent value="preferences">
					{tab === "preferences" && project && (
						<div className="space-y-6">
							<BrandKitSettings key={`brand:${project}`} project={project} />
							<LanguageSettings key={project} project={project} />
							<GrowthPreferences key={`growth:${project}`} project={project} />
							<ProviderWebhooks key={`webhooks:${project}`} project={project} />
						</div>
					)}
				</TabsContent>
			</Tabs>
			<PluginDiagnosticsLink locale={locale} />
		</section>
	);
}

/**
 * Sender identities moved from Marketing to the Email Worker (migration 0012).
 * Profiles still stored only in Marketing are shown read-only until they are moved.
 */
function LegacyMarketingSenders({ project }: { project: string }) {
	const { t, locale } = useStudioI18n();
	const [legacy, setLegacy] = useState<SmtpSettings[]>([]);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const [version, setVersion] = useState(0);
	useEffect(() => {
		let active = true;
		void Promise.all([getMarketingSenders(project), getEmailSenders(project)]).then(
			([marketing, email]) => {
				if (!active) return;
				const owned = new Set(
					(email.profiles ?? (email.id ? [email] : [])).map((profile) => profile.id),
				);
				setLegacy(
					(marketing.profiles ?? (marketing.id ? [marketing] : [])).filter(
						(profile) => profile.id && !owned.has(profile.id),
					),
				);
			},
			// Without both lists nothing can be called legacy safely.
			() => undefined,
		);
		return () => {
			active = false;
		};
	}, [project, version]);
	if (!legacy.length) return null;
	return (
		<section className="space-y-3 rounded-lg border border-kumo-line bg-kumo-tint p-5">
			<div>
				<h2 className="text-lg font-semibold">{t("Legacy campaign senders (read-only)")}</h2>
				<p className="text-sm text-kumo-subtle">
					{t(
						"These senders were configured before sender identities moved to the Email service. Campaigns use them only while no sender identity exists above. Move them to manage everything in one place.",
					)}
				</p>
			</div>
			<ul className="space-y-1 text-sm">
				{legacy.map((profile) => (
					<li key={profile.id}>
						<span className="font-medium">{profile.name}</span> · {profile.from_email}
						{profile.host ? ` · ${profile.host}` : ""}
					</li>
				))}
			</ul>
			<p role="status" className="text-sm">
				{message}
			</p>
			<Button
				loading={busy}
				onClick={() => {
					setBusy(true);
					setMessage("");
					(async () => {
						try {
							let cursor = "";
							for (let page = 0; page < 100; page++) {
								const result = await migrateMarketingSenders(project, cursor);
								if (result.complete) break;
								cursor = result.next_cursor ?? "";
							}
							setMessage(t("Senders moved to the Email service"));
							setVersion((value) => value + 1);
						} catch (cause) {
							setMessage(moduleErrorMessage(cause, locale));
						} finally {
							setBusy(false);
						}
					})().catch(() => undefined);
				}}
			>
				{t("Move to the Email service")}
			</Button>
		</section>
	);
}
