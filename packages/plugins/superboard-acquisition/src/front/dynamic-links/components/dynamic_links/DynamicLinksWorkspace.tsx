"use client";

import { useOptionalFrontContext } from "@superboard/front-ui/context";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import { Alert, AlertDescription, AlertTitle } from "@superboard/front-ui/ui/alert.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { ArrowLeft, Globe2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AcquisitionPage, EmbeddedPage } from "../../../AcquisitionPage.js";
import { useFlowI18n } from "../../../flows/features/flows/i18n.js";
import { getDomains, getLinkStatistics } from "../../api/dynamic-links/dynamicLinksService.js";
import DynamicLinksAnalytics, { LinkMetricCards } from "./analytics/DynamicLinksAnalytics.js";
import { totalsFromStatistics, type MetricTotals } from "./analytics/linkAnalyticsSummary.js";
import CampaignsPageContent from "./campaigns/CampaignsPageContent.js";
import DomainPageContent from "./domain/DomainPageContent.js";
import LinksPageContent from "./links/LinksPageContent.js";
import RedirectRulesPageContent from "./redirect-rules/RedirectRulesPageContent.js";
import SocialPreviewPageContent from "./social-preview/SocialPreviewPageContent.js";
import TrackingPageContent from "./tracking/TrackingPageContent.js";

export const DYNAMIC_LINKS_PATH = "/acquisition/dynamic-links";

export const dynamicLinksTabs = ["links", "campaigns", "analytics", "settings"] as const;
export type DynamicLinksTab = (typeof dynamicLinksTabs)[number];
export const dynamicLinksSettingsSections = ["domain", "routing", "preview", "tracking"] as const;
export type DynamicLinksSettingsSection = (typeof dynamicLinksSettingsSections)[number];

const tabLabels: Record<DynamicLinksTab, string> = {
	links: "Links",
	campaigns: "Campaigns",
	analytics: "Analytics",
	settings: "Settings",
};
const sectionLabels: Record<DynamicLinksSettingsSection, string> = {
	domain: "Domain",
	routing: "Redirect rules",
	preview: "Social preview",
	tracking: "Tracking",
};

function oneOf<T extends string>(values: readonly T[], value: string | null | undefined) {
	return values.find((item) => item === value);
}

/** Canonical workspace URL; the operator language is preserved across tabs. */
export function dynamicLinksHref(tab: DynamicLinksTab, section?: DynamicLinksSettingsSection) {
	const params = new URLSearchParams();
	const lang = new URLSearchParams(globalThis.location?.search ?? "").get("lang");
	if (lang) params.set("lang", lang);
	if (tab !== "links") params.set("tab", tab);
	if (section) params.set("section", section);
	const query = params.toString();
	return query ? `${DYNAMIC_LINKS_PATH}?${query}` : DYNAMIC_LINKS_PATH;
}

/**
 * Acquisition › Dynamic links. Every Dynamic links route renders this
 * workspace; legacy sub-routes only choose the initial tab.
 */
export default function DynamicLinksWorkspace({
	tab: routeTab = "links",
	section: routeSection = "domain",
	campaignId,
}: {
	tab?: DynamicLinksTab;
	section?: DynamicLinksSettingsSection;
	campaignId?: string;
}) {
	const { tr } = useFlowI18n();
	const router = useRouter();
	const search = useSearchParams();
	const tab: DynamicLinksTab = campaignId
		? "campaigns"
		: (oneOf(dynamicLinksTabs, search.get("tab")) ?? routeTab);
	const section = oneOf(dynamicLinksSettingsSections, search.get("section")) ?? routeSection;
	const open = (next: DynamicLinksTab, nextSection?: DynamicLinksSettingsSection) => {
		router.push(dynamicLinksHref(next, nextSection));
	};

	return (
		<AcquisitionPage
			title={tr("Dynamic links")}
			description={tr(
				"Create, route and measure links across every platform and acquisition source.",
			)}
		>
			<Tabs
				value={tab}
				onValueChange={(value) => {
					const next = oneOf(dynamicLinksTabs, value);
					if (next) open(next);
				}}
			>
				<TabsList aria-label={tr("Dynamic links sections")} className="h-auto flex-wrap">
					{dynamicLinksTabs.map((value) => (
						<TabsTrigger key={value} value={value}>
							{tr(tabLabels[value])}
						</TabsTrigger>
					))}
				</TabsList>
				<EmbeddedPage>
					<TabsContent value="links" className="space-y-4 pt-2">
						{search.get("item") ? null : (
							<DomainNotice
								onConfigure={() => {
									open("settings", "domain");
								}}
							/>
						)}
						<LinksPageContent />
					</TabsContent>
					<TabsContent value="campaigns" className="pt-2">
						{campaignId ? (
							<CampaignDetail
								campaignId={campaignId}
								onBack={() => {
									open("campaigns");
								}}
							/>
						) : (
							<CampaignsPageContent />
						)}
					</TabsContent>
					<TabsContent value="analytics" className="pt-2">
						<DynamicLinksAnalytics
							onCreateLink={() => {
								open("links");
							}}
						/>
					</TabsContent>
					<TabsContent value="settings" className="pt-2">
						<Tabs
							value={section}
							className="gap-4"
							onValueChange={(value) => {
								const next = oneOf(dynamicLinksSettingsSections, value);
								if (next) open("settings", next);
							}}
						>
							<TabsList aria-label={tr("Settings sections")} className="h-auto flex-wrap">
								{dynamicLinksSettingsSections.map((value) => (
									<TabsTrigger key={value} value={value}>
										{tr(sectionLabels[value])}
									</TabsTrigger>
								))}
							</TabsList>
							<TabsContent value="domain">
								<DomainPageContent />
							</TabsContent>
							<TabsContent value="routing">
								<RedirectRulesPageContent />
							</TabsContent>
							<TabsContent value="preview">
								<SocialPreviewPageContent />
							</TabsContent>
							<TabsContent value="tracking">
								<TrackingPageContent />
							</TabsContent>
						</Tabs>
					</TabsContent>
				</EmbeddedPage>
			</Tabs>
		</AcquisitionPage>
	);
}

/** Invites the operator to brand their links until a domain has been verified. */
function DomainNotice({ onConfigure }: { onConfigure: () => void }) {
	const { tr } = useFlowI18n();
	const { selectedProject } = useProjectSelection();
	const shortlinks = useOptionalFrontContext()?.publicEndpoints?.shortlinks;
	const [verified, setVerified] = useState<boolean | null>(null);

	useEffect(() => {
		if (!selectedProject) return;
		let current = true;
		getDomains(selectedProject.id).then(
			(domains) => {
				if (current) setVerified(domains.some((domain) => domain.status === "verified"));
			},
			() => {
				if (current) setVerified(null);
			},
		);
		return () => {
			current = false;
		};
	}, [selectedProject]);

	if (verified !== false) return null;
	return (
		<Alert>
			<Globe2 className="size-4" />
			<AlertTitle>{tr("No branded domain yet")}</AlertTitle>
			<AlertDescription className="flex flex-wrap items-center justify-between gap-3">
				<span>
					{shortlinks
						? `${tr("Links are served from the default short-link domain:")} ${new URL(shortlinks).host}`
						: tr("Links are served from the default short-link domain.")}
				</span>
				<Button size="sm" variant="outline" onClick={onConfigure}>
					{tr("Configure domain")}
				</Button>
			</AlertDescription>
		</Alert>
	);
}

function CampaignDetail({ campaignId, onBack }: { campaignId: string; onBack: () => void }) {
	const { tr } = useFlowI18n();
	const { selectedProject } = useProjectSelection();
	const search = useSearchParams();
	const [totals, setTotals] = useState<MetricTotals | null>(null);
	const itemOpen = Boolean(search.get("item"));

	useEffect(() => {
		if (!selectedProject) return;
		let current = true;
		getLinkStatistics(selectedProject.id, {
			campaign_id: campaignId,
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			interval: "day",
		}).then(
			(statistics) => {
				if (current) setTotals(totalsFromStatistics(statistics));
			},
			() => undefined,
		);
		return () => {
			current = false;
		};
	}, [campaignId, selectedProject]);

	return (
		<div className="space-y-4">
			{itemOpen ? null : (
				<>
					<Button variant="ghost" size="sm" onClick={onBack}>
						<ArrowLeft className="size-4" />
						{tr("Back to campaigns")}
					</Button>
					<LinkMetricCards totals={totals} loading={false} />
					{totals ? (
						<p className="text-xs text-muted-foreground">{tr("Results for the last 30 days.")}</p>
					) : null}
				</>
			)}
			<LinksPageContent campaignId={campaignId} />
		</div>
	);
}
