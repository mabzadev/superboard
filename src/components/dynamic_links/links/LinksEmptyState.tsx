"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, Link2, FolderOpen } from "lucide-react";

const LinksEmptyState = ({
  onCreateLink,
  isCampaign,
  isArchived,
}: {
  onCreateLink?: () => void;
  isCampaign?: boolean;
  isArchived?: boolean;
}) => {
  const title = isArchived
    ? "No archived links"
    : isCampaign
      ? "This campaign has no links"
      : "No links yet";

  const description = isArchived
    ? "Links you archive will appear here. Archived links stop being active but their historical data is preserved."
    : isCampaign
      ? "Add links to this campaign to track their combined performance. Each link can target a different channel or audience. All links will also appear in the Links section."
      : "Deep links route users to the right destination based on their device. Every view, install, and re-engagement is tracked automatically.";

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center py-14 px-4 w-full bg-sidebar"
    >
      <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted mb-4">
        {isCampaign ? (
          <FolderOpen className="h-5 w-5 text-muted-foreground" />
        ) : (
          <Link2 className="h-5 w-5 text-muted-foreground" />
        )}
      </div>

      <h3 className="text-sm font-semibold text-foreground text-center mb-2">
        {title}
      </h3>

      <p
        className={cn(
          "text-xs text-muted-foreground text-center leading-relaxed max-w-md",
          !isArchived && "mb-6"
        )}
      >
        {description}
      </p>

      {!isArchived && onCreateLink && (
        <Button className="pl-3 pr-4" onClick={onCreateLink}>
          <Plus className="h-4 w-4" />
          {isCampaign ? "Add Link To Campaign" : "Create Link"}
        </Button>
      )}
    </div>
  );
};

export default LinksEmptyState;
