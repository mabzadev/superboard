"use client";

import type { ReactNode } from "react";
import { FolderKanban } from "lucide-react";

import { cn } from "@/lib/utils";
import { useFlowI18n } from "./i18n";
import { useFlows } from "./FlowsContext";

export function FlowsPage({
  title,
  description,
  actions,
  fullHeight = false,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  fullHeight?: boolean;
  children: ReactNode;
}) {
  const { t } = useFlowI18n();
  const { projectRef } = useFlows();

  return (
    <section
      className={cn(
        "ds-page flex min-w-0 flex-col gap-5",
        fullHeight && "h-full overflow-hidden"
      )}
    >
      <header className="ds-page-header shrink-0 gap-4">
        <div className="min-w-0">
          <h1 className="ds-page-title">{title}</h1>
          <p className="ds-page-description">{description}</p>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        )}
      </header>

      {!projectRef ? (
        <FlowsEmptyState icon={FolderKanban} title={t("selectProject")} />
      ) : (
        children
      )}
    </section>
  );
}

export function FlowsEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-[var(--radius)] border border-dashed bg-card/40 p-8 text-center">
      <span className="rounded-full border bg-card p-3 text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <div>
        <p className="font-medium">{title}</p>
        {description && (
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
