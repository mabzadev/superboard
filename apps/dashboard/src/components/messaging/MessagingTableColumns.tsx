"use client";

import type { Notification } from "@/types";
import type { SortType } from "@/types";
import { Button } from "@/components/ui/button";
import { AccessorKeyColumnDef } from "@tanstack/react-table";
import { formatSlashDate } from "@/lib/dateUtils";

import { Badge } from "../ui/badge";
import { formatPlatformName } from "@/lib/utils";

export const getMessagingTableColumns = (
  sort: SortType,
  setSort: React.Dispatch<React.SetStateAction<SortType>>
): AccessorKeyColumnDef<MessagingMetrics>[] => [
  {
    accessorKey: "title",
    header: () => renderSortableHeader("Title", "title", setSort, sort),
    cell: ({ row }) => {
      return (
        <div>
          <p>{row.original.title}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "subtitle",
    header: () => renderSortableHeader("Subtitle", "subtitle", setSort, sort),

    cell: ({ row }) => {
      return (
        <div>
          <p>{row.original.subtitle || "-"}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "platform",
    header: () => renderSortableHeader("Platform", "platform", setSort, sort),

    cell: ({ row }) => {
      return (
        <div className="flex gap-2">
          {row.original.target.platforms.map((item: string) => (
            <Badge variant={"outline"} key={item}>
              {formatPlatformName(item)}
            </Badge>
          ))}
        </div>
      );
    },
  },
  {
    accessorKey: "views",
    header: () => renderSortableHeader("Views", "read_count", setSort, sort),

    cell: ({ row }) => {
      return (
        <div>
          <p>{row.original.read_count || "-"}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "target",
    header: () => renderNormalHeader("Target"),
    cell: ({ row }) => {
      return (
        <div>
          {row.original.target.new_users && (
            <Badge variant={"outline"}>New users</Badge>
          )}
          {row.original.target.existing_users && (
            <Badge variant={"outline"}>Existing users</Badge>
          )}
        </div>
      );
    },
  },

  {
    accessorKey: "auto_display",
    header: () =>
      renderSortableHeader("Auto display", "auto_display", setSort, sort),
    cell: ({ row }) => {
      return (
        <div>
          <p>{row.original.auto_display ? "Yes" : "No"}</p>
        </div>
      );
    },
  },

  {
    accessorKey: "push_notification",
    header: () =>
      renderSortableHeader(
        "Push notification",
        "push_notification",
        setSort,
        sort
      ),
    cell: ({ row }) => {
      return (
        <div>
          <p>{row.original.send_push ? "Yes" : "No"}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "updated_at",
    header: () => renderSortableHeader("Date", "updated_at", setSort, sort),
    cell: ({ row }) => {
      return (
        <div>
          <p>
            {row.original.updated_at
              ? formatSlashDate(row.original.updated_at)
              : ""}
          </p>
        </div>
      );
    },
  },
];

export type MessagingMetrics = Notification;

export const renderSortableHeader = (
  label: string,
  sortKey: string,
  setSort: React.Dispatch<React.SetStateAction<SortType>>,
  _sort: SortType
) => (
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
    {/* {checkSortDirection(sortKey, sort)} */}
  </Button>
);

export const renderNormalHeader = (label: string) => (
  <Button variant="ghost">{label}</Button>
);
