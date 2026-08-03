"use client";

import {
  DateRangePicker,
  Preset,
} from "@/components/dateRangePicker/DateRangePicker";
import DangerZoneSection from "@/components/settings/DangerZoneSection";
import PlanSection from "@/components/settings/PlanSection";
import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

const SettingsActiveUsersChart = dynamic(
  () => import("@/components/settings/SettingsActiveUsersChart"),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[200px] w-full rounded-md" />,
  }
);
import TeamMebersSection from "@/components/settings/TeamMebersSection";

import AppHeader from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useEventsPaymentQuery } from "@/hooks/queries/useEventQueries";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  useInstancesQuery,
  useInstanceMembersQuery,
} from "@/hooks/queries/useInstanceQueries";
import {
  useAddMemberMutation,
  useRemoveMemberMutation,
  useDeleteInstanceMutation,
  useExportUsageMutation,
  useSetRevenueCollectionMutation,
} from "@/hooks/mutations/useInstanceMutations";
import {
  useSubscriptionQuery,
  useMauQuery,
} from "@/hooks/queries/usePaymentsQueries";
import type { Instance, InstanceMember } from "@/types";
import AdminOnlyDisplay from "@/lib/adminOnlyDisplay";
import { trackEvent, EVENTS } from "@/analytics";
import { showGenericError, showSuccessNotification } from "@/lib/Notifications";
import { deepClone } from "@/lib/utils";
import { ChartNoAxesColumnDecreasingIcon, Download } from "lucide-react";
import { formatApiDate } from "@/lib/dateUtils";
import React, { useEffect, useMemo, useState } from "react";
import { DateRange } from "react-day-picker";
import { Alert, AlertTitle } from "@/components/ui/alert";
import SessionStorage from "@/lib/SessionStorage";
import RevenueTracking from "@/components/settings/RevenueTracking";
import ActionConfirm from "@/components/common/action-confirm";
import { IS_ENTERPRISE } from "@/lib/edition";

const SettingsPage = () => {
  const { selectedInstance, setSelectedInstance } = useProjectSelection();

  // TanStack Query hooks
  const instancesQuery = useInstancesQuery();
  const membersQuery = useInstanceMembersQuery(selectedInstance?.id);
  const addMemberMutation = useAddMemberMutation(selectedInstance?.id);
  const removeMemberMutation = useRemoveMemberMutation(selectedInstance?.id);
  const deleteInstanceMutation = useDeleteInstanceMutation();
  const exportUsageMutation = useExportUsageMutation();
  const revenueCollectionMutation = useSetRevenueCollectionMutation();

  const subscriptionQuery = useSubscriptionQuery(selectedInstance?.id);
  const mauQuery = useMauQuery(selectedInstance?.id);
  const subscription = subscriptionQuery.data?.subscription ?? null;
  const isEnterprisePlan = subscriptionQuery.data?.isEnterprise ?? false;
  const planLoaded = !subscriptionQuery.isLoading;
  const mau = mauQuery.data ?? { current_quantity: 0, total_available: 1 };

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [, setcollectRevenue] = useState<boolean>(false);
  const [openConfirm, setOpenConfirm] = useState<boolean>(false);

  const now = new Date();
  const from = new Date().setDate(now.getDate() - 30);
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>({
    from: new Date(from),
    to: now,
  });

  const eventsPaymentParams = useMemo(() => {
    if (!selectedInstance || !dateRange?.from || !dateRange?.to) return null;
    return {
      start_date: formatApiDate(dateRange.from),
      end_date: formatApiDate(dateRange.to),
    };
  }, [selectedInstance, dateRange]);

  const eventsPaymentQuery = useEventsPaymentQuery(
    selectedInstance?.id,
    eventsPaymentParams
  );
  const overviewMetrics = eventsPaymentQuery.data ?? null;

  useEffect(() => {
    if (eventsPaymentQuery.error) {
      showGenericError();
    }
  }, [eventsPaymentQuery.error]);

  const dateRangePresets: Preset[] = [
    { label: "Last 7 days", value: 7, duration: "days" },
    { label: "Last 30 days", value: 30, duration: "days" },
    { label: "Last 3 months", value: 3, duration: "months" },
  ];

  // Derive parsed members from TanStack Query data
  const parsedMembers = useMemo((): InstanceMember[] => {
    if (!membersQuery.data?.members) return [];
    const clone = deepClone(membersQuery.data.members);
    return clone.map(
      (member: {
        user: { id: string; name?: string; email: string };
        role: string;
      }) => ({
        id: member.user.id,
        name: member.user.name || "Invited",
        email: member.user.email,
        role: member.role,
      })
    );
  }, [membersQuery.data]);

  const handleInviteMember = async (email: string, role: string) => {
    try {
      await addMemberMutation.mutateAsync({ email, role });
      trackEvent(EVENTS.TEAM_MEMBER_INVITED);
      // Members query auto-invalidated by mutation
      setInviteDialogOpen(false);
    } catch {
      showGenericError();
    }
  };

  const handleRemoveMember = async (email: string) => {
    try {
      await removeMemberMutation.mutateAsync(email);

      showSuccessNotification("The user was deleted");
      // Members query auto-invalidated by mutation
    } catch {
      showGenericError();
    }
  };

  const handleInstanceResponse = (instances: Instance[]) => {
    if (instances.length > 0) {
      const lastInstance = instances?.at(-1);
      setSelectedInstance(lastInstance as Instance | undefined);
    }
  };

  const handleDeleteInstance = async () => {
    if (!selectedInstance) return;

    try {
      await deleteInstanceMutation.mutateAsync(selectedInstance.id);
      showSuccessNotification("Project deleted");
      // Instances query auto-invalidated by mutation; pick the last one after refetch
      const result = await instancesQuery.refetch();
      if (result.data) {
        handleInstanceResponse(result.data);
      }
    } catch {
      showGenericError();
    }
  };

  const handleExport = async (
    instanceId: string,
    _date: DateRange | undefined
  ) => {
    const dataObj = {
      start_date: formatApiDate(dateRange!.from!),
      end_date: formatApiDate(dateRange!.to!),
    };
    try {
      const response = await exportUsageMutation.mutateAsync({
        id: instanceId,
        data: dataObj,
      });
      showSuccessNotification(response.data.message);
    } catch {
      showGenericError();
    }
  };

  const handleDateChange = (range: DateRange | undefined) => {
    setDateRange(range);
    if (range) {
      SessionStorage.setDateFilter(JSON.stringify(range));
    }
  };

  const getCurrentMauValue = () => {
    if (isEnterprisePlan) {
      return subscription?.current_maus ?? 0;
    } else {
      return mau.current_quantity;
    }
  };

  const getCurrentTotalMauValue = () => {
    if (isEnterprisePlan) {
      return subscription?.total_maus ?? 0;
    } else {
      return mau.total_available ?? Number.POSITIVE_INFINITY;
    }
  };

  const displayMauLimitReach = () => {
    if (!planLoaded) {
      return;
    }

    if (subscription && !isEnterprisePlan) {
      return;
    } else {
      if (getCurrentTotalMauValue() - getCurrentMauValue() < 0)
        return (
          <Alert variant={"destructive"}>
            <ChartNoAxesColumnDecreasingIcon />
            <AlertTitle>
              You need to increase your plan to keep using opengrow this month!
            </AlertTitle>
          </Alert>
        );
    }
  };

  const handleSwitchClick = (checked: boolean) => {
    if (checked === false) {
      setOpenConfirm(true);
    } else {
      handleEnableCollectRevenue(checked);
    }
  };

  const handleEnableCollectRevenue = async (enabled: boolean) => {
    if (!selectedInstance) return;
    const dataObject = {
      revenue_collection_enabled: enabled,
    };

    try {
      await revenueCollectionMutation.mutateAsync({
        id: selectedInstance.id,
        data: dataObject,
      });
      // Instances query auto-invalidated by mutation — no need to call refreshInstances
    } catch {
      showGenericError();
    }
  };

  useEffect(() => {
    const savedDateRange = SessionStorage.getDateFilter();
    if (savedDateRange) {
      try {
        const parsedRange = JSON.parse(savedDateRange);
        setDateRange({
          from: parsedRange.from ? new Date(parsedRange.from) : undefined,
          to: parsedRange.to ? new Date(parsedRange.to) : undefined,
        });
      } catch {
        // Invalid date filter — use default range
      }
    } else {
      const now = new Date();
      const from = new Date();
      from.setDate(now.getDate() - 30);
      setDateRange({ from, to: now });
    }
  }, []);

  useEffect(() => {
    if (!selectedInstance) return;
    setcollectRevenue(selectedInstance.revenue_collection_enabled);
  }, [selectedInstance]);

  return (
    <div className="flex flex-col relative overflow-hidden h-dvh">
      {IS_ENTERPRISE && (
        <ActionConfirm
          title="Are you sure you want to disable revenue tracking?"
          description="Disabling revenue tracking will stop all collection of revenue data for this project."
          confirmText="Disable"
          open={openConfirm}
          setOpen={setOpenConfirm}
          onConfirm={() => handleEnableCollectRevenue(false)}
          showCloseButton={false}
        />
      )}

      <div className="border-b border-sidebar-border">
        <AppHeader hideEnvSelect />
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col overflow-hidden min-w-0 w-full">
          <div className="flex-1 overflow-auto">
            {displayMauLimitReach() && (
              <div className="px-6 pt-4">{displayMauLimitReach()}</div>
            )}

            {/* Active Users — full window width */}
            <div className="py-4">
              <div className="flex items-center gap-3 px-6 mb-5">
                <div className="flex flex-col gap-0.5 flex-1">
                  <span className="text-sm font-semibold">Active Users</span>
                  <span className="text-xs text-muted-foreground">
                    Daily active users over the selected period.
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <DateRangePicker
                    date={dateRange}
                    setDate={handleDateChange}
                    presets={dateRangePresets}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      selectedInstance &&
                      handleExport(selectedInstance.id, dateRange)
                    }
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export
                  </Button>
                </div>
              </div>
              <SettingsActiveUsersChart data={overviewMetrics} />
            </div>

            <Separator />

            {/* Remaining sections — constrained width */}
            <div className="max-w-[800px] px-6 py-8">
              <PlanSection />

              <Separator className="my-8" />

              <TeamMebersSection
                members={parsedMembers}
                setMembers={() => {}}
                handleRemoveMember={handleRemoveMember}
                handleInviteMember={handleInviteMember}
                inviteDialogOpen={inviteDialogOpen}
                setInviteDialogOpen={setInviteDialogOpen}
              />

              {IS_ENTERPRISE && (
                <>
                  <Separator className="my-8" />

                  <RevenueTracking
                    collectRevenue={
                      selectedInstance?.revenue_collection_enabled ?? false
                    }
                    handleSwitch={handleSwitchClick}
                  />
                </>
              )}

              <AdminOnlyDisplay>
                <Separator className="my-8" />
                <DangerZoneSection handleRemoveProject={handleDeleteInstance} />
              </AdminOnlyDisplay>

              {/* Bottom spacing */}
              <div className="h-12" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
