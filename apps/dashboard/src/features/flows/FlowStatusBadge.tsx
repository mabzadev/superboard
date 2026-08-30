import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useFlowI18n } from "./i18n";

export function FlowStatusBadge({ status }: { status: string }) {
  const { tr } = useFlowI18n();
  const active =
    status === "active" || status === "running" || status === "completed";
  const warning =
    status === "draft" || status === "paused" || status === "in-progress";
  const statusLabel = status.replaceAll("-", " ");
  const translatedLabel = tr(
    `${statusLabel.charAt(0).toUpperCase()}${statusLabel.slice(1)}`
  );
  return (
    <Badge
      variant="outline"
      className={cn(
        "capitalize",
        active &&
          "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
        warning &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      )}
    >
      {translatedLabel}
    </Badge>
  );
}
