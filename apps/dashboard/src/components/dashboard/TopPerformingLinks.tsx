"use client";
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import CustomizeColumns from "@/components/common/customize-columns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Button } from "../ui/button";
import { Link2, Plus, TrendingUp } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useGlobalLinkDialog } from "@/context/useLinkDialogContext";
import { Skeleton } from "../ui/skeleton";
import { useProjectSelection } from "@/context/useProjectSelection";
import { topPerformingLinksColumns as columns } from "./TopPerformingLinksColumns";

import type { DashboardLink } from "@/types";

const TopPerformingLinks = ({
  data,
  handleEditLink,
  loading,
  hasCreatedLinks,
}: {
  data: DashboardLink[];
  hasCreatedLinks?: boolean;
  handleEditLink: (link: DashboardLink) => void;
  loading?: boolean;
}) => {
  const { selectedInstance } = useProjectSelection();
  const { openLinkDialog } = useGlobalLinkDialog();

  const [selectedColumns, setSelectedColumns] = useState<string[]>([
    "ads_platform",
    "name",
    "tags",
    "views",
    "opens",
    "installs",
    "reinstalls",
    "reactivations",
    "time_spent",
    "date",
  ]);

  const [sorting, setSorting] = useState<SortingState>([]);
  const scrollRef = useRef<number | null>(null);

  const handleSortingChange = (
    updater: SortingState | ((prev: SortingState) => SortingState)
  ) => {
    const scrollEl = document.scrollingElement ?? document.documentElement;
    scrollRef.current = scrollEl.scrollTop;
    setSorting(updater);
  };

  useLayoutEffect(() => {
    if (scrollRef.current !== null) {
      const scrollEl = document.scrollingElement ?? document.documentElement;
      scrollEl.scrollTop = scrollRef.current;
      scrollRef.current = null;
    }
  }, [sorting]);

  const columnOptions = useMemo(
    () => [
      { label: "Views", value: "views" },
      { label: "Opens", value: "opens" },
      { label: "Tags", value: "tags" },
      { label: "Installs", value: "installs" },
      { label: "Reinstalls", value: "reinstalls" },
      { label: "Reactivations", value: "reactivations" },
      { label: "Time spent", value: "time_spent" },
      ...(selectedInstance?.revenue_collection_enabled
        ? [{ label: "Revenue", value: "revenue" }]
        : []),
    ],
    [selectedInstance?.revenue_collection_enabled]
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility: columns.reduce(
        (acc, col) => {
          const key = col.accessorKey as string;
          if (!key) return acc;
          acc[key] = selectedColumns.includes(key);
          return acc;
        },
        {} as Record<string, boolean>
      ),
    },
    onSortingChange: handleSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  useEffect(() => {
    if (!selectedInstance) return;

    const baseColumns = [
      "ads_platform",
      "name",
      "tags",
      "views",
      "opens",
      "installs",
      "reinstalls",
      "reactivations",
      "time_spent",
      "date",
    ];

    const fullColumns = selectedInstance.revenue_collection_enabled
      ? [...baseColumns.slice(0, -1), "revenue", "date"]
      : baseColumns;

    setSelectedColumns(fullColumns);
  }, [selectedInstance]);

  useEffect(() => {
    table.setColumnVisibility(
      columns.reduce(
        (acc, col) => {
          const key = col.accessorKey as string;
          if (!key) return acc;
          acc[key] = selectedColumns.includes(key);
          return acc;
        },
        {} as Record<string, boolean>
      )
    );
  }, [selectedColumns, table]);

  return (
    <div className=" py-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center w-full">
          <h3 className="text-base font-semibold">Top performing links</h3>
          <div className="ml-auto">
            <CustomizeColumns
              columnOptions={columnOptions}
              selectedColumns={selectedColumns}
              setSelectedColumns={setSelectedColumns}
            />
          </div>
        </div>
        <div className="rounded-md border overflow-hidden border-sidebar-border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow
                  key={headerGroup.id}
                  className="bg-table-header w-auto"
                >
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={cn(
                        "text-foreground p-2",
                        header.column.id === "source" && "w-[50px] max-w-[50px]"
                      )}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading && !data?.length ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow
                    key={`skeleton-${i}`}
                    className="bg-background border-sidebar-border"
                  >
                    {table.getVisibleFlatColumns().map((col) => (
                      <TableCell key={col.id} className="p-2">
                        <Skeleton className="h-4 w-3/4" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    onClick={() => handleEditLink(row.original)}
                    key={row.id}
                    className={cn(
                      "bg-background border-sidebar-border",
                      loading && "opacity-50 pointer-events-none"
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          "p-2",
                          cell.column.id === "source" && "w-[50px] max-w-[50px]"
                        )}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns.length} className="h-auto p-0">
                    <div className="flex flex-col items-center justify-center py-16 px-8 bg-sidebar animate-in fade-in-0 slide-in-from-bottom-3 duration-500">
                      <div className="relative mb-5">
                        <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-sidebar border border-sidebar-border text-muted-foreground animate-in zoom-in-50 duration-500">
                          {hasCreatedLinks ? (
                            <TrendingUp className="h-6 w-6" />
                          ) : (
                            <Link2 className="h-6 w-6" />
                          )}
                        </div>
                        <div className="absolute -inset-2 rounded-3xl bg-sidebar/50 border border-sidebar-border/50 -z-10 animate-in zoom-in-75 duration-700" />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground mb-1">
                        {hasCreatedLinks
                          ? "No top performing links"
                          : "No links yet"}
                      </h3>
                      <p className="text-xs text-muted-foreground text-center max-w-[320px] leading-relaxed">
                        {hasCreatedLinks
                          ? "No link activity was recorded for the selected date range."
                          : "Create your first link to start tracking top performing content."}
                      </p>
                      {hasCreatedLinks ? (
                        <span className="text-[11px] text-muted-foreground/60 mt-3">
                          Try selecting a different period or share your links
                          to generate activity.
                        </span>
                      ) : (
                        <Button
                          className="mt-5"
                          size="sm"
                          onClick={() => openLinkDialog({})}
                        >
                          <Plus className="h-4 w-4" />
                          Create Link
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};

export default React.memo(TopPerformingLinks);
