import { useState } from "react";
import {
  EXISTING_USERS_FILTER,
  NEW_USERS_FILTER,
} from "@/constants/OptionsConstants";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  AlertCircle,
  Bell,
  BellOff,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Monitor,
  Smartphone,
  Users,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import type { UseFormReturn } from "react-hook-form";
import type { MessageFormValues } from "@/schemas/message";

const audienceOptions = [
  {
    label: "Existing Users",
    value: EXISTING_USERS_FILTER,
    icon: Users,
    desc: "All currently registered users",
  },
  {
    label: "New Users",
    value: NEW_USERS_FILTER,
    icon: UserPlus,
    desc: "Only users who register after publishing",
  },
];

const CreateMessageDelivery = ({
  form,
  options,
  readOnly,
  showErrors,
}: {
  form: UseFormReturn<MessageFormValues>;
  options: { label: string; value: string }[];
  readOnly?: boolean;
  showErrors?: boolean;
}) => {
  const [platformsOpen, setPlatformsOpen] = useState<boolean>(false);
  const [audienceOpen, setAudienceOpen] = useState<boolean>(false);
  const [pushOpen, setPushOpen] = useState<boolean>(false);
  const [autoDisplayOpen, setAutoDisplayOpen] = useState<boolean>(false);

  const selectedValues = form.watch("selectedPlatforms");
  const deliverTo = form.watch("deliverTo");
  const autoDisplay = form.watch("autoDisplay");
  const deliverPushNotification = form.watch("deliverPushNotification");

  const selectedAudience =
    audienceOptions.find((o) => o.value === deliverTo) ?? audienceOptions[0]!;
  const AudienceIcon = selectedAudience.icon;

  const toggleValue = (value: string) => {
    const current = form.getValues("selectedPlatforms");
    const next = current.includes(value)
      ? current.filter((v: string) => v !== value)
      : [...current, value];
    form.setValue("selectedPlatforms", next, { shouldValidate: true });
  };

  const platformLabels =
    selectedValues.length > 0
      ? options
          .filter((o) => selectedValues.includes(o.value))
          .map((o) => o.label)
          .join(", ")
      : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Targeting: Audience + Platforms side by side */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Targeting</label>
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground"
          >
            Required
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Audience selector */}
          <Popover open={audienceOpen} onOpenChange={setAudienceOpen}>
            <PopoverTrigger asChild disabled={readOnly}>
              <button
                className={cn(
                  "flex items-center gap-3 w-full rounded-lg border border-sidebar-border bg-secondary px-3 py-2.5 text-left transition-all",
                  "hover:bg-muted focus-visible:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-primary/10 focus-visible:outline-none"
                )}
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-md bg-background shrink-0">
                  <AudienceIcon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-muted-foreground">
                    Audience
                  </span>
                  <span className="text-sm font-medium truncate">
                    {selectedAudience.label}
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
              {audienceOptions.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <button
                    key={item.value}
                    onClick={() => {
                      form.setValue("deliverTo", item.value, {
                        shouldValidate: true,
                      });
                      setAudienceOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-3 w-full rounded-md px-2.5 py-2 text-left transition-colors",
                      deliverTo === item.value
                        ? "bg-accent"
                        : "hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-center justify-center w-7 h-7 rounded-md bg-secondary shrink-0">
                      <ItemIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm">{item.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.desc}
                      </span>
                    </div>
                    {deliverTo === item.value && (
                      <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                    )}
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>

          {/* Platforms selector */}
          <Popover open={platformsOpen} onOpenChange={setPlatformsOpen}>
            <PopoverTrigger asChild disabled={readOnly}>
              <button
                className={cn(
                  "flex items-center gap-3 w-full rounded-lg border bg-secondary px-3 py-2.5 text-left transition-all",
                  "hover:bg-muted focus-visible:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-primary/10 focus-visible:outline-none",
                  selectedValues.length > 0
                    ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
                    : showErrors
                      ? "border-destructive/50 ring-[3px] ring-destructive/10"
                      : "border-sidebar-border"
                )}
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-md bg-background shrink-0">
                  <Smartphone className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-muted-foreground">
                    Platforms
                  </span>
                  <span
                    className={cn(
                      "text-sm truncate",
                      platformLabels ? "font-medium" : "text-muted-foreground"
                    )}
                  >
                    {platformLabels ?? "Select platforms"}
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
              {options.map((option) => (
                <button
                  key={option.value}
                  onClick={() => toggleValue(option.value)}
                  className={cn(
                    "flex items-center gap-3 w-full rounded-md px-2.5 py-2 text-left transition-colors",
                    selectedValues.includes(option.value)
                      ? "bg-accent"
                      : "hover:bg-accent/50"
                  )}
                >
                  <div className="flex items-center justify-center w-7 h-7 rounded-md bg-secondary shrink-0">
                    {option.value === "web" ? (
                      <Monitor className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Smartphone className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <span className="text-sm">{option.label}</span>
                  {selectedValues.includes(option.value) && (
                    <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                  )}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>

        {showErrors && selectedValues.length === 0 && (
          <Badge variant="destructive" className="w-fit gap-1.5 py-1 px-2.5">
            <AlertCircle className="h-3 w-3" />
            At least one platform is required
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          Choose who receives this message and on which platforms.
        </span>
      </div>

      <Separator />

      {/* Behavior: Push notifications + Auto display */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Behavior</label>

        <div
          className={cn(
            "grid gap-3",
            deliverTo === EXISTING_USERS_FILTER ? "grid-cols-2" : "grid-cols-1"
          )}
        >
          {/* Push notifications (only for existing users) */}
          {deliverTo === EXISTING_USERS_FILTER && (
            <Popover open={pushOpen} onOpenChange={setPushOpen}>
              <PopoverTrigger asChild disabled={readOnly}>
                <button
                  className={cn(
                    "flex items-center gap-3 w-full rounded-lg border border-sidebar-border bg-secondary px-3 py-2.5 text-left transition-all",
                    "hover:bg-muted focus-visible:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-primary/10 focus-visible:outline-none"
                  )}
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-background shrink-0">
                    {deliverPushNotification ? (
                      <Bell className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <BellOff className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs text-muted-foreground">
                      Push Notifications
                    </span>
                    <span className="text-sm font-medium truncate">
                      {deliverPushNotification ? "Enabled" : "Disabled"}
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
                <button
                  onClick={() => {
                    form.setValue("deliverPushNotification", true, {
                      shouldValidate: true,
                    });
                    setPushOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-3 w-full rounded-md px-2.5 py-2 text-left transition-colors",
                    deliverPushNotification ? "bg-accent" : "hover:bg-accent/50"
                  )}
                >
                  <div className="flex items-center justify-center w-7 h-7 rounded-md bg-secondary shrink-0">
                    <Bell className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm">Enabled</span>
                    <span className="text-xs text-muted-foreground">
                      Users receive an immediate push notification alert
                    </span>
                  </div>
                  {deliverPushNotification && (
                    <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                  )}
                </button>
                <button
                  onClick={() => {
                    form.setValue("deliverPushNotification", false, {
                      shouldValidate: true,
                    });
                    setPushOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-3 w-full rounded-md px-2.5 py-2 text-left transition-colors",
                    !deliverPushNotification
                      ? "bg-accent"
                      : "hover:bg-accent/50"
                  )}
                >
                  <div className="flex items-center justify-center w-7 h-7 rounded-md bg-secondary shrink-0">
                    <BellOff className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm">Disabled</span>
                    <span className="text-xs text-muted-foreground">
                      Message appears silently in the inbox
                    </span>
                  </div>
                  {!deliverPushNotification && (
                    <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                  )}
                </button>
              </PopoverContent>
            </Popover>
          )}

          {/* Auto display */}
          <Popover open={autoDisplayOpen} onOpenChange={setAutoDisplayOpen}>
            <PopoverTrigger asChild disabled={readOnly}>
              <button
                className={cn(
                  "flex items-center gap-3 w-full rounded-lg border border-sidebar-border bg-secondary px-3 py-2.5 text-left transition-all",
                  "hover:bg-muted focus-visible:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-primary/10 focus-visible:outline-none"
                )}
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-md bg-background shrink-0">
                  {autoDisplay ? (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-muted-foreground">
                    Auto Display
                  </span>
                  <span className="text-sm font-medium truncate">
                    {autoDisplay ? "Enabled" : "Disabled"}
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
              <button
                onClick={() => {
                  form.setValue("autoDisplay", true, { shouldValidate: true });
                  setAutoDisplayOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 w-full rounded-md px-2.5 py-2 text-left transition-colors",
                  autoDisplay ? "bg-accent" : "hover:bg-accent/50"
                )}
              >
                <div className="flex items-center justify-center w-7 h-7 rounded-md bg-secondary shrink-0">
                  <Eye className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm">Enabled</span>
                  <span className="text-xs text-muted-foreground">
                    Shows as a full-screen overlay when the app is open
                  </span>
                </div>
                {autoDisplay && (
                  <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                )}
              </button>
              <button
                onClick={() => {
                  form.setValue("autoDisplay", false, { shouldValidate: true });
                  setAutoDisplayOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 w-full rounded-md px-2.5 py-2 text-left transition-colors",
                  !autoDisplay ? "bg-accent" : "hover:bg-accent/50"
                )}
              >
                <div className="flex items-center justify-center w-7 h-7 rounded-md bg-secondary shrink-0">
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm">Disabled</span>
                  <span className="text-xs text-muted-foreground">
                    Message is only visible in the inbox
                  </span>
                </div>
                {!autoDisplay && (
                  <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                )}
              </button>
            </PopoverContent>
          </Popover>
        </div>

        <span className="text-xs text-muted-foreground">
          Control how and when the message is presented to users.
        </span>
      </div>
    </div>
  );
};

export default CreateMessageDelivery;
