import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import React from "react";

const OptionCard = ({
  selected,
  onClick,
  icon: Icon,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ElementType;
  title: string;
  description: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-all",
      selected
        ? "border-valid-green/30 bg-valid-green/5 ring-[2px] ring-valid-green/10"
        : "border-sidebar-border bg-secondary hover:bg-muted"
    )}
  >
    <div
      className={cn(
        "flex items-center justify-center w-8 h-8 rounded-md border shrink-0",
        selected
          ? "bg-valid-green-light border-valid-green/20"
          : "bg-background border-sidebar-border"
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4",
          selected ? "text-valid-green" : "text-muted-foreground"
        )}
      />
    </div>
    <div className="flex flex-col min-w-0">
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </div>
    {selected && (
      <div className="ml-auto flex items-center justify-center h-5 w-5 rounded-full bg-valid-green-light shrink-0">
        <Check className="h-3 w-3 text-valid-green" />
      </div>
    )}
  </button>
);

export default OptionCard;
