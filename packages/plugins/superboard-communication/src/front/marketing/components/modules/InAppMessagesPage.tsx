"use client";
import AdsPlatformSelect from "@superboard/front-ui/common/ads-platform.js";
import CustomizeColumns from "@superboard/front-ui/common/customize-columns.js";
import { PaginationFooter } from "@superboard/front-ui/common/pagination-footer.js";
import { targetFilterList } from "@superboard/front-ui/constants/FilterOptions.js";
import {
	ACTIVE,
	ALL_USERS_FILTER,
	ARCHIVED,
	EXISTING_USERS_FILTER,
	NEW_USERS_FILTER,
} from "@superboard/front-ui/constants/OptionsConstants.js";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { useTableParams } from "@superboard/front-ui/hooks/useTableParams.js";
import type { Notification, GetMessagingParams } from "@superboard/front-ui/types";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Checkbox } from "@superboard/front-ui/ui/checkbox.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Popover, PopoverContent, PopoverTrigger } from "@superboard/front-ui/ui/popover.js";
import { ChevronDown, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { useNotificationsQuery } from "../../hooks/queries/useNotificationsQueries.js";
import { useUrlState } from "../../hooks/useUrlState.js";
import { useStudioI18n } from "../../studio/i18n.js";
import DynamicMessageDialog from "../craft/DynamicEditor.js";
import MessagingTable from "../messaging/MessagingTable.js";
import { getMessagingTableColumns } from "../messaging/MessagingTableColumns.js";

const MessagingPage = () => {
	const { t } = useStudioI18n();
	const { selectedProject } = useProjectSelection();
	const { page, setPage, rowsPerPage, setRowsPerPage, sort, setSort, searchTerm, setSearchTerm } =
		useTableParams();

	const [messagesType, setMessagesType] = useUrlState("status", ACTIVE, { resetPage: true });
	const [targetFilter, setTargetFilter] = useUrlState("target", ALL_USERS_FILTER, {
		resetPage: true,
	});

	const [isAddNewMessageOpen, setIsAddNewMessageOpen] = useState<boolean>(false);

	const [selectedMessage, setSelectedMessage] = useState<Notification | null>(null);

	const notificationsParams = useMemo(() => {
		if (!selectedProject) return null;
		const params: GetMessagingParams = {
			page,
			per_page: Math.max(1, Math.min(100, rowsPerPage)),
			sort_by: sort?.sortKey ?? "updated_at",
			ascending: sort?.ascending ?? false,
			for_new_users:
				targetFilter === NEW_USERS_FILTER
					? true
					: targetFilter === EXISTING_USERS_FILTER
						? false
						: null,
			archived: messagesType === ARCHIVED,
		};
		if (searchTerm !== "") params.term = searchTerm;
		return params;
	}, [selectedProject, page, rowsPerPage, sort, targetFilter, searchTerm, messagesType]);

	const notificationsQuery = useNotificationsQuery(selectedProject?.id, notificationsParams);
	const tableData = notificationsQuery.data?.data ?? [];
	const totalPages = notificationsQuery.data?.totalPages ?? 0;
	const totalRows = notificationsQuery.data?.totalEntries ?? 0;
	const tableLoading = notificationsQuery.isLoading;

	const columnOptions = [
		{ label: t("Title"), value: "title" },
		{ label: t("Subtitle"), value: "subtitle" },
		{ label: t("Platform"), value: "platform" },
		{ label: t("Views"), value: "views" },
		{ label: t("Target"), value: "target" },
		{ label: t("Auto display"), value: "auto_display" },
		{ label: t("Push notification"), value: "push_notification" },
		{ label: t("Date"), value: "updated_at" },
	];

	const [selectedColumns, setSelectedColumns] = useState<string[]>([
		"title",
		"subtitle",
		"platform",
		"views",
		"target",
		"auto_display",
		"push_notification",
		"updated_at",
		"actions",
	]);

	const columns = useMemo(() => getMessagingTableColumns(sort, setSort, t), [sort, setSort, t]);

	const handleDisplayItemDetails = (item: Notification) => {
		setSelectedMessage(item);
	};

	const getMessages = () => {
		void notificationsQuery.refetch();
		if (isAddNewMessageOpen) {
			setIsAddNewMessageOpen(false);
		}
	};

	const dialogOpen = isAddNewMessageOpen || !!selectedMessage;

	return (
		<div className="ds-page flex min-h-full flex-col overflow-hidden">
			<h1 className="ds-page-title mb-4">{t("In-app messages")}</h1>
			{notificationsQuery.error && (
				<div role="alert">
					{t("Loading failed")}{" "}
					<Button
						onClick={() => {
							void notificationsQuery.refetch();
						}}
					>
						{t("Retry")}
					</Button>
				</div>
			)}
			<div className="flex flex-1 flex-col overflow-hidden">
				<div className="@container/main flex flex-1 flex-col gap-2  overflow-hidden">
					<div className="flex flex-col gap-2 px-6 md:gap-6 md:py-3 overflow-hidden h-full">
						<div className="flex flex-wrap justify-between gap-2 relative shrink-0">
							<div className="flex flex-wrap gap-2 min-w-[200px] flex-1">
								<Input
									className="w-full min-w-[150px] max-w-[250px]"
									placeholder={t("Search message")}
									value={searchTerm}
									onChange={(e) => setSearchTerm(e.currentTarget.value)}
								/>

								<Popover>
									<PopoverTrigger asChild>
										<Button variant="outline" className="cursor-pointer whitespace-nowrap">
											{t(messagesType === ACTIVE ? "Active" : "Archived")}
											<ChevronDown className="ms-1 size-3.5" />
										</Button>
									</PopoverTrigger>
									<PopoverContent className="w-[200px] p-2 space-y-2">
										<div>
											<label className="text-sm text-muted-foreground">{t("Status")}</label>
										</div>
										{[
											{ label: t("Active"), value: ACTIVE },
											{ label: t("Archived"), value: ARCHIVED },
										].map((option) => (
											<label
												key={option.value}
												className="flex items-center gap-2 text-sm cursor-pointer"
											>
												<Checkbox
													checked={messagesType === option.value}
													onCheckedChange={() => setMessagesType(option.value)}
												/>
												<span>{option.label}</span>
											</label>
										))}
									</PopoverContent>
								</Popover>

								<AdsPlatformSelect
									platformAdsOptions={targetFilterList.map((option) => ({
										...option,
										label: t(option.label),
									}))}
									selectedAdsPlatform={targetFilter}
									setSelectedAdsPlatforms={setTargetFilter}
									title={t("Target")}
									selectListTitle={t("Users")}
								/>
							</div>

							<div className="flex flex-wrap gap-2 justify-end items-center">
								<CustomizeColumns
									columnOptions={columnOptions}
									selectedColumns={selectedColumns}
									setSelectedColumns={setSelectedColumns}
								/>
								<Button
									className="ps-3 pe-4"
									size="sm"
									onClick={() => setIsAddNewMessageOpen(true)}
								>
									<Plus className="size-3.5" />
									{t("Create Message")}
								</Button>
							</div>
						</div>
						<div className="overflow-auto">
							<MessagingTable
								selectedColumns={selectedColumns}
								data={tableData}
								columns={columns}
								handleSelectRow={handleDisplayItemDetails}
								loading={tableLoading}
								isArchived={messagesType === ARCHIVED}
								hasFilters={searchTerm !== "" || targetFilter !== ALL_USERS_FILTER}
								onCreateMessage={() => setIsAddNewMessageOpen(true)}
							/>
						</div>
						{totalPages > 0 && (
							<div className="flex w-full mt-auto">
								<PaginationFooter
									rowsPerPage={rowsPerPage}
									setRowsPerPage={setRowsPerPage}
									page={page}
									setPage={setPage}
									totalRows={totalRows}
									pageCount={totalPages}
								/>
							</div>
						)}
					</div>
					<DynamicMessageDialog
						open={dialogOpen}
						onOpenChange={(open) => {
							if (!open) {
								setIsAddNewMessageOpen(false);
								setSelectedMessage(null);
							}
						}}
						getMessages={getMessages}
						selectedMessage={selectedMessage}
						enabled={!selectedMessage}
						isArchived={messagesType === ARCHIVED}
					/>
				</div>
			</div>
		</div>
	);
};

export default MessagingPage;
