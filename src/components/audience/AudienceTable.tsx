"use client";

import type { AccessorKeyColumnDef } from "@tanstack/react-table";
import DataTable from "@/components/common/DataTable";
import VisitorsEmptyState from "./VisitorsEmptyState";
import ReferralsEmptyState from "./ReferralsEmptyState";
import RevenueEmptyState from "../revenue/RevenueEmptyState";

interface AudienceTableProps<T> {
  columns: AccessorKeyColumnDef<T>[];
  data: T[];
  selectedColumns: string[];
  handleSelectRow?: (item: string) => void;
  loading?: boolean;
  hasFilters?: boolean;
  emptyStateType?: "visitors" | "referrals" | "revenue";
}

const emptyStateMap = {
  visitors: <VisitorsEmptyState />,
  referrals: <ReferralsEmptyState />,
  revenue: <RevenueEmptyState />,
};

const AudienceTable = <T,>({
  columns,
  data,
  selectedColumns,
  handleSelectRow,
  loading,
  hasFilters,
  emptyStateType = "visitors",
}: AudienceTableProps<T>) => {
  return (
    <DataTable
      columns={columns}
      data={data}
      selectedColumns={selectedColumns}
      onRowClick={
        handleSelectRow
          ? (row) => handleSelectRow((row as T & { id: string }).id)
          : undefined
      }
      loading={loading}
      hasFilters={hasFilters}
      ariaLabel="Audience"
      emptyState={emptyStateMap[emptyStateType]}
      headerClassName={(id) =>
        id === "sdk_identifier"
          ? "max-w-[180px] truncate overflow-hidden text-ellipsis"
          : undefined
      }
      cellClassName={(id) =>
        id === "sdk_identifier" ? "max-w-[180px]" : undefined
      }
    />
  );
};

export default AudienceTable;
