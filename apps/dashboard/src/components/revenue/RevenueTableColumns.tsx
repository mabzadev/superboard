"use client";

import type { SortType } from "@/types";
import { Button } from "@/components/ui/button";
import { AccessorKeyColumnDef } from "@tanstack/react-table";
import { checkSortDirection } from "../dynamic_links/links/LinksTableColumns";
import { Badge } from "../ui/badge";
import { formatPlatformName } from "@/lib/utils";

export const getRevenueTableColumns = (
  sort: SortType,
  setSort: React.Dispatch<React.SetStateAction<SortType>>
): AccessorKeyColumnDef<RevenueMetrics>[] => [
  {
    accessorKey: "product",
    header: () => renderSortableHeader("Product", "product_id", setSort, sort),
    cell: ({ row }) => {
      return (
        <div>
          <p>{row.original.product}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "platform",
    header: () => renderSortableHeader("Platform", "platforms", setSort, sort),
    cell: ({ row }) => {
      let platforms: string[] = [];
      try {
        const raw = row.original.platforms;
        platforms = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        const raw = row.original.platforms;
        platforms = typeof raw === "string" ? [raw] : raw;
      }

      return (
        <div className="flex gap-1 flex-wrap">
          {platforms.map((p) => (
            <Badge key={p} variant="outline" className="border-sidebar-border">
              {formatPlatformName(p)}
            </Badge>
          ))}
        </div>
      );
    },
  },
  {
    accessorKey: "units_sold",
    header: () =>
      renderSortableHeader("Units sold", "units_sold", setSort, sort),

    cell: ({ row }) => {
      return (
        <div>
          <p>{row.original.units_sold || "-"}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "first_time_purchases",
    header: () =>
      renderSortableHeader(
        "First-Time purchase",
        "first_time_purchases",
        setSort,
        sort
      ),
    cell: ({ row }) => {
      return (
        <div>
          <p>{row.original.first_time_purchases || "-"}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "repeat_purchase",
    header: () =>
      renderSortableHeader(
        "Repeat purchase",
        "repeat_purchases",
        setSort,
        sort
      ),
    cell: ({ row }) => {
      return (
        <div>
          <p>{row.original.repeat_purchases || "-"}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "total_revenue",
    header: () =>
      renderSortableHeader("Total revenue", "total_revenue", setSort, sort),
    cell: ({ row }) => {
      return (
        <div>
          <p>{row.original.total_revenue || "-"}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "cancellations",
    header: () =>
      renderSortableHeader("Cancellations", "cancellations", setSort, sort),
    cell: ({ row }) => {
      return (
        <div>
          <p>{row.original.cancellations || "-"}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "arpu",
    header: () => renderSortableHeader("ARPU", "arpu_usd_cents", setSort, sort),
    cell: ({ row }) => {
      return (
        <div>
          <p>{row.original.arpu || "-"}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "ltv",
    header: () => renderSortableHeader("LTV", "ltv_usd_cents", setSort, sort),
    cell: ({ row }) => {
      return (
        <div>
          <p>{row.original.ltv || "-"}</p>
        </div>
      );
    },
  },
];

export interface RevenueMetrics {
  product: string;
  platforms: string | string[];
  units_sold: number;
  first_time_purchases: number;
  repeat_purchases: number;
  total_revenue: string;
  arpu: string;
  ltv: string;
  cancellations: number;
}

export const renderSortableHeader = (
  label: string,
  sortKey: string,
  setSort: React.Dispatch<React.SetStateAction<SortType>>,
  sort: SortType
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
    {checkSortDirection(sortKey, sort)}
  </Button>
);
