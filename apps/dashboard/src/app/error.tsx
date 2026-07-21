"use client";

import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import Link from "next/link";
import { capturePosthog } from "@/analytics/posthog";
import { categorizeError } from "@/lib/errorUtils";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Caught in error.tsx:", error);
    capturePosthog("error_boundary_triggered", {
      error_message: error.message,
      error_digest: error.digest,
    });
  }, [error]);

  const { title, description } = categorizeError(error);

  return (
    <div className="flex w-full flex-col items-center justify-center min-h-screen bg-muted text-center px-4">
      <h2 className="text-2xl font-bold text-destructive">{title}</h2>
      <p className="my-4 text-secondary-foreground">{description}</p>
      <div className="flex items-center gap-3">
        <Button onClick={() => reset()} className="px-4 py-2">
          Try Again
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Go to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
