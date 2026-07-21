"use client";

import React from "react";
import {
  ArrowRight,
  Check,
  Globe,
  Link2,
  Lock,
  Megaphone,
  PencilRuler,
  Rocket,
  X,
} from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useDismissGetStartedMutation } from "@/hooks/mutations/useInstanceMutations";
import { showErrorNotification } from "@/lib/Notifications";
import { ApiError } from "@/lib/ApiError";
import { useRouter } from "next/navigation";
import { Button } from "../ui/button";
import androidIcon from "@/assets/icons/generic/Android.svg";
import androidIconDark from "@/assets/icons/generic/Android_dark_mode.svg";
import iosIcon from "@/assets/icons/generic/Apple.svg";
import iosIconDark from "@/assets/icons/generic/Apple_dark_mode.svg";
import { useTheme } from "next-themes";

/* ─── Action row ─── */
function ActionRow({
  icon,
  label,
  subtitle,
  checked,
  enabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  checked?: boolean;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={!enabled}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-all group w-full",
        checked
          ? "border-sidebar-border bg-white dark:bg-card"
          : enabled
            ? "border-sidebar-border bg-white dark:bg-card hover:border-foreground/15 cursor-pointer"
            : "border-sidebar-border/60 bg-white/40 dark:bg-card/40 cursor-not-allowed opacity-50"
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center h-8 w-8 rounded-lg shrink-0 border",
          checked
            ? "bg-white dark:bg-card border-foreground/[0.06]"
            : "bg-white/70 dark:bg-card/70 border-foreground/[0.06]"
        )}
      >
        {icon}
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <span
          className={cn(
            "text-sm font-medium truncate text-foreground",
            checked && "line-through opacity-40"
          )}
        >
          {label}
        </span>
        <span className="text-xs text-muted-foreground truncate">
          {subtitle}
        </span>
      </div>
      {checked ? (
        <div className="flex items-center justify-center h-5 w-5 rounded-full bg-foreground shrink-0">
          <Check className="h-3 w-3 text-background" strokeWidth={2.5} />
        </div>
      ) : enabled ? (
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 transition-colors" />
      ) : (
        <Lock className="h-3 w-3 text-muted-foreground/30 shrink-0" />
      )}
    </button>
  );
}

/* ─── Step header ─── */
function StepHeader({
  number,
  title,
  subtitle,
  done,
  active,
  enabled,
}: {
  number: number;
  title: string;
  subtitle: string;
  done: boolean;
  active: boolean;
  enabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div
        className={cn(
          "flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold shrink-0",
          done
            ? "bg-foreground text-background"
            : active
              ? "bg-foreground text-background"
              : "bg-foreground/[0.06] text-foreground/30 border border-foreground/[0.06]"
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : number}
      </div>
      <div className="flex flex-col">
        <span
          className={cn(
            "text-sm font-semibold text-foreground",
            !enabled && "opacity-30"
          )}
        >
          {title}
        </span>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </div>
    </div>
  );
}

/* ─── Main ─── */
const QuickStartGuide = () => {
  const { selectedInstance, getStartedSetup, setSelectedInstance } =
    useProjectSelection();
  const dismissGetStartedMutation = useDismissGetStartedMutation();

  const router = useRouter();
  const { resolvedTheme } = useTheme();

  const integrationDone = !!(
    getStartedSetup?.ios_sdk ||
    getStartedSetup?.android_sdk ||
    getStartedSetup?.web_sdk
  );
  const configurationDone = !!getStartedSetup?.redirect_fallback;
  const createDone = !!(
    getStartedSetup?.has_created_links || getStartedSetup?.has_created_campaigns
  );

  const canConfigure = integrationDone;
  const canCreate = canConfigure && configurationDone;

  const completedCount = [
    integrationDone,
    configurationDone,
    createDone,
  ].filter(Boolean).length;
  const activeStep = !integrationDone
    ? 0
    : !configurationDone
      ? 1
      : !createDone
        ? 2
        : -1;

  const handleDismissGetStarted = async () => {
    if (!selectedInstance) return;
    try {
      const response = await dismissGetStartedMutation.mutateAsync({
        id: selectedInstance.id,
      });
      setSelectedInstance(response.data.instance);
    } catch (error) {
      showErrorNotification(
        error instanceof ApiError
          ? error.message
          : "Something went wrong, please try again"
      );
    }
  };

  const navigate = (navigateTo: string) => {
    const currentParams = new URLSearchParams(window.location.search);
    router.replace(`${navigateTo}?${currentParams.toString()}`);
  };

  return (
    <div
      className="relative rounded-xl overflow-hidden border border-sidebar-border"
      style={{
        background:
          resolvedTheme === "dark"
            ? "linear-gradient(180deg, rgba(60, 90, 140, 0.15) 0%, rgba(140, 100, 70, 0.10) 100%)"
            : "linear-gradient(180deg, rgba(190, 218, 252, 0.25) 0%, rgba(255, 233, 216, 0.25) 100%)",
      }}
    >
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start gap-4 mb-5">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-foreground shrink-0">
            <Rocket className="h-5 w-5 text-background" />
          </div>
          <div className="flex flex-col gap-0.5 flex-1">
            <h3 className="text-lg font-semibold text-foreground tracking-tight">
              Get started with Grovs
            </h3>
            <p className="text-sm text-muted-foreground">
              Integrate your app, configure redirect rules, and create your
              first dynamic link.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground/50 hover:text-foreground hover:bg-foreground/5"
            onClick={handleDismissGetStarted}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Progress */}
        <div className="flex gap-1.5 mb-6">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-1 flex-1 rounded-full bg-foreground/[0.06] overflow-hidden"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  i < completedCount ? "bg-foreground w-full" : "w-0"
                )}
              />
            </div>
          ))}
        </div>

        {/* Steps */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Step 1 */}
          <div className="flex flex-col">
            <StepHeader
              number={1}
              title="Integrate"
              subtitle="Connect at least one SDK"
              done={integrationDone}
              active={activeStep === 0}
              enabled={true}
            />
            <div className="flex flex-col gap-1.5">
              <ActionRow
                icon={
                  <Image
                    src={resolvedTheme === "dark" ? iosIconDark : iosIcon}
                    alt="ios"
                    width={14}
                    height={16}
                    className="w-3.5 h-4"
                  />
                }
                label="iOS SDK"
                subtitle="CocoaPods, SPM, Flutter, or React Native"
                checked={getStartedSetup?.ios_sdk}
                enabled={true}
                onClick={() => navigate("/developers/ios_setup")}
              />
              <ActionRow
                icon={
                  <Image
                    src={
                      resolvedTheme === "dark" ? androidIconDark : androidIcon
                    }
                    alt="android"
                    width={16}
                    height={16}
                    className="w-4 h-4"
                  />
                }
                label="Android SDK"
                subtitle="Gradle, Flutter, or React Native"
                checked={getStartedSetup?.android_sdk}
                enabled={true}
                onClick={() => navigate("/developers/android_setup")}
              />
              <ActionRow
                icon={<Globe className="h-3.5 w-3.5" />}
                label="Web SDK"
                subtitle="NPM package for web apps"
                checked={getStartedSetup?.web_sdk}
                enabled={true}
                onClick={() => navigate("/developers/web_setup")}
              />
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex flex-col">
            <StepHeader
              number={2}
              title="Configure"
              subtitle="Set up link behaviour"
              done={configurationDone}
              active={activeStep === 1}
              enabled={canConfigure}
            />
            <div className="flex flex-col gap-1.5">
              <ActionRow
                icon={<PencilRuler className="h-3.5 w-3.5" />}
                label="Redirect Rules"
                subtitle="How links open per platform"
                checked={getStartedSetup?.redirect_fallback}
                enabled={canConfigure}
                onClick={() => navigate("/link_behaviour/redirect_rules")}
              />
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex flex-col">
            <StepHeader
              number={3}
              title="Create"
              subtitle="Your first links & campaigns"
              done={createDone}
              active={activeStep === 2}
              enabled={canCreate}
            />
            <div className="flex flex-col gap-1.5">
              <ActionRow
                icon={<Link2 className="h-3.5 w-3.5" />}
                label="Create a Link"
                subtitle="Your first dynamic link"
                checked={getStartedSetup?.has_created_links}
                enabled={canCreate}
                onClick={() => navigate("/dynamic_links/links")}
              />
              <ActionRow
                icon={<Megaphone className="h-3.5 w-3.5" />}
                label="Create a Campaign"
                subtitle="Group links for marketing"
                checked={getStartedSetup?.has_created_campaigns}
                enabled={canCreate}
                onClick={() => navigate("/dynamic_links/campaigns")}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickStartGuide;
