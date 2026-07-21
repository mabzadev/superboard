"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, Earth, TestTubeDiagonal } from "lucide-react";
import { useProjectSelection } from "@/context/useProjectSelection";
import { PRODUCTION, TEST } from "@/constants/OptionsConstants";
import {
  useSubscriptionQuery,
  useMauQuery,
} from "@/hooks/queries/usePaymentsQueries";
import { config } from "@/lib/config";

type AppHeaderProps = {
  titleOverride?: string;
  rightContent?: React.ReactNode;
  hideEnvSelect?: boolean;
};

export default function AppHeader({
  titleOverride,
  rightContent,
  hideEnvSelect,
}: AppHeaderProps) {
  const { projectType, setProjectType, selectedInstance } =
    useProjectSelection();
  const { resolvedTheme } = useTheme();

  const subscriptionQuery = useSubscriptionQuery(selectedInstance?.id);
  const subscription = subscriptionQuery.data?.subscription ?? null;
  const isEnterprise = subscriptionQuery.data?.isEnterprise ?? false;
  const planLoaded =
    !subscriptionQuery.isLoading && subscriptionQuery.isFetched;

  const mauQuery = useMauQuery(selectedInstance?.id);
  const mau = mauQuery.data ?? { current_quantity: 0, total_available: 1 };
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  // Automatically build breadcrumbs from URL
  const breadcrumbLabelOverrides: Record<string, string> = {
    ios_setup: "iOS Setup",
    android_setup: "Android Setup",
    web_setup: "Web Setup",
  };

  const pathSegments = pathname
    .split("/")
    .filter(Boolean)
    .map((slug) => ({
      slug, // original, like "dynamic_links"
      label: breadcrumbLabelOverrides[slug] ?? slug.replace(/_/g, " "), // display label
    }));

  const router = useRouter();
  const returnUrlWithParams = (url: string) => {
    const urlWithParams = `${url}${query ? `?${query}` : ""}`;
    return urlWithParams;
  };

  const getCurrentMauValue = () => {
    if (isEnterprise) {
      return subscription?.current_maus ?? 0;
    } else {
      return mau.current_quantity;
    }
  };

  const getCurrentTotalMauValue = () => {
    if (isEnterprise) {
      return subscription?.total_maus ?? 0;
    } else {
      return mau.total_available;
    }
  };

  const displayLimitReach = () => {
    if (!planLoaded) {
      return;
    }
    // Paid Stripe subscribers — don't show the banner (Stripe handles billing)
    if (subscription && !isEnterprise) {
      return;
    }
    // Enterprise accounts — show a contact-sales banner only if over limit
    if (isEnterprise) {
      if (
        getCurrentTotalMauValue() > 0 &&
        getCurrentMauValue() > getCurrentTotalMauValue()
      ) {
        return (
          <div className="w-full bg-destructive-secondary dark:bg-destructive p-2 flex items-center justify-center">
            <p className="text-sm text-destructive text-center dark:text-foreground">
              Monthly usage limit reached.{" "}
              <label
                className="underline underline-offset-3 cursor-pointer"
                onClick={() => {
                  window.location.href = `mailto:${config.supportEmail}?subject=Enterprise%20MAU%20limit`;
                }}
              >
                Contact sales
              </label>{" "}
              to increase your plan.
            </p>
          </div>
        );
      }
      return;
    }
    // Free tier — show upgrade banner if over limit
    if (getCurrentTotalMauValue() - getCurrentMauValue() < 0) {
      return (
        <div
          className="w-full bg-destructive-secondary dark:bg-destructive p-2 flex items-center justify-center cursor-pointer"
          onClick={() => {
            router.replace(returnUrlWithParams("/settings"));
          }}
        >
          <p className="text-sm text-destructive text-center dark:text-foreground">
            Monthly usage limit reached.{" "}
            <label className="underline underline-offset-3 cursor-pointer">
              Upgrade now
            </label>{" "}
            to avoid service disruption.
          </p>
        </div>
      );
    }
  };

  const showTestStyle = projectType === TEST && !hideEnvSelect;

  return (
    <div
      className={cn(
        "flex flex-col sticky top-[0px] z-25 backdrop-blur-md",
        !showTestStyle && "bg-background/80"
      )}
      style={
        showTestStyle
          ? {
              background:
                resolvedTheme === "dark"
                  ? "linear-gradient(270deg, rgba(80, 160, 255, 0.08) 0%, rgba(80, 160, 255, 0.02) 100%)"
                  : "linear-gradient(270deg, rgba(42, 134, 255, 0.08) 0%, rgba(42, 134, 255, 0.02) 100%)",
            }
          : undefined
      }
    >
      {displayLimitReach()}
      <div className="flex flex-row items-center h-16 px-6 gap-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" />
        <div className="flex-1 flex items-center overflow-x-auto">
          <Breadcrumb className="flex items-center">
            <BreadcrumbList>
              {pathSegments.map((segment, idx) => {
                const { label } = segment;
                const href =
                  "/" +
                  pathSegments
                    .slice(0, idx + 1)
                    .map((s) => s.slug)
                    .join("/");
                const isLast = idx === pathSegments.length - 1;
                const isSecondLast = idx === pathSegments.length - 2;

                const lastSegment =
                  pathSegments[pathSegments.length - 1]?.slug ?? "";
                const shouldLink = isSecondLast && /^[0-9]/.test(lastSegment);

                const currentSearch = searchParams.toString();
                const hrefWithParams = currentSearch
                  ? `${href}/?${currentSearch}`
                  : `${href}/`;

                const hasOverride = segment.slug in breadcrumbLabelOverrides;
                const computedLabel = label;

                const displayLabel =
                  isLast && titleOverride ? titleOverride : computedLabel;

                return (
                  <React.Fragment key={href}>
                    <BreadcrumbItem>
                      {shouldLink ? (
                        <BreadcrumbLink
                          href={hrefWithParams}
                          className={hasOverride ? undefined : "capitalize"}
                        >
                          {displayLabel}
                        </BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage
                          className={hasOverride ? undefined : "capitalize"}
                        >
                          {displayLabel}
                        </BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                    {!isLast && <BreadcrumbSeparator />}
                  </React.Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        <div className="flex items-center gap-4 ml-auto">
          {!hideEnvSelect && (
            <Select
              value={projectType}
              onValueChange={(value) => setProjectType(value)}
            >
              <SelectTrigger
                className={cn(
                  "w-auto border-none shadow-none",
                  showTestStyle
                    ? "bg-blue-500/10 text-foreground dark:bg-blue-400/10"
                    : "bg-secondary text-secondary-foreground"
                )}
              >
                <div className="flex items-center gap-2">
                  {projectType === PRODUCTION && <Earth className="w-4 h-4" />}
                  {projectType === TEST && (
                    <TestTubeDiagonal className="w-4 h-4" />
                  )}
                  <span>{projectType}</span>
                </div>
                <Separator orientation="vertical" className="ml-auto" />
                {!projectType && <SelectValue placeholder="Select Env" />}
              </SelectTrigger>
              <SelectContent className="bg-secondary border-none p-1 min-w-[240px]">
                <SelectGroup>
                  <SelectLabel className="text-xs text-muted-foreground px-2 pb-1">
                    Environment
                  </SelectLabel>
                  <SelectPrimitive.Item
                    value={PRODUCTION}
                    className="relative flex w-full cursor-default items-center gap-3 rounded-md px-3 py-2.5 text-sm outline-hidden select-none focus:bg-background data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                  >
                    <Earth className="w-4 h-4 text-muted-foreground shrink-0" />
                    <SelectPrimitive.ItemText>
                      <div className="flex flex-col">
                        <span>Production</span>
                        <span className="text-xs text-muted-foreground font-normal">
                          Live data from real users
                        </span>
                      </div>
                    </SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="ml-auto shrink-0">
                      <div className="flex items-center justify-center h-5 w-5 rounded-full bg-muted-foreground/20">
                        <Check
                          className="h-3 w-3 text-foreground"
                          strokeWidth={2.5}
                        />
                      </div>
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                  <SelectPrimitive.Item
                    value={TEST}
                    className="relative flex w-full cursor-default items-center gap-3 rounded-md px-3 py-2.5 text-sm outline-hidden select-none focus:bg-background data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                  >
                    <TestTubeDiagonal className="w-4 h-4 text-muted-foreground shrink-0" />
                    <SelectPrimitive.ItemText>
                      <div className="flex flex-col">
                        <span>Test</span>
                        <span className="text-xs text-muted-foreground font-normal">
                          Sandbox for testing and development
                        </span>
                      </div>
                    </SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="ml-auto shrink-0">
                      <div className="flex items-center justify-center h-5 w-5 rounded-full bg-muted-foreground/20">
                        <Check
                          className="h-3 w-3 text-foreground"
                          strokeWidth={2.5}
                        />
                      </div>
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          {rightContent}
        </div>
      </div>
    </div>
  );
}
