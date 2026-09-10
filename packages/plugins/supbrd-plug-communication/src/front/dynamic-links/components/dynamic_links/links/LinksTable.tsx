"use client";

import type { AccessorKeyColumnDef } from "@tanstack/react-table";
import { memo } from "react";

import DataTable from "../../../../../../../../supbrd-front-ui/src/shared/components/common/DataTable.js";
import type { LinkData } from "./linkAnalytics.js";
import LinksEmptyState from "./LinksEmptyState.js";

const LinksTable = ({
	selectedColumns,
	data,
	columns,
	handleEditLink,
	loading,
	onCreateLink,
	isCampaign,
	hasFilters,
	isArchived,
}: {
	selectedColumns: string[];
	data: LinkData[] | undefined;
	columns: AccessorKeyColumnDef<LinkData>[];
	handleEditLink: (link: LinkData) => void;
	loading?: boolean;
	onCreateLink?: () => void;
	isCampaign?: boolean;
	hasFilters?: boolean;
	isArchived?: boolean;
}) => {
	return (
		<DataTable
			columns={columns}
			data={data ?? []}
			selectedColumns={selectedColumns}
			onRowClick={handleEditLink}
			getRowId={(row) => row.id}
			getRowAriaLabel={(row) => `Edit link ${row.name ?? ""}`}
			loading={loading}
			hasFilters={hasFilters}
			ariaLabel="Links"
			stickyHeader
			containerClassName="relative rounded-md border border-sidebar-border overflow-auto overscroll-none min-h-0 scrollbar-hide [&>[data-slot=table-container]]:overflow-visible"
			skeletonCellClassName="p-2"
			headerClassName={(id) => {
				if (id === "ads_platform") return "w-[50px] max-w-[50px]";
				if (id === "title") return "max-w-[300px] truncate overflow-hidden text-ellipsis";
				return undefined;
			}}
			cellClassName={(id) => {
				if (id === "source") return "w-[50px] max-w-[50px]";
				if (id === "title") return "max-w-[300px] truncate overflow-hidden text-ellipsis";
				return undefined;
			}}
			emptyState={
				<LinksEmptyState
					onCreateLink={onCreateLink}
					isCampaign={isCampaign}
					isArchived={isArchived}
				/>
			}
		/>
	);
};

export default memo(LinksTable);
