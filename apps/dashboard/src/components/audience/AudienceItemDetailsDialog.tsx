"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { createAddNewLinkDataTableColumns } from "../dynamic_links/links/create_link/CreateLinkDataTableColumns";
import AudienceItemDetailsAnalytics from "./AudienceItemDetailsAnalytics";
import { useVisitorDetailsQuery } from "@/hooks/queries/useVisitorsQueries";
import { useProjectSelection } from "@/context/useProjectSelection";
import AudienceDetailsAttributes from "./AudienceDetailsAttributes";
import { X } from "lucide-react";
import { Separator } from "../ui/separator";
import { Skeleton } from "../ui/skeleton";
import type {
  Visitor,
  VisitorDetailMetrics,
  AggregatedVisitorMetrics,
} from "@/types";

const AudienceItemDetailsDialog = ({
  open,
  onOpenChange,
}: {
  open: { id: string } | null;
  onOpenChange: (open: boolean) => void;
}) => {
  const { selectedProject } = useProjectSelection();
  const [section, setSection] = useState<string>("attributes");

  const visitorDetailsQuery = useVisitorDetailsQuery(
    selectedProject?.id,
    open?.id
  );
  const visitorData = visitorDetailsQuery.data;
  const loading = visitorDetailsQuery.isLoading;

  const visitorInfo: Visitor | null = visitorData?.visitor ?? null;
  const metrics: VisitorDetailMetrics | null = visitorData?.metrics ?? null;

  const agregatedMetrics: AggregatedVisitorMetrics | null = useMemo(() => {
    if (!visitorData) return null;
    let aggregated = visitorData.aggregated_metrics;
    if (aggregated) {
      aggregated = {
        ...aggregated,
        number_of_generated_links: visitorData.number_of_generated_links,
      };
    } else {
      return null;
    }
    return aggregated;
  }, [visitorData]);

  const columns = createAddNewLinkDataTableColumns();

  function convertToKeyValueArray(obj: Record<string, string> | undefined) {
    if (!obj) return [];
    return Object.entries(obj).map(([key, value]) => ({ key, value }));
  }

  const dataTable = useMemo(() => {
    return convertToKeyValueArray(metrics?.sdk_attributes) || [];
  }, [metrics]);

  const table = useReactTable({
    data: dataTable,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const sections = [
    { text: "Attributes", value: "attributes" },
    { text: "Analytics", value: "analytics" },
  ];

  useEffect(() => {
    if (!open) {
      const timeout = setTimeout(() => {
        setSection("attributes");
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [open]);

  return (
    <Dialog open={!!open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="Audience details dialog"
        showCloseButton={false}
        className="flex flex-col p-0 gap-0 overflow-hidden border-sidebar-border xl:max-w-[800px] w-full sm:max-w-[90vw] w-[90vw] h-full max-h-[90vh]"
      >
        <DialogDescription className="display-none"> </DialogDescription>

        {/* Header */}
        <DialogHeader>
          <div className="flex items-center gap-4 p-4 w-full">
            <DialogTitle className="font-semibold text-md">
              Visitor Details
            </DialogTitle>
            <button
              className="ml-auto"
              onClick={() => onOpenChange(false)}
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        <Separator />

        {/* Body: Sidebar + Content */}
        <div className="flex h-full w-full overflow-hidden">
          {/* Sidebar */}
          <div className="w-full max-w-[200px] flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border px-2 pt-4">
            {sections.map((item) => (
              <div
                aria-selected={section === item.value}
                className="flex px-3 py-2 items-center cursor-pointer rounded-md
                  aria-selected:bg-sidebar-accent aria-selected:text-sidebar-accent-foreground
                  hover:bg-sidebar-accent/50"
                onClick={() => setSection(item.value)}
                key={item.value}
              >
                <p className="text-sm">{item.text}</p>
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="flex flex-1 flex-col w-full min-h-0">
            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-col gap-4 px-5 py-4">
                {loading ? (
                  section === "attributes" ? (
                    <AttributesSkeleton />
                  ) : (
                    <AnalyticsSkeleton />
                  )
                ) : (
                  <>
                    {section === "attributes" && (
                      <AudienceDetailsAttributes
                        visitorInfo={visitorInfo}
                        columns={columns}
                        table={table}
                        dataTable={dataTable}
                      />
                    )}
                    {section === "analytics" && (
                      <AudienceItemDetailsAnalytics
                        metrics={metrics}
                        agregatedMetrics={agregatedMetrics}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const AttributesSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      ))}
    </div>
    <div className="flex flex-col gap-3">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-3 w-56" />
      <Skeleton className="h-32 w-full rounded-md" />
    </div>
  </div>
);

const MetricGridSkeleton = ({ cells }: { cells: number }) => (
  <div className="rounded-lg border border-sidebar-border overflow-hidden">
    <div className="grid grid-cols-3">
      {Array.from({ length: cells }).map((_, i) => (
        <div
          key={i}
          className="px-4 py-3.5 border-r border-b border-sidebar-border [&:nth-child(3n)]:border-r-0"
        >
          <Skeleton className="h-3 w-16 mb-2" />
          <Skeleton className="h-5 w-12" />
        </div>
      ))}
    </div>
  </div>
);

const AnalyticsSkeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-3">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-3 w-44" />
      <MetricGridSkeleton cells={8} />
    </div>

    <Separator />

    <div className="flex flex-col gap-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-52" />
      <MetricGridSkeleton cells={8} />
    </div>

    <Separator />

    <div className="flex flex-col gap-3">
      <Skeleton className="h-4 w-16" />
      <div className="rounded-lg border border-sidebar-border overflow-hidden">
        <div className="grid grid-cols-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="px-4 py-3.5 border-r border-sidebar-border last:border-r-0"
            >
              <Skeleton className="h-3 w-16 mb-2" />
              <Skeleton className="h-4 w-24 mb-1" />
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

export default AudienceItemDetailsDialog;
