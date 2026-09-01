"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { categorizeError } from "@/lib/errorUtils";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { title, description } = categorizeError(error);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h2 className="text-xl font-semibold text-destructive">{title}</h2>
      <p className="my-3 max-w-md text-sm text-muted-foreground">
        {description}
      </p>
      <div className="flex items-center gap-3">
        <Button onClick={reset} size="sm">
          Try again
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/customers">Open App module</Link>
        </Button>
      </div>
    </div>
  );
}
