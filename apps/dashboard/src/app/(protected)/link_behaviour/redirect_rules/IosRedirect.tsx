import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { httpUrlSchema } from "@/schemas/shared";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  Earth,
  Eye,
  EyeOff,
  ExternalLink,
  Smartphone,
  Store,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import Image from "next/image";
import iosIcon from "@/assets/icons/generic/Apple.svg";
import iosIconDark from "@/assets/icons/generic/Apple_dark_mode.svg";
import { useRef } from "react";
import { useTheme } from "next-themes";
import OptionCard from "./OptionCard";
import Link from "next/link";
import { useFormContext } from "react-hook-form";
import type { RedirectRulesFormValues } from "@/schemas/redirect";

const IosRedirect = ({
  showErrors,
  sdkConfigured,
}: {
  showErrors?: boolean;
  sdkConfigured?: boolean;
}) => {
  const {
    watch,
    setValue,
    formState: { defaultValues },
  } = useFormContext<RedirectRulesFormValues>();
  const iosApp = watch("ios.enabled");
  const iosStore = watch("ios.appStore");
  const customUrl = watch("ios.customUrl");
  const iosShowPreview = watch("ios.showPreview");

  const { resolvedTheme } = useTheme();
  const urlIsValid =
    customUrl.length > 0 && httpUrlSchema.safeParse(customUrl).success;
  const hasError =
    customUrl.length > 0 && !httpUrlSchema.safeParse(customUrl).success;
  const isEmpty = customUrl.length === 0 && showErrors;
  const webUrlRef = useRef<HTMLDivElement>(null);
  const fallbackUrlRef = useRef<HTMLDivElement>(null);
  const appSectionRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col gap-5">
      {/* Platform header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-muted shrink-0">
          <Image
            src={resolvedTheme === "dark" ? iosIconDark : iosIcon}
            alt="ios"
            width={16}
            height={20}
            className="w-4 h-5"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">iOS</span>
          <span className="text-xs text-muted-foreground leading-snug">
            Configure how links behave on iOS devices.
          </span>
        </div>
      </div>

      {/* Redirect type selection */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">When link is opened</label>
        <div className="grid grid-cols-2 gap-3">
          <OptionCard
            selected={iosApp === true}
            onClick={() => {
              setValue("ios.enabled", true, { shouldDirty: true });
              setValue("ios.appStore", true, { shouldDirty: true });
              setValue("ios.showPreview", true, { shouldDirty: true });
              setTimeout(
                () =>
                  appSectionRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  }),
                100
              );
            }}
            icon={Smartphone}
            title="Redirect to App"
            description="Open the app directly"
          />
          <OptionCard
            selected={iosApp === false}
            onClick={() => {
              setValue("ios.enabled", false, { shouldDirty: true });
              setValue("ios.appStore", defaultValues?.ios?.appStore ?? true, {
                shouldDirty: true,
              });
              setValue(
                "ios.showPreview",
                defaultValues?.ios?.showPreview ?? false,
                { shouldDirty: true }
              );
              setTimeout(
                () =>
                  webUrlRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  }),
                100
              );
            }}
            icon={Earth}
            title="Redirect to Web"
            description="Send users to a URL"
          />
        </div>
      </div>

      {/* Redirect to Web: URL input */}
      {!iosApp && (
        <div ref={webUrlRef} className="flex flex-col gap-1.5">
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
              placeholder="https://example.com/ios"
              value={customUrl}
              onChange={(e) =>
                setValue("ios.customUrl", e.currentTarget.value, {
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

      {/* App preview — shown for both Redirect to App and Redirect to Web */}
      <Separator />
      <div ref={appSectionRef} className="flex flex-col gap-2">
        <label className="text-sm font-medium">App preview page</label>
        <div className="grid grid-cols-2 gap-3">
          <OptionCard
            selected={iosShowPreview === true}
            onClick={() =>
              setValue("ios.showPreview", true, { shouldDirty: true })
            }
            icon={Eye}
            title="Show Preview"
            description="Displays an intermediate page before redirecting. Recommended — improves deep linking accuracy on browsers that block automatic redirects."
          />
          <OptionCard
            selected={iosShowPreview === false}
            onClick={() =>
              setValue("ios.showPreview", false, { shouldDirty: true })
            }
            icon={EyeOff}
            title="Skip Preview"
            description="Redirects immediately with no intermediate page. Faster, but some browsers may not open the app correctly."
          />
        </div>
      </div>

      {/* Redirect to App: options */}
      {iosApp && (
        <>
          {!sdkConfigured ? (
            <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-amber-500/10 p-5">
              <div className="flex items-start gap-4">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/20 shrink-0">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex flex-col gap-2 min-w-0 flex-1">
                  <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                    iOS SDK not configured
                  </span>
                  <span className="text-xs text-amber-600/80 dark:text-amber-400/80 leading-relaxed">
                    Integrate the iOS SDK to enable app redirects. You&apos;ll
                    need your Bundle ID and team details.
                  </span>
                  <Link
                    href="/developers/ios_setup"
                    className="inline-flex items-center gap-2 mt-1 w-fit rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/25 px-3.5 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300 transition-colors"
                  >
                    Configure SDK
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <>
              <Separator />

              {/* When app is not installed */}
              <div className="rounded-lg border border-sidebar-border bg-muted/30 p-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-0.5">
                    <label className="text-sm font-medium">
                      When app is not installed
                    </label>
                    <span className="text-xs text-muted-foreground">
                      Where should users go if they don&apos;t have the app?
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <OptionCard
                      selected={iosStore === true}
                      onClick={() =>
                        setValue("ios.appStore", true, { shouldDirty: true })
                      }
                      icon={Store}
                      title="App Store"
                      description="Open the store listing"
                    />
                    <OptionCard
                      selected={iosStore === false}
                      onClick={() => {
                        setValue("ios.appStore", false, { shouldDirty: true });
                        setTimeout(
                          () =>
                            fallbackUrlRef.current?.scrollIntoView({
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

                  {/* Custom fallback URL */}
                  {!iosStore && (
                    <div
                      ref={fallbackUrlRef}
                      className="flex flex-col gap-1.5 mt-1"
                    >
                      <label className="text-sm font-medium">
                        Fallback URL
                      </label>
                      <div className="flex w-full relative">
                        <Input
                          className={cn(
                            "pr-10 transition-all bg-background",
                            hasError || isEmpty
                              ? "border-destructive/50 ring-[3px] ring-destructive/10"
                              : urlIsValid
                                ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
                                : ""
                          )}
                          placeholder="https://example.com/download-ios"
                          value={customUrl}
                          onChange={(e) =>
                            setValue("ios.customUrl", e.currentTarget.value, {
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
                        <Badge
                          variant="destructive"
                          className="w-fit gap-1.5 py-1 px-2.5"
                        >
                          <AlertCircle className="h-3 w-3" />
                          {isEmpty
                            ? "A fallback URL is required"
                            : customUrl.startsWith("http://") ||
                                customUrl.startsWith("https://")
                              ? "Please enter a valid URL"
                              : "URL must start with http:// or https://"}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default IosRedirect;
