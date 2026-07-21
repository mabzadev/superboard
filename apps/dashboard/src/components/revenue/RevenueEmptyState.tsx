"use client";

import { DollarSign } from "lucide-react";

const RevenueEmptyState = () => {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-4 w-full bg-sidebar">
      <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted mb-4">
        <DollarSign className="h-5 w-5 text-muted-foreground" />
      </div>

      <h3 className="text-sm font-semibold text-foreground text-center mb-2">
        No payment events yet
      </h3>

      <p className="text-xs text-muted-foreground text-center leading-relaxed max-w-md">
        Revenue data will appear here once purchases are recorded. Integrate our
        SDK to track in-app purchases, subscriptions, and custom payment events
        automatically.
      </p>
    </div>
  );
};

export default RevenueEmptyState;
