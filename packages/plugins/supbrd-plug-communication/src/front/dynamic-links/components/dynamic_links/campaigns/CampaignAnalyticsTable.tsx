"use client";

import type { AccessorKeyColumnDef } from "@tanstack/react-table";

import DataTable from "../../../../../../../../supbrd-front-ui/src/shared/components/common/DataTable.js";
import type { CampaignAnalyticsRow } from "../../../api/dynamic-links/dynamicLinksService.js";
import CampaignsEmptyState from "./CampaignsEmptyState.js";

export function CampaignAnalyticsTable({
	columns,
	data,
	selectedColumns,
	loading,
	hasFilters,
	isArchived,
	onCreateCampaign,
	onOpenCampaign,
}: {
	columns: AccessorKeyColumnDef<CampaignAnalyticsRow>[];
	data: CampaignAnalyticsRow[];
	selectedColumns: string[];
	loading: boolean;
	hasFilters: boolean;
	isArchived: boolean;
	onCreateCampaign: () => void;
	onOpenCampaign: (campaignId: string) => void;
}) {
	return (
		<DataTable
			columns={columns}
			data={data}
			selectedColumns={selectedColumns}
			onRowClick={(row) => onOpenCampaign(row.id)}
			getRowId={(row) => row.id}
			getRowAriaLabel={(row) => `View campaign ${row.name}`}
			loading={loading}
			hasFilters={hasFilters}
			ariaLabel="Acquisition campaigns"
			stickyHeader
			containerClassName="relative min-h-0 overflow-auto overscroll-none rounded-md border border-sidebar-border [&>[data-slot=table-container]]:overflow-visible"
			emptyState={
				<CampaignsEmptyState isArchived={isArchived} onCreateCampaign={onCreateCampaign} />
			}
		/>
	);
}
