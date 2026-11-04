"use client";

import { formatSlashDate } from "@superboard/front-ui/lib/dateUtils.js";
import type { SortType } from "@superboard/front-ui/types";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superboard/front-ui/ui/tooltip.js";
import { formatCurrencyFromCents } from "@superboard/front-ui/utils/formatCurrency.js";
import { numberFormatter } from "@superboard/front-ui/utils/numberFormatter.js";
import type { AccessorKeyColumnDef } from "@tanstack/react-table";

import type { CampaignAnalyticsRow } from "../../../api/dynamic-links/dynamicLinksService.js";
import { checkSortDirection } from "../links/LinksTableColumns.js";

const descriptions: Record<string, string> = {
	Views: "The number of times a campaign link was opened in a browser.",
	Opens: "The number of application opens attributed to campaign links.",
	Installs: "The number of first installs attributed to campaign links.",
	Reinstalls: "The number of reinstalls attributed to campaign links.",
	Reactivations: "The number of inactive customers brought back by the campaign.",
	"App opens": "Application open events attributed to the campaign.",
	"Users referred": "Customers referred or converted by campaign links.",
};

function sortableHeader(
	label: string,
	sortKey: string,
	sort: SortType,
	setSort: React.Dispatch<React.SetStateAction<SortType>>,
	tr: (english: string) => string,
	tooltip = false,
) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					onClick={() =>
						setSort((previous) => ({
							sortKey,
							ascending: previous.sortKey === sortKey ? !previous.ascending : true,
						}))
					}
				>
					{tr(label)}
					{checkSortDirection(sortKey, sort)}
				</Button>
			</TooltipTrigger>
			{tooltip ? (
				<TooltipContent className="max-w-xs">
					<p>{tr(descriptions[label] ?? "")}</p>
				</TooltipContent>
			) : null}
		</Tooltip>
	);
}

function metric(value: number) {
	return value ? numberFormatter.format(value) : "—";
}

export function createCampaignAnalyticsColumns(
	sort: SortType,
	setSort: React.Dispatch<React.SetStateAction<SortType>>,
	tr: (english: string) => string = (english) => english,
): AccessorKeyColumnDef<CampaignAnalyticsRow>[] {
	return [
		{
			accessorKey: "title",
			header: () => sortableHeader("Title", "name", sort, setSort, tr),
			cell: ({ row }) => (
				<div className="min-w-44">
					<p className="font-medium">{row.original.name}</p>
					<p className="text-xs text-muted-foreground">/{row.original.slug}</p>
				</div>
			),
		},
		{
			accessorKey: "views",
			header: () => sortableHeader("Views", "views", sort, setSort, tr, true),
			cell: ({ row }) => metric(row.original.total_views),
		},
		{
			accessorKey: "opens",
			header: () => sortableHeader("Opens", "opens", sort, setSort, tr, true),
			cell: ({ row }) => metric(row.original.total_opens),
		},
		{
			accessorKey: "installs",
			header: () => sortableHeader("Installs", "installs", sort, setSort, tr, true),
			cell: ({ row }) => metric(row.original.total_installs),
		},
		{
			accessorKey: "reinstalls",
			header: () => sortableHeader("Reinstalls", "reinstalls", sort, setSort, tr, true),
			cell: ({ row }) => metric(row.original.total_reinstalls),
		},
		{
			accessorKey: "reactivations",
			header: () => sortableHeader("Reactivations", "reactivations", sort, setSort, tr, true),
			cell: ({ row }) => metric(row.original.total_reactivations),
		},
		{
			accessorKey: "app_opens",
			header: () => sortableHeader("App opens", "app_opens", sort, setSort, tr, true),
			cell: ({ row }) => metric(row.original.total_app_opens),
		},
		{
			accessorKey: "user_referred",
			header: () => sortableHeader("Users referred", "user_referred", sort, setSort, tr, true),
			cell: ({ row }) => metric(row.original.total_user_referred),
		},
		{
			accessorKey: "revenue",
			header: () => sortableHeader("Revenue", "revenue", sort, setSort, tr),
			cell: ({ row }) =>
				row.original.total_revenue ? formatCurrencyFromCents(row.original.total_revenue) : "—",
		},
		{
			accessorKey: "date",
			header: () => sortableHeader("Date", "created_at", sort, setSort, tr),
			cell: ({ row }) => formatSlashDate(row.original.created_at),
		},
	];
}
