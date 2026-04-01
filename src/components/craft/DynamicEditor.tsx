"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

const DynamicMessageDialog = dynamic(
  () => import("@/components/messaging/MessageDialogWithEditor"),
  {
    loading: () => (
      <div className="flex items-center justify-center p-8">
        <Skeleton className="h-[400px] w-full rounded-md" />
      </div>
    ),
    ssr: false,
  }
);

export default DynamicMessageDialog;
