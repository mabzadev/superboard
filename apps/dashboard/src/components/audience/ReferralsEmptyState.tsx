"use client";

import { UserPlus } from "lucide-react";

const ReferralsEmptyState = () => {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-4 w-full bg-sidebar">
      <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted mb-4">
        <UserPlus className="h-5 w-5 text-muted-foreground" />
      </div>

      <h3 className="text-sm font-semibold text-foreground text-center mb-2">
        No referrals yet
      </h3>

      <p className="text-xs text-muted-foreground text-center leading-relaxed max-w-md">
        Referrals appear here when your users start inviting others. Each
        referral tracks the views, installs, and engagement generated through
        their invites.
      </p>
    </div>
  );
};

export default ReferralsEmptyState;
