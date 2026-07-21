"use client";

import { Users } from "lucide-react";

const VisitorsEmptyState = () => {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center py-14 px-4 w-full bg-sidebar"
    >
      <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted mb-4">
        <Users className="h-5 w-5 text-muted-foreground" />
      </div>

      <h3 className="text-sm font-semibold text-foreground text-center mb-2">
        No visitors yet
      </h3>

      <p className="text-xs text-muted-foreground text-center leading-relaxed max-w-md">
        Visitors appear here once someone clicks one of your links. Create a
        link, share it, and every view, install, and app open will be tracked
        automatically.
      </p>
    </div>
  );
};

export default VisitorsEmptyState;
