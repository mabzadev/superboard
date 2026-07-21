"use client";
import MessagingTable from "@/components/messaging/MessagingTable";
import { getMessagingTableColumns } from "@/components/messaging/MessagingTableColumns";
import AdsPlatformSelect from "@/components/common/ads-platform";
import AppHeader from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import CustomizeColumns from "@/components/common/customize-columns";
import { Input } from "@/components/ui/input";
import { targetFilterList } from "@/constants/FilterOptions";
import {
  ACTIVE,
  ALL_USERS_FILTER,
  ARCHIVED,
  EXISTING_USERS_FILTER,
  NEW_USERS_FILTER,
} from "@/constants/OptionsConstants";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useNotificationsQuery } from "@/hooks/queries/useNotificationsQueries";
import { ChevronDown, Plus } from "lucide-react";
import type { Notification, GetMessagingParams } from "@/types";
import { useMemo, useState } from "react";
import { useTableParams } from "@/hooks/useTableParams";
import { useUrlState } from "@/hooks/useUrlState";
import { PaginationFooter } from "@/components/common/pagination-footer";
import DynamicMessageDialog from "@/components/craft/DynamicEditor";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

const MessagingPage = () => {
  const { selectedProject } = useProjectSelection();
  const {
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    sort,
    setSort,
    searchTerm,
    setSearchTerm,
  } = useTableParams();

  const [messagesType, setMessagesType] = useUrlState("status", ACTIVE);
  const [targetFilter, setTargetFilter] = useUrlState(
    "target",
    ALL_USERS_FILTER
  );

  const [isAddNewMessageOpen, setIsAddNewMessageOpen] =
    useState<boolean>(false);

  const [selectedMessage, setSelectedMessage] = useState<Notification | null>(
    null
  );

  const notificationsParams = useMemo(() => {
    if (!selectedProject) return null;
    const params: GetMessagingParams = {
      page,
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
  }, [selectedProject, page, targetFilter, searchTerm, messagesType]);

  const notificationsQuery = useNotificationsQuery(
    selectedProject?.id,
    notificationsParams
  );
  const tableData = notificationsQuery.data?.data ?? [];
  const totalPages = notificationsQuery.data?.totalPages ?? 0;
  const totalRows = notificationsQuery.data?.totalEntries ?? 0;
  const tableLoading = notificationsQuery.isLoading;

  const columnOptions = [
    { label: "Title", value: "title" },
    { label: "Subtitle", value: "subtitle" },
    { label: "Platform", value: "platform" },
    { label: "Views", value: "views" },
    { label: "Target", value: "target" },
    { label: "Auto display", value: "auto_display" },
    { label: "Push notification", value: "push_notification" },
    { label: "Date", value: "updated_at" },
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

  const columns = useMemo(
    () => getMessagingTableColumns(sort, setSort),
    [sort, setSort]
  );

  const handleDisplayItemDetails = (item: Notification) => {
    setSelectedMessage(item);
  };

  const getMessages = () => {
    notificationsQuery.refetch();
    if (isAddNewMessageOpen) {
      setIsAddNewMessageOpen(false);
    }
  };

  const dialogOpen = isAddNewMessageOpen || !!selectedMessage;

  return (
    <div className="flex flex-col relative overflow-hidden h-dvh">
      <AppHeader />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="@container/main flex flex-1 flex-col gap-2  overflow-hidden">
          <div className="flex flex-col gap-2 px-6 md:gap-6 md:py-3 overflow-hidden h-full">
            <div className="flex flex-wrap justify-between gap-2 relative shrink-0">
              <div className="flex flex-wrap gap-2 min-w-[200px] flex-1">
                <Input
                  className="w-full min-w-[150px] max-w-[250px]"
                  placeholder="Search message"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.currentTarget.value)}
                />

                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="cursor-pointer whitespace-nowrap"
                    >
                      {messagesType === ACTIVE ? "Active" : "Archived"}
                      <ChevronDown className="ml-1 size-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[200px] p-2 space-y-2">
                    <div>
                      <label className="text-sm text-muted-foreground">
                        Status
                      </label>
                    </div>
                    {[
                      { label: "Active", value: ACTIVE },
                      { label: "Archived", value: ARCHIVED },
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
                  platformAdsOptions={targetFilterList}
                  selectedAdsPlatform={targetFilter}
                  setSelectedAdsPlatforms={setTargetFilter}
                  title="Target"
                  selectListTitle="Users"
                />
              </div>

              <div className="flex flex-wrap gap-2 justify-end items-center">
                <CustomizeColumns
                  columnOptions={columnOptions}
                  selectedColumns={selectedColumns}
                  setSelectedColumns={setSelectedColumns}
                />
                <Button
                  className="pl-3 pr-4"
                  size="sm"
                  onClick={() => setIsAddNewMessageOpen(true)}
                >
                  <Plus className="size-3.5" />
                  Create Message
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
                hasFilters={
                  searchTerm !== "" || targetFilter !== ALL_USERS_FILTER
                }
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
