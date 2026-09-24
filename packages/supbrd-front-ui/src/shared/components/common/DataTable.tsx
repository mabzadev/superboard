"use client";

import {
	type AccessorKeyColumnDef,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { useMemo } from "react";

import { cn } from "../../lib/utils.js";
import { Skeleton } from "../ui/skeleton.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.js";

export interface DataTableProps<T> {
	columns: AccessorKeyColumnDef<T>[];
	data: T[];
	selectedColumns: string[];
	onRowClick?: (row: T) => void;
	getRowId?: (row: T) => string;
	getRowAriaLabel?: (row: T) => string;
	loading?: boolean;
	hasFilters?: boolean;
	emptyState: React.ReactNode;
	ariaLabel: string;
	stickyHeader?: boolean;
	containerClassName?: string;
	headerClassName?: (columnId: string) => string | undefined;
	cellClassName?: (columnId: string) => string | undefined;
	skeletonCellClassName?: string;
}

const SKELETON_ROWS = ["sk-1", "sk-2", "sk-3", "sk-4", "sk-5"] as const;

const DataTable = <T,>({
	columns,
	data,
	selectedColumns,
	onRowClick,
	getRowId,
	getRowAriaLabel,
	loading,
	hasFilters,
	emptyState,
	ariaLabel,
	stickyHeader,
	containerClassName,
	headerClassName,
	cellClassName,
	skeletonCellClassName = "px-5 py-3",
}: DataTableProps<T>) => {
	const visibleColumns = useMemo(() => {
		return columns.reduce(
			(acc, col) => {
				const key = col.accessorKey as string;
				if (key) acc[key] = selectedColumns.includes(key);
				return acc;
			},
			{} as Record<string, boolean>,
		);
	}, [columns, selectedColumns]);

	const table = useReactTable({
		data,
		columns,
		...(getRowId ? { getRowId } : {}),
		state: {
			columnVisibility: visibleColumns,
		},
		getCoreRowModel: getCoreRowModel(),
	});

	const defaultContainerClass =
		"rounded-[var(--radius)] border border-border overflow-hidden bg-card";

	return (
		<div
			className={containerClassName ?? defaultContainerClass}
			aria-live="polite"
			aria-atomic="true"
		>
			<Table aria-label={ariaLabel}>
				<TableHeader className={stickyHeader ? "sticky top-0 z-10" : undefined}>
					{table.getHeaderGroups().map((headerGroup) => (
						<TableRow key={headerGroup.id} className="bg-muted/40 border-b border-border w-auto">
							{headerGroup.headers.map((header) => (
								<TableHead
									key={header.id}
									className={cn(
										"h-10 px-4 py-2.5 text-start align-middle font-medium text-xs text-muted-foreground uppercase tracking-wider",
										stickyHeader && "bg-muted/90 backdrop-blur-xs",
										headerClassName?.(header.column.id),
									)}
								>
									{header.isPlaceholder
										? null
										: flexRender(header.column.columnDef.header, header.getContext())}
								</TableHead>
							))}
						</TableRow>
					))}
				</TableHeader>
				<TableBody>
					{loading && !data?.length ? (
						SKELETON_ROWS.map((rowKey) => (
							<TableRow key={rowKey} className="border-b border-border">
								{table.getVisibleFlatColumns().map((col) => (
									<TableCell key={col.id} className={skeletonCellClassName}>
										<Skeleton className="h-4 w-3/4" />
									</TableCell>
								))}
							</TableRow>
						))
					) : table.getRowModel().rows?.length ? (
						table.getRowModel().rows.map((row) => (
							<TableRow
								key={row.id}
								data-state={row.getIsSelected() && "selected"}
								role={onRowClick ? "button" : undefined}
								tabIndex={onRowClick ? 0 : undefined}
								aria-label={
									onRowClick && getRowAriaLabel ? getRowAriaLabel(row.original) : undefined
								}
								onKeyDown={
									onRowClick
										? (e) => {
												if (e.key === "Enter" || e.key === " ") {
													e.preventDefault();
													onRowClick(row.original);
												}
											}
										: undefined
								}
								className={cn(
									"border-b border-border hover:bg-muted/50 transition-colors",
									onRowClick && "cursor-pointer",
									loading && "opacity-50 pointer-events-none",
								)}
								onClick={onRowClick ? () => onRowClick(row.original) : undefined}
							>
								{row.getVisibleCells().map((cell) => (
									<TableCell
										key={cell.id}
										className={cn(skeletonCellClassName, cellClassName?.(cell.column.id))}
									>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</TableCell>
								))}
							</TableRow>
						))
					) : hasFilters ? (
						<TableRow className="hover:bg-transparent">
							<TableCell colSpan={columns.length} className="h-32 text-center">
								<p className="text-sm text-muted-foreground">No results found</p>
								<p className="text-xs text-muted-foreground/60 mt-1">
									Try adjusting your search or filters
								</p>
							</TableCell>
						</TableRow>
					) : (
						<TableRow className="hover:bg-transparent">
							<TableCell colSpan={columns.length} className="p-0 whitespace-normal">
								{emptyState}
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
		</div>
	);
};

export default DataTable;
