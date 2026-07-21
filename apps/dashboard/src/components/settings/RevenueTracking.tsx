"use client";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { CircleDollarSign } from "lucide-react";

const RevenueTracking = ({
  collectRevenue,
  handleSwitch,
}: {
  collectRevenue: boolean;
  handleSwitch: (item: boolean) => void;
}) => {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Revenue Tracking</span>
          <span className="text-[9px] font-semibold uppercase tracking-wider leading-none rounded bg-blue-500/10 text-foreground dark:bg-blue-400/10 dark:text-foreground px-1.5 py-0.5">
            Beta
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          Capture in-app purchases, custom payments, and attribute revenue to
          links and campaigns. Revenue tracking is currently in beta — there may
          be minor discrepancies in currency conversion rates and transaction
          amounts while we fine-tune our processing pipeline.
        </span>
      </div>

      <div
        className={cn(
          "rounded-xl border overflow-hidden",
          collectRevenue ? "border-valid-green/30" : "border-sidebar-border"
        )}
      >
        <div
          className={cn(
            "px-5 py-5 flex items-center gap-4",
            collectRevenue
              ? "bg-gradient-to-r from-valid-green/8 to-valid-green/3"
              : "bg-muted/50"
          )}
        >
          <div
            className={cn(
              "flex items-center justify-center h-11 w-11 rounded-xl shrink-0",
              collectRevenue
                ? "bg-valid-green/15 ring-1 ring-valid-green/20"
                : "bg-background border border-sidebar-border shadow-sm"
            )}
          >
            <CircleDollarSign
              className={cn(
                "h-5 w-5",
                collectRevenue ? "text-valid-green" : "text-muted-foreground"
              )}
            />
          </div>
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-semibold">
                {collectRevenue
                  ? "Revenue tracking is active"
                  : "Revenue tracking is off"}
              </span>
              <div
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium",
                  collectRevenue
                    ? "bg-valid-green/10 text-valid-green"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <div
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    collectRevenue ? "bg-valid-green" : "bg-muted-foreground/40"
                  )}
                />
                {collectRevenue ? "Active" : "Off"}
              </div>
            </div>
            <span className="text-xs text-muted-foreground">
              {collectRevenue
                ? "Revenue data is being collected for this project."
                : "Enable to start collecting revenue data."}
            </span>
          </div>
          <Button
            variant={collectRevenue ? "outline" : "default"}
            size="sm"
            className={cn(
              "shrink-0",
              collectRevenue &&
                "text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
            )}
            onClick={() => handleSwitch(!collectRevenue)}
          >
            {collectRevenue ? "Disable" : "Enable"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RevenueTracking;
