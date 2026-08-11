"use client";

import type { AccessorKeyColumnDef } from "@tanstack/react-table";
import type { SortType } from "@/types";
import type { CampaignAnalyticsRow } from "@/api/dynamic-links/dynamicLinksService";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { checkSortDirection } from "../links/LinksTableColumns";
import { formatSlashDate } from "@/lib/dateUtils";
import { formatCurrencyFromCents } from "@/utils/formatCurrency";
import { numberFormatter } from "@/utils/numberFormatter";

const descriptions: Record<string, string> = {
  Views: "The number of times a campaign link was opened in a browser.",
  Opens: "The number of application opens attributed to campaign links.",
  Installs: "The number of first installs attributed to campaign links.",
  Reinstalls: "The number of reinstalls attributed to campaign links.",
  Reactivations: "The number of inactive customers brought back by the campaign.",
  "App opens": "Application open events attributed to the campaign.",
  "Users Referred": "Customers referred or converted by campaign links.",
};

function sortableHeader(
  label: string,
  sortKey: string,
  sort: SortType,
  setSort: React.Dispatch<React.SetStateAction<SortType>>,
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
              ascending:
                previous.sortKey === sortKey ? !previous.ascending : true,
            }))
          }
        >
          {label}
          {checkSortDirection(sortKey, sort)}
        </Button>
      </TooltipTrigger>
      {tooltip ? (
        <TooltipContent className="max-w-xs">
          <p>{descriptions[label]}</p>
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
): AccessorKeyColumnDef<CampaignAnalyticsRow>[] {
  return [
    {
      accessorKey: "title",
      header: () => sortableHeader("Title", "name", sort, setSort),
      cell: ({ row }) => (
        <div className="min-w-44">
          <p className="font-medium">{row.original.name}</p>
          <p className="text-xs text-muted-foreground">/{row.original.slug}</p>
        </div>
      ),
    },
    {
      accessorKey: "views",
      header: () => sortableHeader("Views", "views", sort, setSort, true),
      cell: ({ row }) => metric(row.original.total_views),
    },
    {
      accessorKey: "opens",
      header: () => sortableHeader("Opens", "opens", sort, setSort, true),
      cell: ({ row }) => metric(row.original.total_opens),
    },
    {
      accessorKey: "installs",
      header: () =>
        sortableHeader("Installs", "installs", sort, setSort, true),
      cell: ({ row }) => metric(row.original.total_installs),
    },
    {
      accessorKey: "reinstalls",
      header: () =>
        sortableHeader("Reinstalls", "reinstalls", sort, setSort, true),
      cell: ({ row }) => metric(row.original.total_reinstalls),
    },
    {
      accessorKey: "reactivations",
      header: () =>
        sortableHeader(
          "Reactivations",
          "reactivations",
          sort,
          setSort,
          true,
        ),
      cell: ({ row }) => metric(row.original.total_reactivations),
    },
    {
      accessorKey: "app_opens",
      header: () =>
        sortableHeader("App opens", "app_opens", sort, setSort, true),
      cell: ({ row }) => metric(row.original.total_app_opens),
    },
    {
      accessorKey: "user_referred",
      header: () =>
        sortableHeader(
          "Users Referred",
          "user_referred",
          sort,
          setSort,
          true,
        ),
      cell: ({ row }) => metric(row.original.total_user_referred),
    },
    {
      accessorKey: "revenue",
      header: () => sortableHeader("Revenue", "revenue", sort, setSort),
      cell: ({ row }) =>
        row.original.total_revenue
          ? formatCurrencyFromCents(row.original.total_revenue)
          : "—",
    },
    {
      accessorKey: "date",
      header: () => sortableHeader("Date", "created_at", sort, setSort),
      cell: ({ row }) => formatSlashDate(row.original.created_at),
    },
  ];
}
