"use client";
import AppHeader from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WEB } from "@/constants/OptionsConstants";
import { trackEvent, EVENTS } from "@/analytics";

import { Code2, Eye, Globe, Package, Pencil, Save, Trash2 } from "lucide-react";
import {
  OverviewRow,
  WizardSidebar,
  StepNavigation,
} from "@/components/developers/SetupShared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  showErrorNotification,
  showGenericError,
  showSuccessNotification,
} from "@/lib/Notifications";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useInstanceConfigQuery } from "@/hooks/queries/useInstanceQueries";
import {
  useSetWebConfigMutation,
  useRemoveWebConfigMutation,
} from "@/hooks/mutations/useInstanceMutations";
import { WEB_SETUP_CATEGORY } from "@/constants/SetupStepConstants";
import { useSetupProgress } from "@/hooks/useSetupProgress";
import { integrateWebSdkValue } from "@/lib/WebPageConstants";
import { deepClone, deepEqual } from "@/lib/utils";
import { isDomainValid } from "@/lib/domainValidation";
import type { PlatformAppConfig } from "@/types";
import Step0RegisterDomains from "./steps/Step0RegisterDomains";
import Step1AddSDK from "./steps/Step1AddSDK";
import Step2IntegrateSDK from "./steps/Step2IntegrateSDK";

const STEPS = [
  {
    name: "Register Domains",
    identifier: "register_domains",
    icon: Globe,
    optional: false,
  },
  {
    name: "Add the SDK",
    identifier: "add_sdk",
    icon: Package,
    optional: false,
  },
  {
    name: "Integrate the SDK",
    identifier: "integrate_sdk",
    icon: Code2,
    optional: false,
  },
] as const;

const STEP_IDENTIFIERS = STEPS.map((s) => s.identifier);
const ALL_STEP_INDICES = new Set(STEPS.map((_, i) => i));

const SetupOverview = ({
  stepCompleted,
  webConfig: _webConfig,
  domainList,
  onRunSetup,
  onEditStep,
  onRemoveRegistration,
}: {
  stepCompleted: boolean[];
  webConfig: PlatformAppConfig | null;
  domainList: string[];
  onRunSetup: () => void;
  onEditStep: (step: number) => void;
  onRemoveRegistration: () => void;
}) => {
  return (
    <div className="flex-1 overflow-auto">
      <div className="flex flex-col gap-6 px-6 py-6 max-w-[800px]">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-muted shrink-0">
            <Globe className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-sm font-semibold">Web Setup</span>
            <span className="text-xs text-muted-foreground">
              Your Web SDK is configured and ready to use.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
              onClick={onRemoveRegistration}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="pl-3 pr-4"
              onClick={onRunSetup}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit Setup
            </Button>
          </div>
        </div>

        {/* Required */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1 mb-1">
            Required
          </span>
          <div className="rounded-xl border border-sidebar-border bg-card divide-y divide-sidebar-border">
            <OverviewRow
              title="Register Domains"
              description={
                domainList.length > 0 ? domainList.join(", ") : "Not configured"
              }
              configured={stepCompleted[0] ?? false}
              action={
                <Button variant="ghost" size="sm" onClick={() => onEditStep(0)}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              }
            />
            <OverviewRow
              title="Add the SDK"
              description={stepCompleted[1] ? "NPM" : "Not installed"}
              configured={stepCompleted[1] ?? false}
              action={
                <Button variant="ghost" size="sm" onClick={() => onEditStep(1)}>
                  <Eye className="h-3.5 w-3.5" />
                  View
                </Button>
              }
            />
            <OverviewRow
              title="Integrate the SDK"
              description={stepCompleted[2] ? "Code ready" : "Not configured"}
              configured={stepCompleted[2] ?? false}
              action={
                <Button variant="ghost" size="sm" onClick={() => onEditStep(2)}>
                  <Eye className="h-3.5 w-3.5" />
                  View
                </Button>
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};

const WebSetupPage = () => {
  const { selectedInstance } = useProjectSelection();
  const { data: instanceConfig } = useInstanceConfigQuery(selectedInstance?.id);
  const webConfigMutation = useSetWebConfigMutation(selectedInstance?.id);
  const removeWebConfigMutation = useRemoveWebConfigMutation(
    selectedInstance?.id
  );

  const router = useRouter();
  const [domainList, setDomainList] = useState<string[]>([]);
  const [webConfig, setWebConfig] = useState<PlatformAppConfig | null>(null);
  const [detailsChanged, setDetailsChanged] = useState<boolean>(false);

  const [showErrors, setShowErrors] = useState(false);

  // Wizard state
  const [currentStep, setCurrentStep] = useState(0);
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(new Set([0]));
  const [wizardMode, setWizardMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    walkedSteps,
    markStepComplete,
    reset: resetProgress,
  } = useSetupProgress(
    selectedInstance?.id,
    WEB_SETUP_CATEGORY,
    STEP_IDENTIFIERS
  );
  // Unsaved changes dialog
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const pendingNavigationRef = useRef<(() => void) | null>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  // Ref for handleSetWebConfiguration used inside useCallback to avoid stale closures
  const handleSetWebConfigurationRef = useRef<
    (id: string, enabled: boolean, domains: string[], cb?: () => void) => void
  >(null!);

  const sdkConfigured = (webConfig?.configuration?.domains?.length ?? 0) > 0;

  // Wizard sidebar: green when saved (interactive) or walked through (read-only)
  const stepCompleted = [
    sdkConfigured, // Step 0: Register Domains (requires save)
    walkedSteps.has(1), // Step 1: Add the SDK
    walkedSteps.has(2), // Step 2: Integrate the SDK
  ];

  // Overview: server-based completion for showing configured status
  const overviewCompleted = [sdkConfigured, sdkConfigured, sdkConfigured];

  // Per-step change tracking
  const stepHasChanges = useCallback(
    (step: number): boolean => {
      switch (step) {
        case 0:
          return detailsChanged;
        default:
          return false;
      }
    },
    [detailsChanged]
  );

  const stepIsInteractive = (step: number): boolean => {
    return [0].includes(step);
  };

  const stepFormValid = useCallback(
    (step: number): boolean => {
      switch (step) {
        case 0:
          return domainList.some((d) => isDomainValid(d));
        default:
          return true;
      }
    },
    [domainList]
  );

  const hasAnyChanges = detailsChanged;

  // Code blocks
  const integrate_web_sdk_code = [
    {
      highlightLines: [6, 8, 9],
      language: "jsx",
      filename: "index.jsx",
      code: integrateWebSdkValue.replace(
        "_OPENGROW_API_KEY_",
        selectedInstance?.api_key ?? "YOUR_API_KEY"
      ),
    },
  ];

  const handleRemoveDomain = (index: number) => {
    const list = deepClone(domainList);
    list.splice(index, 1);
    setDomainList(list);
  };

  const handleSetWebConfiguration = async (
    _instanceId: string,
    enabled: boolean,
    domains: string[],
    onSuccess?: () => void
  ) => {
    try {
      if (!enabled && domains.length === 0) {
        await removeWebConfigMutation.mutateAsync();
        setWebConfig(null);
        resetProgress();
        showSuccessNotification("Domain registration removed");
      } else {
        const response = await webConfigMutation.mutateAsync({
          enabled,
          domains,
        });
        setWebConfig(response.data.config);
        trackEvent(EVENTS.SDK_INTEGRATED, { platform: "web" });
        showSuccessNotification("Domain registration saved");
      }

      onSuccess?.();
    } catch {
      showGenericError();
    }
  };

  // Keep ref in sync so useCallback closure always calls the latest version
  handleSetWebConfigurationRef.current = handleSetWebConfiguration;

  const handleSaveConfiguration = useCallback(
    (instanceId: string, domains: string[], onSuccess?: () => void) => {
      let enabled = false;
      if (webConfig) {
        enabled = webConfig.enabled ?? false;
      }
      handleSetWebConfigurationRef.current(
        instanceId,
        enabled,
        domains,
        onSuccess
      );
    },
    [webConfig]
  );

  const monitorDetailsChanged = useCallback(
    (config: PlatformAppConfig | null) => {
      if (!config) {
        if (!deepEqual(domainList, [])) {
          setDetailsChanged(true);
        } else {
          setDetailsChanged(false);
        }
      } else if (!deepEqual(domainList, config?.configuration?.domains)) {
        setDetailsChanged(true);
      } else {
        setDetailsChanged(false);
      }
    },
    [domainList]
  );

  const initializeValues = (config: PlatformAppConfig | null) => {
    if (!config) {
      setDomainList([]);
    } else {
      setDomainList(config.configuration?.domains ?? []);
    }
  };

  // Guard navigation: if there are unsaved changes, show dialog instead of navigating
  const guardNavigation = useCallback(
    (action: () => void) => {
      if (stepHasChanges(currentStep)) {
        pendingNavigationRef.current = action;
        setUnsavedDialogOpen(true);
      } else {
        action();
      }
    },
    [currentStep, stepHasChanges]
  );

  const handleDiscardAndNavigate = useCallback(() => {
    setUnsavedDialogOpen(false);
    initializeValuesRef.current(webConfig);
    pendingNavigationRef.current?.();
    pendingNavigationRef.current = null;
  }, [webConfig]);

  const handleSaveAndNavigate = useCallback(() => {
    const navigate = pendingNavigationRef.current;
    if (currentStep === 0) {
      const nonEmpty = domainList.filter((d) => d.length > 0);
      if (nonEmpty.length === 0 || nonEmpty.some((d) => !isDomainValid(d))) {
        setUnsavedDialogOpen(false);
        pendingNavigationRef.current = null;
        setShowErrors(true);
        return;
      }
    }
    setUnsavedDialogOpen(false);
    pendingNavigationRef.current = null;
    if (!selectedInstance) return;
    switch (currentStep) {
      case 0:
        handleSaveConfiguration(
          selectedInstance.id,
          domainList.filter((d) => d.length > 0),
          () => navigate?.()
        );
        break;
      default:
        navigate?.();
    }
  }, [currentStep, selectedInstance, domainList, handleSaveConfiguration]);

  // Guard all navigation when there are unsaved changes
  useEffect(() => {
    if (!hasAnyChanges) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      try {
        const url = new URL(href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname) return;
      } catch {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      pendingNavigationRef.current = () => router.push(href);
      setUnsavedDialogOpen(true);
    };

    const handlePopState = () => {
      window.history.pushState(null, "", window.location.href);
      pendingNavigationRef.current = () => window.history.back();
      setUnsavedDialogOpen(true);
    };

    window.history.pushState(null, "", window.location.href);

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleClick, true);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [hasAnyChanges, router]);

  // Mark all steps visited for returning users, auto-enter wizard for first-time
  useEffect(() => {
    if (!instanceConfig) return;
    if (sdkConfigured) {
      setVisitedSteps(ALL_STEP_INDICES);
    } else {
      setCurrentStep(0);
      setVisitedSteps(new Set([0]));
      setWizardMode(true);
    }
  }, [sdkConfigured, instanceConfig]);

  const goToStep = useCallback(
    (step: number) => {
      const doNavigate = () => {
        setCurrentStep(step);
        setVisitedSteps((prev) => new Set([...prev, step]));
      };

      guardNavigation(doNavigate);
    },
    [guardNavigation]
  );

  const advanceStep = useCallback(
    (fromStep?: number) => {
      const step = fromStep ?? currentStep;
      // If fromStep is specified, only advance if we're still on that step
      // (prevents double-advances from async callbacks)
      if (fromStep !== undefined && fromStep !== currentStep) return;

      if (step === 0 && !sdkConfigured && !stepFormValid(0)) {
        setShowErrors(true);
        return;
      }
      const nextStep = step + 1;
      if (nextStep < STEPS.length) {
        markStepComplete(step);
        setVisitedSteps((vs) => new Set([...vs, nextStep]));
        setCurrentStep(nextStep);
      }
    },
    [currentStep, stepFormValid, sdkConfigured, markStepComplete]
  );

  const enterWizardAtStep = useCallback(
    (step: number) => {
      markStepComplete(step);
      setCurrentStep(step);
      setVisitedSteps(ALL_STEP_INDICES);
      setWizardMode(true);
    },
    [markStepComplete]
  );

  const validateDomains = (): boolean => {
    const nonEmpty = domainList.filter((d) => d.length > 0);
    if (nonEmpty.length === 0 || nonEmpty.some((d) => !isDomainValid(d))) {
      setShowErrors(true);
      return false;
    }
    setShowErrors(false);
    return true;
  };

  const handleSaveAndContinue = () => {
    if (!selectedInstance || webConfigMutation.isPending) return;
    const stepToAdvance = currentStep;
    switch (currentStep) {
      case 0:
        if (!validateDomains()) return;
        handleSaveConfiguration(
          selectedInstance.id,
          domainList.filter((d) => d.length > 0),
          () => advanceStep(stepToAdvance)
        );
        break;
      default:
        advanceStep();
    }
  };

  const handleFinish = () => {
    markStepComplete(currentStep);
    if (sdkConfigured) {
      showSuccessNotification("Web setup complete!");
      setWizardMode(false);
    } else {
      showErrorNotification(
        "Register your domains in step 1 to complete setup."
      );
      setCurrentStep(0);
      setVisitedSteps(ALL_STEP_INDICES);
    }
  };

  // Ref for initializeValues to avoid adding it to dependency arrays
  const initializeValuesRef = useRef(initializeValues);
  initializeValuesRef.current = initializeValues;

  // Reset all state when project/instance changes
  useEffect(() => {
    if (!selectedInstance) return;
    setWebConfig(null);
    setCurrentStep(0);
    setVisitedSteps(new Set([0]));
    setWizardMode(false);
    setDetailsChanged(false);
    initializeValuesRef.current(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset when instance ID changes, not on every selectedInstance reference change
  }, [selectedInstance?.id]);

  useEffect(() => {
    if (!instanceConfig) {
      return;
    }
    const found = instanceConfig.find(
      (config: PlatformAppConfig) => config.platform === WEB
    );
    if (instanceConfig.length > 0 && found) {
      setWebConfig(found);
      initializeValuesRef.current(found);
    } else {
      setWebConfig(null);
      initializeValuesRef.current(null);
    }
  }, [instanceConfig]);

  useEffect(() => {
    monitorDetailsChanged(webConfig);
  }, [monitorDetailsChanged, webConfig]);

  // Scroll to top when step changes
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentStep]);

  return (
    <div className="flex flex-col relative overflow-hidden h-dvh">
      <div className="border-b border-sidebar-border">
        <AppHeader hideEnvSelect />
      </div>

      {/* Overview mode */}
      {sdkConfigured && !wizardMode ? (
        <SetupOverview
          stepCompleted={overviewCompleted}
          webConfig={webConfig}
          domainList={domainList}
          onRunSetup={() => {
            setCurrentStep(0);
            setVisitedSteps(ALL_STEP_INDICES);
            setWizardMode(true);
          }}
          onEditStep={enterWizardAtStep}
          onRemoveRegistration={() => setRemoveDialogOpen(true)}
        />
      ) : (
        /* Wizard mode */
        <div className="flex flex-1 overflow-hidden">
          <WizardSidebar
            platformLabel="Web Setup"
            steps={STEPS}
            currentStep={currentStep}
            visitedSteps={visitedSteps}
            stepCompleted={stepCompleted}
            sdkConfigured={sdkConfigured}
            onStepClick={goToStep}
            onOverview={() => guardNavigation(() => setWizardMode(false))}
          />

          <div className="flex flex-col overflow-hidden min-w-0 flex-1">
            {/* Step Content */}
            <div className="flex-1 overflow-auto" ref={scrollRef}>
              <div className="flex flex-col gap-0 px-6 py-6 max-w-[800px]">
                {/* Step 0: Register Domains */}
                {currentStep === 0 && (
                  <Step0RegisterDomains
                    domainList={domainList}
                    setDomainList={setDomainList}
                    showErrors={showErrors}
                    setShowErrors={setShowErrors}
                    onRemoveDomain={handleRemoveDomain}
                  />
                )}

                {/* Step 1: Add the SDK */}
                {currentStep === 1 && <Step1AddSDK />}

                {/* Step 2: Integrate the SDK */}
                {currentStep === 2 && (
                  <Step2IntegrateSDK
                    integrateWebSdkCode={integrate_web_sdk_code}
                  />
                )}
              </div>
            </div>

            {/* Step Navigation */}
            <StepNavigation
              currentStep={currentStep}
              totalSteps={STEPS.length}
              hasChanges={stepHasChanges(currentStep)}
              isInteractive={stepIsInteractive(currentStep)}
              isSaving={webConfigMutation.isPending}
              onBack={() => goToStep(currentStep - 1)}
              onContinue={advanceStep}
              onSaveAndContinue={handleSaveAndContinue}
              onFinish={handleFinish}
            />
          </div>
        </div>
      )}

      {/* Unsaved changes dialog */}
      <Dialog
        open={unsavedDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setUnsavedDialogOpen(false);
            pendingNavigationRef.current = null;
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              You have unsaved changes on this step. Would you like to save them
              before leaving?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
              onClick={handleDiscardAndNavigate}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Discard
            </Button>
            <Button size="sm" onClick={handleSaveAndNavigate}>
              <Save className="h-3.5 w-3.5" />
              Save & Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove registration dialog */}
      <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove domain registration</DialogTitle>
            <DialogDescription>
              This will clear all registered domains and disable the Web SDK for
              this app. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRemoveDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                setRemoveDialogOpen(false);
                if (selectedInstance)
                  handleSetWebConfiguration(selectedInstance.id, false, []);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default WebSetupPage;
