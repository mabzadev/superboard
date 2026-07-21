import { Input } from "@/components/ui/input";
import { httpUrlSchema } from "@/schemas/shared";
import {
  AlertCircle,
  Check,
  ExternalLink,
  LayoutTemplate,
  Monitor,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useRef } from "react";
import OptionCard from "./OptionCard";
import { useFormContext } from "react-hook-form";
import type { RedirectRulesFormValues } from "@/schemas/redirect";

const ComputersRedirect = ({ showErrors }: { showErrors?: boolean }) => {
  const { watch, setValue } = useFormContext<RedirectRulesFormValues>();
  const desktopGeneratedPage = watch("desktop.generatedPage");
  const customUrl = watch("desktop.customUrl");

  const urlIsValid =
    customUrl.length > 0 && httpUrlSchema.safeParse(customUrl).success;
  const hasError =
    customUrl.length > 0 && !httpUrlSchema.safeParse(customUrl).success;
  const isEmpty = customUrl.length === 0 && showErrors;
  const customUrlRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col gap-5">
      {/* Platform header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-muted shrink-0">
          <Monitor className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Desktops & Laptops</span>
          <span className="text-xs text-muted-foreground leading-snug">
            Configure how links behave on desktops and laptops.
          </span>
        </div>
      </div>

      {/* Landing page type */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Landing page</label>
        <div className="grid grid-cols-2 gap-3">
          <OptionCard
            selected={desktopGeneratedPage === true}
            onClick={() =>
              setValue("desktop.generatedPage", true, { shouldDirty: true })
            }
            icon={LayoutTemplate}
            title="OpenGrow Page"
            description="QR code and download links"
          />
          <OptionCard
            selected={desktopGeneratedPage === false}
            onClick={() => {
              setValue("desktop.generatedPage", false, { shouldDirty: true });
              setTimeout(
                () =>
                  customUrlRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  }),
                100
              );
            }}
            icon={ExternalLink}
            title="Custom URL"
            description="Redirect to a specific page"
          />
        </div>
      </div>

      {/* Custom URL input */}
      {!desktopGeneratedPage && (
        <div ref={customUrlRef} className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Redirect URL</label>
          <div className="flex w-full relative">
            <Input
              className={cn(
                "pr-10 transition-all",
                hasError || isEmpty
                  ? "border-destructive/50 ring-[3px] ring-destructive/10"
                  : urlIsValid
                    ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
                    : ""
              )}
              placeholder="https://example.com"
              value={customUrl}
              onChange={(e) =>
                setValue("desktop.customUrl", e.currentTarget.value, {
                  shouldDirty: true,
                })
              }
            />
            {urlIsValid && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center h-5 w-5 rounded-full bg-valid-green-light">
                <Check className="h-3 w-3 text-valid-green" />
              </div>
            )}
          </div>
          {(hasError || isEmpty) && (
            <Badge variant="destructive" className="w-fit gap-1.5 py-1 px-2.5">
              <AlertCircle className="h-3 w-3" />
              {isEmpty
                ? "A redirect URL is required"
                : customUrl.startsWith("http://") ||
                    customUrl.startsWith("https://")
                  ? "Please enter a valid URL"
                  : "URL must start with http:// or https://"}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
};

export default ComputersRedirect;
