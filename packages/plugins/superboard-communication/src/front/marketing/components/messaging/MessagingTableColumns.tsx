"use client";

import { formatSlashDate } from "@superboard/front-ui/lib/dateUtils.js";
import { formatPlatformName } from "@superboard/front-ui/lib/utils.js";
import type { Notification } from "@superboard/front-ui/types";
import type { SortType } from "@superboard/front-ui/types";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import type { AccessorKeyColumnDef } from "@tanstack/react-table";

export const getMessagingTableColumns = (
	sort: SortType,
	setSort: React.Dispatch<React.SetStateAction<SortType>>,
	t: (key: string) => string = (key) => key,
): AccessorKeyColumnDef<MessagingMetrics>[] => [
	{
		accessorKey: "title",
		header: () => renderSortableHeader(t("Title"), "title", setSort, sort),
		cell: ({ row }) => {
			return (
				<div>
					<p>{row.original.title}</p>
				</div>
			);
		},
	},
	{
		accessorKey: "subtitle",
		header: () => renderSortableHeader(t("Subtitle"), "subtitle", setSort, sort),

		cell: ({ row }) => {
			return (
				<div>
					<p>{row.original.subtitle || "-"}</p>
				</div>
			);
		},
	},
	{
		accessorKey: "platform",
		header: () => renderSortableHeader(t("Platform"), "platform", setSort, sort),

		cell: ({ row }) => {
			return (
				<div className="flex gap-2">
					{row.original.target.platforms.map((item: string) => (
						<Badge variant={"outline"} key={item}>
							{formatPlatformName(item)}
						</Badge>
					))}
				</div>
			);
		},
	},
	{
		accessorKey: "views",
		header: () => renderSortableHeader(t("Views"), "read_count", setSort, sort),

		cell: ({ row }) => {
			return (
				<div>
					<p>{row.original.read_count ?? 0}</p>
				</div>
			);
		},
	},
	{
		accessorKey: "target",
		header: () => renderNormalHeader(t("Target")),
		cell: ({ row }) => {
			return (
				<div>
					{row.original.target.new_users && <Badge variant={"outline"}>{t("New users")}</Badge>}
					{row.original.target.existing_users && (
						<Badge variant={"outline"}>{t("Existing users")}</Badge>
					)}
				</div>
			);
		},
	},

	{
		accessorKey: "auto_display",
		header: () => renderSortableHeader(t("Auto display"), "auto_display", setSort, sort),
		cell: ({ row }) => {
			return (
				<div>
					<p>{t(row.original.auto_display ? "Yes" : "No")}</p>
				</div>
			);
		},
	},

	{
		accessorKey: "push_notification",
		header: () => renderSortableHeader(t("Push notification"), "push_notification", setSort, sort),
		cell: ({ row }) => {
			return (
				<div>
					<p>{t(row.original.send_push ? "Yes" : "No")}</p>
				</div>
			);
		},
	},
	{
		accessorKey: "updated_at",
		header: () => renderSortableHeader(t("Date"), "updated_at", setSort, sort),
		cell: ({ row }) => {
			return (
				<div>
					<p>{row.original.updated_at ? formatSlashDate(row.original.updated_at) : ""}</p>
				</div>
			);
		},
	},
];

export type MessagingMetrics = Notification;

export const renderSortableHeader = (
	label: string,
	sortKey: string,
	setSort: React.Dispatch<React.SetStateAction<SortType>>,
	_sort: SortType,
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
		{/* {checkSortDirection(sortKey, sort)} */}
	</Button>
);

export const renderNormalHeader = (label: string) => <Button variant="ghost">{label}</Button>;
