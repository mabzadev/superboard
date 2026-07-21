import { Input } from "@/components/ui/input";
import { httpUrlSchema } from "@/schemas/shared";
import { AlertCircle, Check, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useFormContext } from "react-hook-form";
import type { RedirectRulesFormValues } from "@/schemas/redirect";

const FallBackURL = ({ showErrors }: { showErrors?: boolean }) => {
  const { watch, setValue } = useFormContext<RedirectRulesFormValues>();
  const fallbackUrl = watch("defaultUrl");

  const urlIsValid =
    fallbackUrl.length > 0 && httpUrlSchema.safeParse(fallbackUrl).success;
  const hasError =
    fallbackUrl.length > 0 && !httpUrlSchema.safeParse(fallbackUrl).success;
  const isEmpty = fallbackUrl.length === 0 && showErrors;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-muted shrink-0">
          <Globe className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Default Fallback</span>
          <span className="text-xs text-muted-foreground leading-snug">
            When no platform-specific redirect is configured, all links will
            redirect to this URL.
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Fallback URL</label>
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
            value={fallbackUrl}
            onChange={(e) =>
              setValue("defaultUrl", e.target.value, { shouldDirty: true })
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
              ? "A fallback URL is required"
              : fallbackUrl.startsWith("http://") ||
                  fallbackUrl.startsWith("https://")
                ? "Please enter a valid URL"
                : "URL must start with http:// or https://"}
          </Badge>
        )}
      </div>
    </div>
  );
};

export default FallBackURL;
