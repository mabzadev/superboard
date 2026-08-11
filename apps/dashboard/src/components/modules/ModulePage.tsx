"use client";

import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ApiError, getErrorMessage } from "@/lib/ApiError";

export function moduleErrorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === "number" ? getErrorMessage(status) : "An unexpected error occurred.";
}

export function ModulePage({ title, description, error, children }: { title: string; description: string; error?: string | null; children: ReactNode }) {
  return <div className="ds-page space-y-5">
    <header className="ds-page-header"><div><h1 className="ds-page-title">{title}</h1><p className="ds-page-description">{description}</p></div></header>
    {error && <Alert variant="destructive"><AlertTitle>Unable to load this module</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {children}
  </div>;
}

export function EmptyProject() { return <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Select a project to manage this module.</div>; }
