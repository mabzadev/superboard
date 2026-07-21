"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, FolderOpen } from "lucide-react";

const CampaignsEmptyState = ({
  onCreateCampaign,
  isArchived,
}: {
  onCreateCampaign?: () => void;
  isArchived?: boolean;
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center py-14 px-4 w-full bg-sidebar"
    >
      <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted mb-4">
        <FolderOpen className="h-5 w-5 text-muted-foreground" />
      </div>

      <h3 className="text-sm font-semibold text-foreground text-center mb-2">
        {isArchived ? "No archived campaigns" : "No campaigns yet"}
      </h3>

      <p
        className={cn(
          "text-xs text-muted-foreground text-center leading-relaxed max-w-md",
          !isArchived && "mb-6"
        )}
      >
        {isArchived
          ? "Campaigns you archive will appear here. Archived campaigns keep their historical data but their links are no longer grouped."
          : "A campaign is a collection of links grouped under a single marketing objective. Add links to track their combined performance across channels and audiences."}
      </p>

      {!isArchived && onCreateCampaign && (
        <Button className="pl-3 pr-4" onClick={onCreateCampaign}>
          <Plus className="h-4 w-4" />
          Create Campaign
        </Button>
      )}
    </div>
  );
};

export default CampaignsEmptyState;
