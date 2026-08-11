"use client";

import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { capturePosthog } from "@/analytics/posthog";
import { categorizeError } from "@/lib/errorUtils";

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Caught in settings/error.tsx:", error);
    capturePosthog("error_boundary_triggered", {
      error_message: error.message,
      error_digest: error.digest,
      route_group: "settings",
    });
  }, [error]);

  const { title, description } = categorizeError(error);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <h2 className="text-xl font-semibold text-destructive">{title}</h2>
      <p className="my-3 text-sm text-muted-foreground max-w-md">
        {description}
      </p>
      <Button onClick={() => reset()} size="sm">
        Try Again
      </Button>
    </div>
  );
}
