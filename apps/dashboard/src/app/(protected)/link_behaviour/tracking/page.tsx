"use client";
import AppHeader from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectSelection } from "@/context/useProjectSelection";
import { showGenericError } from "@/lib/Notifications";
import { cn } from "@/lib/utils";

import {
  AlertCircle,
  BarChart3,
  Check,
  ExternalLink,
  Save,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useDomainConfigQuery } from "@/hooks/queries/useConfigurationQueries";
import { useSetGoogleTrackingIDMutation } from "@/hooks/mutations/useConfigurationMutations";

const TrackingPage = () => {
  const { selectedProject } = useProjectSelection();

  const projectId = selectedProject?.id;

  const { data: projectDomain } = useDomainConfigQuery(projectId);

  const setGoogleTrackingIDMutation = useSetGoogleTrackingIDMutation(projectId);

  const [trackingID, setTrackingID] = useState<string>("");
  const [changes, setChanges] = useState<boolean>(false);

  const checkChanges = useCallback(() => {
    if (!projectDomain) {
      setChanges(false);
      return;
    }

    const currentTrackingId = projectDomain.google_tracking_id || "";

    if (currentTrackingId !== trackingID.trim()) {
      setChanges(true);
    } else {
      setChanges(false);
    }
  }, [projectDomain, trackingID]);

  const handleSetGoogleAnalytics = async () => {
    const formData = new FormData();
    formData.append("google_tracking_id", trackingID);
    try {
      await setGoogleTrackingIDMutation.mutateAsync(formData);
    } catch {
      showGenericError();
    }
  };

  const handleDiscard = () => {
    if (!projectDomain) return;
    setTrackingID(projectDomain.google_tracking_id || "");
  };

  // Data fetching is handled automatically by useDomainConfigQuery

  const trackingIdValid = /^(G-[A-Z0-9]{4,}|UA-\d{4,}-\d+)$/.test(
    trackingID.trim()
  );

  // Data fetching on project change is handled by useDomainConfigQuery

  useEffect(() => {
    if (!projectDomain) {
      return;
    }
    setTrackingID(projectDomain.google_tracking_id || "");
  }, [projectDomain]);

  useEffect(() => {
    checkChanges();
  }, [checkChanges]);

  return (
    <div className="flex flex-col relative overflow-hidden h-dvh">
      <div className="border-b border-sidebar-border">
        <AppHeader />
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col overflow-hidden min-w-0 w-full">
          <div className="flex-1 overflow-auto">
            {/* Sticky save bar */}
            <div
              className={cn(
                "sticky top-0 z-10 transition-all duration-300 overflow-hidden bg-sidebar/80 backdrop-blur-md px-6 flex items-center justify-between",
                changes
                  ? "max-h-16 opacity-100 border-b border-sidebar-border py-3"
                  : "max-h-0 opacity-0 border-b-0 py-0"
              )}
            >
              <span className="text-xs text-muted-foreground">
                Unsaved changes in Tracking
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="pl-3 pr-4"
                  onClick={handleDiscard}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Discard
                </Button>
                <Button
                  size="sm"
                  className="pl-3 pr-4"
                  disabled={!trackingIdValid && trackingID.trim().length > 0}
                  onClick={handleSetGoogleAnalytics}
                >
                  <Save className="h-3.5 w-3.5" />
                  Save Changes
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-0 px-6 py-4 max-w-[800px]">
              {/* Google Analytics section */}
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-muted shrink-0">
                    <BarChart3 className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">
                      Google Analytics
                    </span>
                    <span className="text-xs text-muted-foreground leading-snug">
                      Track performance across all links in this project.
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Tracking ID</label>
                  <div className="flex w-full relative">
                    <Input
                      className={cn(
                        "pr-10 transition-all",
                        trackingID.length > 0 && !trackingIdValid
                          ? "border-destructive/50 ring-[3px] ring-destructive/10"
                          : trackingIdValid
                            ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
                            : ""
                      )}
                      placeholder="G-XXXXXXXXXX"
                      value={trackingID}
                      onChange={(e) => setTrackingID(e.target.value)}
                    />
                    {trackingIdValid && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center h-5 w-5 rounded-full bg-valid-green-light">
                        <Check className="h-3 w-3 text-valid-green" />
                      </div>
                    )}
                  </div>
                  {trackingID.length > 0 && !trackingIdValid && (
                    <Badge
                      variant="destructive"
                      className="w-fit gap-1.5 py-1 px-2.5"
                    >
                      <AlertCircle className="h-3 w-3" />
                      Enter a valid Tracking ID (e.g. G-XXXXXXXXXX)
                    </Badge>
                  )}
                </div>

                <a
                  className="inline-flex items-center gap-2 w-fit text-xs text-muted-foreground hover:text-foreground transition-colors"
                  href="https://support.google.com/analytics/answer/9539598?hl=en"
                  target="_blank"
                >
                  How to get the Google Tracking ID
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrackingPage;
