"use client";

import type { AccessorKeyColumnDef } from "@tanstack/react-table";

import DataTable from "../../../../../../../../../supbrd-front-ui/src/shared/components/common/DataTable.js";
import MessagingEmptyState from "./MessagingEmptyState.js";

interface MessagingTableProps<T> {
	columns: AccessorKeyColumnDef<T>[];
	data: T[];
	selectedColumns: string[];
	handleSelectRow?: (item: T) => void;
	loading?: boolean;
	hasFilters?: boolean;
	onCreateMessage?: () => void;
	isArchived?: boolean;
}

const MessagingTable = <T,>({
	columns,
	data,
	selectedColumns,
	handleSelectRow,
	loading,
	hasFilters,
	onCreateMessage,
	isArchived,
}: MessagingTableProps<T>) => {
	return (
		<DataTable
			columns={columns}
			data={data}
			selectedColumns={selectedColumns}
			onRowClick={handleSelectRow}
			loading={loading}
			hasFilters={hasFilters}
			ariaLabel="Messages"
			emptyState={<MessagingEmptyState onCreateMessage={onCreateMessage} isArchived={isArchived} />}
		/>
	);
};

export default MessagingTable;
