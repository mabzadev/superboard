"use client";

import DataTable from "@superboard/front-ui/common/DataTable.js";
import type { AccessorKeyColumnDef } from "@tanstack/react-table";

import { useFlowI18n } from "../../../../flows/features/flows/i18n.js";
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
	const { tr } = useFlowI18n();
	return (
		<DataTable
			columns={columns}
			data={data}
			selectedColumns={selectedColumns}
			onRowClick={(row) => onOpenCampaign(row.id)}
			getRowId={(row) => row.id}
			getRowAriaLabel={(row) => tr("View campaign {name}").replace("{name}", row.name)}
			loading={loading}
			hasFilters={hasFilters}
			ariaLabel={tr("Acquisition campaigns")}
			stickyHeader
			containerClassName="@container relative min-h-0 overflow-auto overscroll-none rounded-md border border-sidebar-border [&>[data-slot=table-container]]:overflow-visible"
			emptyState={
				<CampaignsEmptyState isArchived={isArchived} onCreateCampaign={onCreateCampaign} />
			}
		/>
	);
}
