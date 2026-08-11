"use client";

import {
  DateRangePicker,
  Preset,
} from "@/components/dateRangePicker/DateRangePicker";
import DangerZoneSection from "@/components/settings/DangerZoneSection";
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
} from "@/hooks/mutations/useInstanceMutations";
import type { Instance, InstanceMember } from "@/types";
import AdminOnlyDisplay from "@/lib/adminOnlyDisplay";
import { trackEvent, EVENTS } from "@/analytics";
import { showGenericError, showSuccessNotification } from "@/lib/Notifications";
import { deepClone } from "@/lib/utils";
import { Download } from "lucide-react";
import { formatApiDate } from "@/lib/dateUtils";
import React, { useEffect, useMemo, useState } from "react";
import { DateRange } from "react-day-picker";
import SessionStorage from "@/lib/SessionStorage";

const SettingsPage = () => {
  const { selectedInstance, setSelectedInstance } = useProjectSelection();

  // TanStack Query hooks
  const instancesQuery = useInstancesQuery();
  const membersQuery = useInstanceMembersQuery(selectedInstance?.id);
  const addMemberMutation = useAddMemberMutation(selectedInstance?.id);
  const removeMemberMutation = useRemoveMemberMutation(selectedInstance?.id);
  const deleteInstanceMutation = useDeleteInstanceMutation();
  const exportUsageMutation = useExportUsageMutation();

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

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

  return (
    <div className="flex min-h-full flex-col overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col overflow-hidden min-w-0 w-full">
          <div className="flex-1 overflow-auto">
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
              <TeamMebersSection
                members={parsedMembers}
                setMembers={() => {}}
                handleRemoveMember={handleRemoveMember}
                handleInviteMember={handleInviteMember}
                inviteDialogOpen={inviteDialogOpen}
                setInviteDialogOpen={setInviteDialogOpen}
              />

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
