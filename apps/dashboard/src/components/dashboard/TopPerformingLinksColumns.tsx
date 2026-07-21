"use client";

import { Button } from "../ui/button";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { cn, parseSecondsInDaysHoursMinutesSeconds } from "../../lib/utils";
import type { AccessorKeyColumnDef, Column } from "@tanstack/react-table";
import { formatCurrencyFromCents } from "@/utils/formatCurrency";
import { Badge } from "../ui/badge";
import { ThemedPlatformIconCell } from "../dynamic_links/links/LinksTableColumns";
import { QUICK_LINK } from "@/constants/OptionsConstants";
import { numberFormatter } from "@/utils/numberFormatter";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import type { DashboardLink } from "@/types";

const SortIcon = ({ column }: { column: Column<DashboardLink> }) => {
  const state = column.getIsSorted();
  if (state === "asc") return <ChevronUp className="h-4 w-4" />;
  if (state === "desc") return <ChevronDown className="h-4 w-4" />;
  return <ChevronsUpDown className="h-4 w-4" />;
};

const headerButtonClass = "font-medium text-foreground";

export const topPerformingLinksColumns: AccessorKeyColumnDef<DashboardLink>[] =
  [
    {
      accessorKey: "ads_platform",
      size: 50,
      maxSize: 50,
      header: () => <div className="w-[50px]"></div>,
      cell: ({ row }) => {
        const platform = row.original.ads_platform;
        return <ThemedPlatformIconCell platform={platform || QUICK_LINK} />;
      },
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <Button
          className={cn(headerButtonClass)}
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Title <SortIcon column={column} />
        </Button>
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span>{row.original.name}</span>
        </div>
      ),
    },
    {
      accessorKey: "views",
      header: ({ column }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex justify-center">
              <Button
                className={headerButtonClass}
                variant="ghost"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              >
                Views <SortIcon column={column} />
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>The number of times the link was opened in a web browser.</p>
          </TooltipContent>
        </Tooltip>
      ),
      cell: ({ row }) => (
        <div className="flex justify-center py-2 px-4">
          <p>
            {row.original.views
              ? numberFormatter.format(row.original.views)
              : "-"}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "opens",
      header: ({ column }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex justify-center">
              <Button
                className={headerButtonClass}
                variant="ghost"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              >
                Opens <SortIcon column={column} />
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              This represents the number of app opens that occurred from a grovs
              link.
            </p>
          </TooltipContent>
        </Tooltip>
      ),
      cell: ({ row }) => (
        <div className="flex justify-center py-2 px-4">
          <p>
            {row.original.opens
              ? numberFormatter.format(row.original.opens)
              : "-"}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "tags",
      header: ({ column }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex justify-center">
              <Button
                className={headerButtonClass}
                variant="ghost"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              >
                Tags <SortIcon column={column} />
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>Tags that were assigned when the link was created.</p>
          </TooltipContent>
        </Tooltip>
      ),
      cell: ({ row }) => (
        <div className="flex justify-center py-2 px-4">
          {row.original.tags.map((tag: string) => (
            <Badge
              key={tag}
              variant={"outline"}
              className="border-sidebar-border"
            >
              {tag}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      accessorKey: "installs",
      header: ({ column }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex justify-center">
              <Button
                className={headerButtonClass}
                variant="ghost"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              >
                Installs
                <SortIcon column={column} />
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>The number of app installations generated by the link.</p>
          </TooltipContent>
        </Tooltip>
      ),
      cell: ({ row }) => (
        <div className="flex justify-center py-2 px-4">
          <p>
            {row.original.installs
              ? numberFormatter.format(row.original.installs)
              : "-"}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "reinstalls",
      header: ({ column }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex justify-center">
              <Button
                className={headerButtonClass}
                variant="ghost"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              >
                Reinstalls
                <SortIcon column={column} />
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              The number of app reinstalls generated by the link. A reinstall
              occurs when the app is deleted and reinstalled on the same device.
            </p>
          </TooltipContent>
        </Tooltip>
      ),
      cell: ({ row }) => (
        <div className="flex justify-center py-2 px-4">
          <p>
            {row.original.reinstalls
              ? numberFormatter.format(row.original.reinstalls)
              : "-"}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "reactivations",
      header: ({ column }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex justify-center">
              <Button
                className={headerButtonClass}
                variant="ghost"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              >
                Reactivations
                <SortIcon column={column} />
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              The number of users who revisited the app after more than 7 days
              of inactivity due to a click on a link.
            </p>
          </TooltipContent>
        </Tooltip>
      ),
      cell: ({ row }) => (
        <div className="flex justify-center py-2 px-4">
          <p>
            {row.original.reactivations
              ? numberFormatter.format(row.original.reactivations)
              : "-"}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "time_spent",
      header: ({ column }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex justify-center">
              <Button
                className={headerButtonClass}
                variant="ghost"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              >
                Time spent
                <SortIcon column={column} />
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              Sum of the entire time spent in the app by all the users for this
              link.
            </p>
          </TooltipContent>
        </Tooltip>
      ),
      cell: ({ row }) => (
        <div className="flex justify-center py-2 px-4">
          <p>
            {parseSecondsInDaysHoursMinutesSeconds(row.original.time_spent) ||
              "-"}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "revenue",
      header: ({ column }) => (
        <div className="flex justify-center">
          <Button
            className={headerButtonClass}
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Revenue <SortIcon column={column} />
          </Button>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex justify-center py-2 px-4">
          <p>{formatCurrencyFromCents(row.original.revenue_cents)}</p>
        </div>
      ),
    },
  ];
