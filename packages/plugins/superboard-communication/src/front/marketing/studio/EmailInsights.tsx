import { Loader } from "@superboard/front-ui/kumo";
import {
	Table as FrontTable,
	TableBody as FrontTableBody,
	TableCell as FrontTableCell,
	TableHead as FrontTableHead,
	TableHeader as FrontTableHeader,
	TableRow as FrontTableRow,
} from "@superboard/front-ui/ui/table.js";
import { useEffect, useState } from "react";

import { useGrowthI18n } from "./growth-i18n.js";
import { getEmailInsights, type EmailInsightsData, type InsightFilters } from "./growth-service.js";

const rates = [
	["open_rate", "Open rate"],
	["click_rate", "Click rate"],
	["unsubscribe_rate", "Unsubscribe rate"],
	["bounce_rate", "Bounce rate"],
	["complaint_rate", "Complaint rate"],
] as const;

export function formatRevenue(cents: number, currency: string | null, locale: string) {
	const amount = cents / 100;
	return currency
		? new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount)
		: amount.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function definedFilters(filters: InsightFilters): InsightFilters {
	return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined));
}

/** Rates, attributed revenue and per-link clicks for an email, a campaign or the project. */
export function EmailInsights({
	project,
	filters,
	showSources = false,
}: {
	project: string;
	filters: InsightFilters;
	showSources?: boolean;
}) {
	const { t, locale } = useGrowthI18n();
	const { campaign_id, template_id, from, to } = filters;
	const key = JSON.stringify([project, campaign_id, template_id, from, to]);
	// Results are kept with the request they answer, so a filter change shows the loader.
	const [state, setState] = useState<{ key: string; data?: EmailInsightsData; failed?: boolean }>();
	useEffect(() => {
		let active = true;
		void getEmailInsights(project, definedFilters({ campaign_id, template_id, from, to })).then(
			(value) => {
				if (active) setState({ key, data: value });
			},
			() => {
				if (active) setState({ key, failed: true });
			},
		);
		return () => {
			active = false;
		};
	}, [key, project, campaign_id, template_id, from, to]);
	const current = state?.key === key ? state : undefined;
	if (current?.failed) return <p role="alert">{t("Loading failed")}</p>;
	const data = current?.data;
	if (!data) return <Loader />;
	const revenue = new Map<string, number>();
	for (const row of data.revenue)
		revenue.set(row.currency ?? "", (revenue.get(row.currency ?? "") ?? 0) + row.revenue_cents);
	return (
		<section className="space-y-4" aria-label={t("Engagement and revenue")}>
			<div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
				{rates.map(([metric, label]) => (
					<div key={metric} className="rounded-lg border border-kumo-line bg-kumo-base p-4">
						<p className="text-xs text-kumo-subtle">{t(label)}</p>
						<p className="mt-2 text-xl font-semibold tabular-nums">
							{data.engagement[metric].toLocaleString(locale)}%
						</p>
					</div>
				))}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-4">
					<p className="text-xs text-kumo-subtle">{t("Attributed revenue")}</p>
					<p className="mt-2 text-xl font-semibold tabular-nums">
						{revenue.size
							? [...revenue.entries()]
									.map(([currency, cents]) => formatRevenue(cents, currency || null, locale))
									.join(" · ")
							: "—"}
					</p>
				</div>
			</div>
			{showSources && data.revenue.length > 0 && (
				<div className="overflow-auto rounded-lg border border-kumo-line">
					<FrontTable className="w-full text-start text-sm">
						<FrontTableHeader className="bg-kumo-tint">
							<FrontTableRow>
								{["Source", "Purchases", "Attributed revenue"].map((label) => (
									<FrontTableHead key={label} className="p-3 text-start font-medium">
										{t(label)}
									</FrontTableHead>
								))}
							</FrontTableRow>
						</FrontTableHeader>
						<FrontTableBody>
							{data.revenue.map((row) => (
								<FrontTableRow
									key={row.source_type + row.source_id + (row.currency ?? "")}
									className="border-t border-kumo-line"
								>
									<FrontTableCell className="p-3">
										{row.name ?? row.source_id}{" "}
										<span className="text-xs text-kumo-subtle">
											· {t(row.source_type === "campaign" ? "Campaign" : "Automation")}
										</span>
									</FrontTableCell>
									<FrontTableCell>{row.conversions}</FrontTableCell>
									<FrontTableCell>
										{formatRevenue(row.revenue_cents, row.currency, locale)}
									</FrontTableCell>
								</FrontTableRow>
							))}
						</FrontTableBody>
					</FrontTable>
				</div>
			)}
			<div className="overflow-auto rounded-lg border border-kumo-line">
				<FrontTable className="w-full text-start text-sm">
					<FrontTableHeader className="bg-kumo-tint">
						<FrontTableRow>
							{["Link", "Unique clicks", "Total clicks", "CTR"].map((label) => (
								<FrontTableHead key={label} className="p-3 text-start font-medium">
									{t(label)}
								</FrontTableHead>
							))}
						</FrontTableRow>
					</FrontTableHeader>
					<FrontTableBody>
						{data.links.map((link) => (
							<FrontTableRow key={link.url} className="border-t border-kumo-line">
								<FrontTableCell className="max-w-md truncate p-3" title={link.url}>
									{link.url}
								</FrontTableCell>
								<FrontTableCell>{link.unique_clicks}</FrontTableCell>
								<FrontTableCell>{link.total_clicks}</FrontTableCell>
								<FrontTableCell>{link.click_rate.toLocaleString(locale)}%</FrontTableCell>
							</FrontTableRow>
						))}
					</FrontTableBody>
				</FrontTable>
				{!data.links.length && (
					<p className="p-4 text-sm text-kumo-subtle">{t("No link clicks yet.")}</p>
				)}
			</div>
		</section>
	);
}
