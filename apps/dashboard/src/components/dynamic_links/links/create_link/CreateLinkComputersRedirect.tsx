import React, { useState } from "react";
import type { RedirectURL } from "@/types";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DEFAULT, REDIRECT_WEB } from "@/constants/OptionsConstants";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { httpUrlSchema } from "@/schemas/shared";
import {
  AlertCircle,
  Check,
  ChevronDown,
  CopySlash,
  Earth,
  Monitor,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LucideIcon } from "lucide-react";

type OptionItem = {
  value: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
};

const REDIRECT_OPTIONS: OptionItem[] = [
  {
    value: DEFAULT,
    title: "Default",
    subtitle: "Uses the project's default redirect settings.",
    icon: CopySlash,
  },
  {
    value: REDIRECT_WEB,
    title: "Redirect to Web",
    subtitle: "Redirects desktop users to a custom web URL.",
    icon: Earth,
  },
];

function OptionDropdown({
  options,
  value,
  onChange,
  disabled,
}: {
  options: OptionItem[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) ?? options[0]!;
  const SelectedIcon = selected.icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          className={cn(
            "flex items-center gap-3 w-full rounded-lg border border-sidebar-border bg-secondary px-3 py-2.5 text-left transition-all",
            "hover:bg-muted focus-visible:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-primary/10 focus-visible:outline-none"
          )}
        >
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-secondary shrink-0">
            <SelectedIcon className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium">{selected.title}</span>
            <span className="text-xs text-muted-foreground">
              {selected.subtitle}
            </span>
          </div>
          <Separator orientation="vertical" className="ml-auto h-6" />
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-1"
      >
        {options.map((option) => {
          const Icon = option.icon;
          const isSelected = value === option.value;
          return (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                "flex items-center gap-3 w-full rounded-md px-2.5 py-2 text-left transition-colors",
                isSelected ? "bg-accent" : "hover:bg-accent/50"
              )}
            >
              <div className="flex items-center justify-center w-7 h-7 rounded-md bg-secondary shrink-0">
                <Icon className="w-[18px] h-[18px] text-muted-foreground" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm">{option.title}</span>
                <span className="text-xs text-muted-foreground">
                  {option.subtitle}
                </span>
              </div>
              {isSelected && (
                <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
              )}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

const CreateLinkComputersRedirect = React.memo(
  function CreateLinkComputersRedirect({
    desktopRedirectType,
    setDesktopRedirectType,
    setDesktopRedirectURL,
    desktopRedirectURL,
    disabledActions,
    showErrors,
  }: {
    desktopRedirectType: string;
    desktopRedirectURL: RedirectURL | null;
    setDesktopRedirectType: (value: string) => void;
    setDesktopRedirectURL: React.Dispatch<
      React.SetStateAction<RedirectURL | null>
    >;
    disabledActions?: boolean;
    showErrors?: boolean;
  }) {
    const url = desktopRedirectURL?.url ?? "";
    const urlIsValid = httpUrlSchema.safeParse(url).success;
    const isHttps = url.startsWith("https://");
    const hasError =
      desktopRedirectType !== DEFAULT &&
      url.length > 0 &&
      (!urlIsValid || !isHttps);
    const showUrlValid =
      desktopRedirectType !== DEFAULT && urlIsValid && isHttps;
    const showEmptyError =
      showErrors && desktopRedirectType !== DEFAULT && url.length === 0;
    const errorMessage =
      url.length > 0 && !urlIsValid
        ? "Please enter a valid URL"
        : url.length > 0 && !isHttps
          ? "URL must start with https://"
          : "";
    return (
      <div className="flex flex-col gap-3 max-w-[460px]">
        {/* Header */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-secondary border border-sidebar-border">
            <Monitor className="w-[18px] h-[18px] text-foreground" />
          </div>
          <span className="text-sm font-medium">Desktop</span>
        </div>

        {/* Redirect type dropdown */}
        <OptionDropdown
          options={REDIRECT_OPTIONS}
          value={desktopRedirectType}
          onChange={(value) =>
            !disabledActions && setDesktopRedirectType(value)
          }
          disabled={disabledActions}
        />

        {/* URL input */}
        {desktopRedirectType !== DEFAULT && (
          <div className="flex flex-col gap-1.5 ">
            <label className="text-sm font-medium">Redirect URL</label>
            <div className="flex w-full relative">
              <Input
                className={cn(
                  "pr-10 transition-all",
                  hasError || showEmptyError
                    ? "border-destructive/50 ring-[3px] ring-destructive/10"
                    : showUrlValid
                      ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
                      : ""
                )}
                placeholder="Redirect URL (https://)"
                value={desktopRedirectURL?.url ?? ""}
                readOnly={disabledActions}
                onChange={(e) =>
                  setDesktopRedirectURL((prev: RedirectURL | null) => ({
                    ...(prev || {}),
                    url: e.target.value,
                    open_app_if_installed: false,
                  }))
                }
                onPaste={(e) => {
                  e.preventDefault();
                  const pasted = e.clipboardData.getData("text");
                  const sanitized = pasted.replace(/\s+/g, "");
                  setDesktopRedirectURL((prev: RedirectURL | null) => ({
                    ...(prev || {}),
                    url: sanitized,
                    open_app_if_installed: false,
                  }));
                }}
              />
              {showUrlValid && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center h-5 w-5 rounded-full bg-valid-green-light">
                  <Check className="h-3 w-3 text-valid-green" />
                </div>
              )}
            </div>
            {hasError && (
              <Badge
                variant="destructive"
                className="w-fit gap-1.5 py-1 px-2.5"
              >
                <AlertCircle className="h-3 w-3" />
                {errorMessage}
              </Badge>
            )}
            {showEmptyError && (
              <Badge
                variant="destructive"
                className="w-fit gap-1.5 py-1 px-2.5"
              >
                <AlertCircle className="h-3 w-3" />
                Redirect URL is required
              </Badge>
            )}
          </div>
        )}
      </div>
    );
  }
);

export default CreateLinkComputersRedirect;
