"use client";

import type { Campaign } from "@/types";
import { Button } from "@/components/ui/button";
import { AccessorKeyColumnDef } from "@tanstack/react-table";
import { formatSlashDate } from "@/lib/dateUtils";
import { checkSortDirection } from "../links/LinksTableColumns";
import type { SortType } from "@/types";
import { numberFormatter } from "@/utils/numberFormatter";
import { formatCurrencyFromCents } from "@/utils/formatCurrency";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IS_ENTERPRISE } from "@/lib/edition";

const renderToolTipContent = (key: string) => {
  let text = "";

  switch (key) {
    case "Views":
      text = "Indicates the number of times the campaign links were accessed.";
      break;
    case "Opens":
      text =
        "Represents the number of times the mobile apps were launched from campaign links.";
      break;
    case "Installs":
      text =
        "Indicates the number of app installations resulting from campaign links.";
      break;
    case "Reinstalls":
      text =
        "Indicates the number of app reinstallations resulting from campaign links.";
      break;
    case "Reactivations":
      text =
        "Indicates the number of app reactivations resulting from campaign links.";
      break;
    case "Users Referred":
      text =
        "Represents the total number of users who installed your app as a direct result of this campaign’s referrals.";
      break;
    default:
      break;
  }

  return (
    <TooltipContent>
      <p>{text}</p>
    </TooltipContent>
  );
};
export const createCampaignsTableColumns = (
  sort: SortType,
  setSort: React.Dispatch<React.SetStateAction<SortType>>,
  _handleGoToCampaign?: (id: string) => void
): AccessorKeyColumnDef<Campaign>[] => [
  {
    accessorKey: "title",
    header: () => renderSortableHeader("Title", "name", setSort, sort),
    cell: ({ row }) => {
      return (
        <div>
          <p>{row.original.name}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "views",
    header: () => renderSortableHeader("Views", "views", setSort, sort, true),

    cell: ({ row }) => {
      return (
        <div>
          <p>
            {row.original.total_views
              ? numberFormatter.format(row.original.total_views)
              : "-"}
          </p>
        </div>
      );
    },
  },
  {
    accessorKey: "opens",
    header: () =>
      renderSortableHeader("Opens", "app_opens", setSort, sort, true),

    cell: ({ row }) => {
      return (
        <div>
          <p>
            {row.original.total_opens
              ? numberFormatter.format(row.original.total_opens)
              : "-"}
          </p>
        </div>
      );
    },
  },
  {
    accessorKey: "installs",
    header: () =>
      renderSortableHeader("Installs", "installs", setSort, sort, true),

    cell: ({ row }) => {
      return (
        <div>
          <p>
            {row.original.total_installs
              ? numberFormatter.format(row.original.total_installs)
              : "-"}
          </p>
        </div>
      );
    },
  },
  {
    accessorKey: "reinstalls",
    header: () =>
      renderSortableHeader("Reinstalls", "reinstalls", setSort, sort, true),
    cell: ({ row }) => {
      return (
        <div>
          <p>
            {row.original.total_reinstalls
              ? numberFormatter.format(row.original.total_reinstalls)
              : "-"}
          </p>
        </div>
      );
    },
  },
  {
    accessorKey: "reactivations",
    header: () =>
      renderSortableHeader(
        "Reactivations",
        "reactivations",
        setSort,
        sort,
        true
      ),
    cell: ({ row }) => {
      return (
        <div>
          <p>
            {row.original.total_reactivations
              ? numberFormatter.format(row.original.total_reactivations)
              : "-"}
          </p>
        </div>
      );
    },
  },
  {
    accessorKey: "app_opens",
    header: () =>
      renderSortableHeader("App opens", "app_opens", setSort, sort, true),
    cell: ({ row }) => {
      return (
        <div>
          <p>
            {row.original.total_app_opens
              ? numberFormatter.format(row.original.total_app_opens)
              : "-"}
          </p>
        </div>
      );
    },
  },
  {
    accessorKey: "user_referred",
    header: () =>
      renderSortableHeader(
        "Users Referred",
        "user_referred",
        setSort,
        sort,
        true
      ),
    cell: ({ row }) => {
      return (
        <div>
          <p>
            {row.original.total_user_referred
              ? numberFormatter.format(row.original.total_user_referred)
              : "-"}
          </p>
        </div>
      );
    },
  },
  ...(IS_ENTERPRISE
    ? [
        {
          accessorKey: "revenue",
          header: () =>
            renderSortableHeader("Revenue", "revenue", setSort, sort),
          cell: ({ row }: { row: { original: Campaign } }) => {
            return (
              <div>
                <p>
                  {row.original.total_revenue
                    ? formatCurrencyFromCents(row.original.total_revenue)
                    : "-"}
                </p>
              </div>
            );
          },
        } satisfies AccessorKeyColumnDef<Campaign>,
      ]
    : []),
  {
    accessorKey: "date",
    header: () => renderSortableHeader("Date", "created_at", setSort, sort),
    cell: ({ row }) => {
      return (
        <div>
          <p>{formatSlashDate(row.original.created_at)}</p>
        </div>
      );
    },
  },
];

export type { Campaign } from "@/types";

export const renderSortableHeader = (
  label: string,
  sortKey: string,
  setSort: React.Dispatch<React.SetStateAction<SortType>>,
  sort: SortType,
  tooltip?: boolean
) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        onClick={() =>
          setSort((prev) => ({
            sortKey,
            ascending: prev.sortKey === sortKey ? !prev.ascending : true,
          }))
        }
      >
        {label}
        {checkSortDirection(sortKey, sort)}
      </Button>
    </TooltipTrigger>
    {tooltip && renderToolTipContent(label)}
  </Tooltip>
);
