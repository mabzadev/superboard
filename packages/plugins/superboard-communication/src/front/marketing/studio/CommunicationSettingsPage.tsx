import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Button } from "@superboard/front-ui/kumo";
import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { PluginDiagnosticsLink } from "@superboard/front-ui/plugin-diagnostics-link";
import { SettingsActions, SettingsRow, SettingsSection } from "@superboard/front-ui/settings-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { useEffect, useState } from "react";

import { getSmtpSettings as getEmailSenders } from "../../email/api/email/emailService.js";
import { EmailAdministration } from "../../email/components/modules/EmailAdministration.js";
import { EmailApiKeys } from "../../email/components/modules/EmailDeveloperSettings.js";
import {
	getSmtpSettings as getMarketingSenders,
	migrateMarketingSenders,
	type SmtpSettings,
} from "../api/marketing/marketingService.js";
import { MarketingChannelsPage } from "../components/modules/MarketingJourneyPages.js";
import { BrandKitSettings, GrowthPreferences } from "./BrandKitSettings.js";
import { useStudioI18n } from "./i18n.js";
import { LanguageSettings, TranslationProviderSettings } from "./LanguageSettings.js";
import { AutosaveScope } from "./settings-autosave.js";
import { WebhookSettings } from "./WebhookSettings.js";
import { useWorkspaceTab } from "./workspace-navigation.js";

const sections = {
	senders: "Senders & domains",
	preferences: "Sending preferences",
	advanced: "Advanced",
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
				<TabsContent value="senders" className="pt-4">
					{tab === "senders" && project && (
						<AutosaveScope key={`senders:${project}`}>
							<div className="flex w-full flex-col gap-8">
								<EmailAdministration key={project} section="delivery" />
								<LegacyMarketingSenders key={`legacy:${project}`} project={project} />
							</div>
						</AutosaveScope>
					)}
				</TabsContent>
				<TabsContent value="preferences" className="pt-4">
					{tab === "preferences" && project && (
						<AutosaveScope key={`preferences:${project}`}>
							<div className="flex w-full flex-col gap-8">
								<BrandKitSettings key={`brand:${project}`} project={project} />
								<LanguageSettings key={project} project={project} />
								<GrowthPreferences key={`growth:${project}`} project={project} />
							</div>
						</AutosaveScope>
					)}
				</TabsContent>
				<TabsContent value="advanced" className="pt-4">
					{tab === "advanced" && project && (
						<AutosaveScope key={`advanced:${project}`}>
							<div className="flex w-full flex-col gap-8">
								<TranslationProviderSettings key={`translation:${project}`} project={project} />
								<EmailApiKeys key={`keys:${project}`} project={project} />
								<WebhookSettings key={`webhooks:${project}`} project={project} />
								<MarketingChannelsPage />
							</div>
						</AutosaveScope>
					)}
				</TabsContent>
			</Tabs>
			<PluginDiagnosticsLink locale={locale} />
		</section>
	);
}

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
			() => undefined,
		);
		return () => {
			active = false;
		};
	}, [project, version]);
	if (!legacy.length) return null;
	return (
		<div className="space-y-4">
			<SettingsSection
				title={t("Legacy campaign senders (read-only)")}
				description={t(
					"These senders were configured before sender identities moved to the Email service. Campaigns use them only while no sender identity exists above. Move them to manage everything in one place.",
				)}
			>
				{legacy.map((profile) => (
					<SettingsRow key={profile.id} className="space-y-0.5">
						<p className="text-sm font-medium">{profile.name}</p>
						<p className="text-xs text-kumo-subtle">
							{profile.from_email}
							{profile.host ? ` · ${profile.host}` : ""}
						</p>
					</SettingsRow>
				))}
			</SettingsSection>
			<p role="status" className="text-sm">
				{message}
			</p>
			<SettingsActions>
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
			</SettingsActions>
		</div>
	);
}
