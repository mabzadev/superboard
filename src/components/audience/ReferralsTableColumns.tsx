"use client";

import type { SortType } from "@/types";
import { Button } from "@/components/ui/button";
import { AccessorKeyColumnDef } from "@tanstack/react-table";
import { renderSortableHeader } from "./VisitorsTableColumns";
import { formatSlashDate } from "@/lib/dateUtils";
import { parseSecondsInDaysHoursMinutesSeconds } from "@/lib/utils";
import { numberFormatter } from "@/utils/numberFormatter";
import { formatCurrencyFromCents } from "@/utils/formatCurrency";

export const getReferralsTableColumns = (
  sort: SortType,
  setSort: React.Dispatch<React.SetStateAction<SortType>>
): AccessorKeyColumnDef<RefferalMetrics>[] => [
  {
    accessorKey: "id",
    header: () => <Button variant="ghost">Id</Button>,
    cell: ({ row }) => {
      return (
        <div>
          <p>
            {" "}
            {row.original.uuid.slice(0, 8) +
              "..." +
              row.original.uuid.slice(-6) || "-"}
          </p>
        </div>
      );
    },
  },
  {
    accessorKey: "sdk_identifier",
    header: () => <Button variant="ghost">SDK Identifier</Button>,
    cell: ({ row }) => {
      return (
        <div>
          <p className="truncate overflow-hidden text-ellipsis">
            {row.original.sdk_identifier || "-"}
          </p>
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
            {row.original.view_count
              ? numberFormatter.format(row.original.view_count)
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
            {row.original.open_count
              ? numberFormatter.format(row.original.open_count)
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
            {row.original.install_count
              ? numberFormatter.format(row.original.install_count)
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
            {row.original.reinstall_count
              ? numberFormatter.format(row.original.reinstall_count)
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
            {row.original.reactivations
              ? numberFormatter.format(row.original.reactivations)
              : "-"}
          </p>
        </div>
      );
    },
  },
  {
    accessorKey: "user_referred_count",
    header: () =>
      renderSortableHeader(
        "Invited users",
        "user_referred",
        setSort,
        sort,
        true
      ),
    cell: ({ row }) => {
      return (
        <div>
          <p>
            {row.original.user_referred_count
              ? numberFormatter.format(row.original.user_referred_count)
              : "-"}
          </p>
        </div>
      );
    },
  },
  {
    accessorKey: "time_spent",
    header: () =>
      renderSortableHeader("Time spent", "time_spent", setSort, sort, true),
    cell: ({ row }) => {
      return (
        <div>
          <p>
            {parseSecondsInDaysHoursMinutesSeconds(row.original.time_spent) ||
              "-"}
          </p>
        </div>
      );
    },
  },
  {
    accessorKey: "revenue",
    header: () => renderSortableHeader("Revenue", "revenue", setSort, sort),
    cell: ({ row }) => {
      return (
        <div>
          {row.original?.total_revenue
            ? formatCurrencyFromCents(row.original.total_revenue)
            : "-"}
        </div>
      );
    },
  },

  {
    accessorKey: "last_access",
    header: () =>
      renderSortableHeader("Last access", "updated_at", setSort, sort),
    cell: ({ row }) => {
      return (
        <div>
          <p>{formatSlashDate(row.original.updated_at)}</p>
        </div>
      );
    },
  },
];

export interface RefferalMetrics {
  id: string;
  uuid: string;
  date: string;
  view_count: number;
  open_count: number;
  install_count: number;
  reinstall_count: number;
  reactivations: number;
  sdk_identifier: string;
  referred: string;
  user_referred_count: number;
  platform: string;
  time_spent: number;
  invited_by: string;
  updated_at: string;
  total_revenue?: number;
}
