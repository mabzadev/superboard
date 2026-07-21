"use client";

import { memo } from "react";
import type { AccessorKeyColumnDef } from "@tanstack/react-table";
import type { Campaign } from "@/types";
import DataTable from "@/components/common/DataTable";
import CampaignsEmptyState from "./CampaignsEmptyState";

export type CampaignDataType = Campaign;

const CampaignsTable = ({
  columns,
  data,
  selectedColumns,
  handleGoToCampaign,
  loading,
  onCreateCampaign,
  hasFilters,
  isArchived,
}: {
  columns: AccessorKeyColumnDef<CampaignDataType>[];
  data: Campaign[];
  selectedColumns: string[];
  handleGoToCampaign: (campaignId: string) => void;
  loading?: boolean;
  onCreateCampaign?: () => void;
  hasFilters?: boolean;
  isArchived?: boolean;
}) => {
  return (
    <DataTable
      columns={columns}
      data={data}
      selectedColumns={selectedColumns}
      onRowClick={(row) => handleGoToCampaign(row.id)}
      getRowAriaLabel={(row) => `View campaign ${row.name ?? ""}`}
      loading={loading}
      hasFilters={hasFilters}
      ariaLabel="Campaigns"
      stickyHeader
      containerClassName="relative rounded-md border border-sidebar-border overflow-auto overscroll-none min-h-0 scrollbar-hide [&>[data-slot=table-container]]:overflow-visible"
      emptyState={
        <CampaignsEmptyState
          onCreateCampaign={onCreateCampaign}
          isArchived={isArchived}
        />
      }
    />
  );
};

export default memo(CampaignsTable);
