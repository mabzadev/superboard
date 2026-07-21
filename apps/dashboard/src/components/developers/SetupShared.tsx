"use client";

import React, { useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Check, ChevronLeft, ChevronRight, Circle, Save } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Attaches a native DOM click listener to bypass React's synthetic event dispatch,
 * which can crash with SecurityError when cross-origin iframes (GTM, Chatwoot) are on the page.
 * Returns a callback ref to attach to the button element.
 */
function useNativeClick(handler: (() => void) | undefined) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  // Stable listener function — never changes identity so removeEventListener works
  const listenerRef = useRef<(e: Event) => void>(null!);
  if (!listenerRef.current) {
    listenerRef.current = (e: Event) => {
      e.stopPropagation();
      handlerRef.current?.();
    };
  }

  const elRef = useRef<HTMLButtonElement | null>(null);

  const setRef = useCallback((el: HTMLButtonElement | null) => {
    const listener = listenerRef.current!;
    if (elRef.current) {
      elRef.current.removeEventListener("click", listener);
    }
    if (el) {
      el.addEventListener("click", listener);
    }
    elRef.current = el;
  }, []);

  return setRef;
}
import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockHeader,
  CodeBlockItem,
} from "@/components/ui/shadcn-io/code-block";
import type { BundledLanguage } from "shiki";

// --- Types ---

export type StepDef = {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  optional: boolean;
};

export type CodeBlockData = {
  language: string;
  filename: string;
  code: string;
  highlightLines?: number[];
};

// --- RenderCodeBlock ---

export function RenderCodeBlock({ data }: { data: CodeBlockData[] }) {
  return (
    <CodeBlock data={data} defaultValue={data[0]?.language ?? ""}>
      <CodeBlockHeader>
        <CodeBlockFiles>
          {(item) => (
            <CodeBlockFilename key={item.language} value={item.language}>
              {item.filename}
            </CodeBlockFilename>
          )}
        </CodeBlockFiles>
        <CodeBlockCopyButton onCopy={() => {}} onError={() => {}} />
      </CodeBlockHeader>
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem key={item.language} value={item.language}>
            <CodeBlockContent
              syntaxHighlighting
              themes={{ light: "github-light", dark: "github-dark" }}
              language={item.language as BundledLanguage}
            >
              {item.code}
            </CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  );
}

// --- SectionHeader ---

export function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  badge,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-muted shrink-0">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{title}</span>
          {badge}
        </div>
        <span className="text-xs text-muted-foreground leading-snug">
          {subtitle}
        </span>
      </div>
      {action}
    </div>
  );
}

// --- OverviewRow ---

export function OverviewRow({
  title,
  description,
  configured,
  action,
}: {
  title: string;
  description: string;
  configured: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div
        className={cn(
          "flex items-center justify-center h-7 w-7 rounded-lg shrink-0",
          configured
            ? "bg-valid-green-light-2 text-valid-green"
            : "bg-muted text-muted-foreground"
        )}
      >
        {configured ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Circle className="h-3.5 w-3.5" />
        )}
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      {action}
    </div>
  );
}

// --- WizardSidebar ---

export function WizardSidebar({
  platformLabel,
  steps,
  currentStep,
  visitedSteps,
  stepCompleted,
  sdkConfigured,
  onStepClick,
  onOverview,
}: {
  platformLabel: string;
  steps: readonly StepDef[];
  currentStep: number;
  visitedSteps: Set<number>;
  stepCompleted: boolean[];
  sdkConfigured: boolean;
  onStepClick: (step: number) => void;
  onOverview: () => void;
}) {
  const completedCount = stepCompleted.filter(Boolean).length;
  const progressPercent = Math.round((completedCount / steps.length) * 100);

  return (
    <div className="w-[280px] shrink-0 bg-sidebar/50 border-r border-sidebar-border flex flex-col">
      <div className="px-4 pt-5 pb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {platformLabel}
          </span>
          <span className="text-xs text-muted-foreground">
            {completedCount}/{steps.length} complete
          </span>
        </div>
        <Progress
          value={progressPercent}
          className="h-1.5"
          indicatorClassName="bg-valid-green"
        />
      </div>

      <div className="flex-1 overflow-auto px-2 pb-2">
        <div className="flex flex-col gap-0.5">
          {steps.map((step, index) => {
            const isActive = currentStep === index;
            const isCompleted = stepCompleted[index];
            const isAccessible = visitedSteps.has(index);

            return (
              <button
                key={step.name}
                type="button"
                onClick={() => isAccessible && onStepClick(index)}
                disabled={!isAccessible}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors w-full",
                  isActive
                    ? "bg-accent"
                    : isAccessible
                      ? "hover:bg-accent/50"
                      : "opacity-50 cursor-not-allowed"
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-center h-7 w-7 rounded-lg text-xs font-semibold shrink-0 transition-colors",
                    isCompleted
                      ? "bg-valid-green-light-2 text-valid-green"
                      : isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {isCompleted ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </div>
                <div className="flex flex-col min-w-0">
                  <span
                    className={cn(
                      "text-sm leading-tight truncate",
                      isActive
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {step.name}
                  </span>
                  {step.optional && (
                    <span className="text-[10px] text-muted-foreground/70">
                      Optional
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {sdkConfigured && (
        <div className="px-3 pb-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={onOverview}
          >
            Exit guide
          </Button>
        </div>
      )}
    </div>
  );
}

// --- StepNavigation ---

export function StepNavigation({
  currentStep,
  totalSteps,
  isOptional,
  hasChanges,
  isInteractive,
  isSaving,
  onBack,
  onContinue,
  onSaveAndContinue,
  onSkip,
  onFinish,
}: {
  currentStep: number;
  totalSteps: number;
  isOptional?: boolean;
  hasChanges: boolean;
  isInteractive: boolean;
  isSaving?: boolean;
  onBack: () => void;
  onContinue: () => void;
  onSaveAndContinue: () => void;
  onSkip?: () => void;
  onFinish: () => void;
}) {
  const isLastStep = currentStep === totalSteps - 1;

  // Native click listeners bypass React's synthetic event dispatch, which crashes
  // with SecurityError when cross-origin iframes (GTM, Chatwoot) are on the page.
  const backRef = useNativeClick(onBack);
  const continueRef = useNativeClick(onContinue);
  const saveAndContinueRef = useNativeClick(onSaveAndContinue);
  const finishHandler =
    isInteractive && hasChanges ? onSaveAndContinue : onFinish;
  const finishRef = useNativeClick(finishHandler);
  const skipRef = useNativeClick(onSkip);

  return (
    <div className="border-t border-sidebar-border bg-card px-6 py-3 flex items-center justify-between">
      <div>
        {currentStep > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="pl-2 pr-4"
            ref={backRef}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </Button>
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        Step {currentStep + 1} of {totalSteps}
      </span>
      <div className="flex items-center gap-2">
        {isOptional && onSkip && (
          <Button variant="ghost" size="sm" ref={skipRef}>
            Skip
          </Button>
        )}
        {isLastStep ? (
          <Button
            size="sm"
            className="pl-3 pr-4"
            disabled={isSaving}
            ref={finishRef}
          >
            {isInteractive && hasChanges ? (
              <>
                <Save className="h-3.5 w-3.5" />
                {isSaving ? "Saving…" : "Save & Finish"}
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                Finish Setup
              </>
            )}
          </Button>
        ) : isInteractive && hasChanges ? (
          <Button
            size="sm"
            className="pl-3 pr-4"
            disabled={isSaving}
            ref={saveAndContinueRef}
          >
            <Save className="h-3.5 w-3.5" />
            {isSaving ? "Saving…" : "Save & Continue"}
          </Button>
        ) : (
          <Button size="sm" className="pl-3 pr-4" ref={continueRef}>
            Continue
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
