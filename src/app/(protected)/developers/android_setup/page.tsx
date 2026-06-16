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
import { ANDROID } from "@/constants/OptionsConstants";
import { trackEvent, EVENTS } from "@/analytics";

import {
  Bell,
  Code2,
  Eye,
  FileCode2,
  Package,
  Pencil,
  Save,
  Settings,
  Smartphone,
  Store,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { deepClone, deepEqual } from "@/lib/utils";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  useInstanceConfigQuery,
  useGoogleConfigScriptQuery,
} from "@/hooks/queries/useInstanceQueries";
import {
  useSetAndroidConfigMutation,
  useSetAndroidPushConfigMutation,
  useSetAndroidWebhookKeyMutation,
  useRemoveAndroidConfigMutation,
} from "@/hooks/mutations/useInstanceMutations";
import { ANDROID_SETUP_CATEGORY } from "@/constants/SetupStepConstants";
import { useSetupProgress } from "@/hooks/useSetupProgress";
import {
  useDomainConfigQuery,
  useCustomDomainsQuery,
} from "@/hooks/queries/useConfigurationQueries";
import {
  showErrorNotification,
  showGenericError,
  showSuccessNotification,
} from "@/lib/Notifications";
import { ApiError } from "@/lib/ApiError";
import { shaSchema } from "@/schemas/shared";
import { IS_ENTERPRISE } from "@/lib/edition";
import {
  googleCloudScript,
  sdkAndroidValue,
  sdkHandleDeepLinksValue,
  sdkLauncherActivityValue,
  sdkReactNativeAppValue,
} from "@/lib/AndroidPageConstants";
import {
  OverviewRow,
  WizardSidebar,
  StepNavigation,
} from "@/components/developers/SetupShared";
import Image from "next/image";
import androidIcon from "@/assets/icons/generic/Android.svg";
import type { PlatformAppConfig } from "@/types";
import Step0RegisterApp from "./steps/Step0RegisterApp";
import Step1IntentFilters from "./steps/Step1IntentFilters";
import Step2AddSDK from "./steps/Step2AddSDK";
import Step3PushNotifications from "./steps/Step3PushNotifications";
import Step4Revenue from "./steps/Step4Revenue";
import Step5InitializeSDK from "./steps/Step5InitializeSDK";

type AndroidStepName =
  | "Register App"
  | "Intent Filters"
  | "Add the SDK"
  | "Push Notifications"
  | "Revenue"
  | "Initialize SDK";

type Step = {
  readonly name: AndroidStepName;
  readonly identifier: string;
  readonly icon: LucideIcon;
  readonly optional: boolean;
};

const STEPS: Step[] = [
  {
    name: "Register App",
    identifier: "register_app",
    icon: Smartphone,
    optional: false,
  },
  {
    name: "Intent Filters",
    identifier: "intent_filters",
    icon: FileCode2,
    optional: false,
  },
  {
    name: "Add the SDK",
    identifier: "add_sdk",
    icon: Package,
    optional: false,
  },
  {
    name: "Push Notifications",
    identifier: "push_notifications",
    icon: Bell,
    optional: true,
  },
  ...(IS_ENTERPRISE
    ? ([
        {
          name: "Revenue",
          identifier: "google_play_notifications",
          icon: Store,
          optional: true,
        },
      ] satisfies Step[])
    : []),
  {
    name: "Initialize SDK",
    identifier: "initialize_sdk",
    icon: Code2,
    optional: false,
  },
];

const STEP_IDENTIFIERS = STEPS.map((s) => s.identifier);

const ALL_STEP_INDICES = new Set(STEPS.map((_, i) => i));

const SetupOverview = ({
  stepCompleted,
  androidConfig,
  packageName,
  onRunSetup,
  onEditStep,
  onRemoveRegistration,
}: {
  stepCompleted: boolean[];
  androidConfig: PlatformAppConfig | null;
  packageName: string;
  onRunSetup: () => void;
  onEditStep: (step: number) => void;
  onRemoveRegistration: () => void;
}) => {
  const pushConfig = androidConfig?.configuration?.push_configuration;
  const serverKey = androidConfig?.configuration?.server_api_key;
  const findStep = (name: AndroidStepName): number | null => {
    const idx = STEPS.findIndex((s) => s.name === name);
    return idx === -1 ? null : idx;
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="flex flex-col gap-6 px-6 py-6 max-w-[800px]">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-muted shrink-0">
            <Image
              src={androidIcon}
              alt="Android"
              width={20}
              height={20}
              className="w-5 h-5 dark:invert"
            />
          </div>
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-sm font-semibold">Android Setup</span>
            <span className="text-xs text-muted-foreground">
              Your Android SDK is configured and ready to use.
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
              title="Register App"
              description={packageName || "Not configured"}
              configured={stepCompleted[findStep("Register App")!] ?? false}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEditStep(findStep("Register App")!)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              }
            />
            <OverviewRow
              title="Intent Filters"
              description="Deep link routing"
              configured={stepCompleted[findStep("Intent Filters")!] ?? false}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEditStep(findStep("Intent Filters")!)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  View
                </Button>
              }
            />
            <OverviewRow
              title="Add the SDK"
              description="Gradle / NPM / Yarn"
              configured={stepCompleted[findStep("Add the SDK")!] ?? false}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEditStep(findStep("Add the SDK")!)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  View
                </Button>
              }
            />
            <OverviewRow
              title="Initialize SDK"
              description="Integration code"
              configured={stepCompleted[findStep("Initialize SDK")!] ?? false}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEditStep(findStep("Initialize SDK")!)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  View
                </Button>
              }
            />
          </div>
        </div>

        {/* Optional */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1 mb-1">
            Optional
          </span>
          <div className="rounded-xl border border-sidebar-border bg-card divide-y divide-sidebar-border">
            <OverviewRow
              title="Push Notifications"
              description={
                pushConfig
                  ? `Firebase: ${pushConfig.firebase_project_id}`
                  : "Not configured"
              }
              configured={
                stepCompleted[findStep("Push Notifications")!] ?? false
              }
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEditStep(findStep("Push Notifications")!)}
                >
                  {stepCompleted[findStep("Push Notifications")!] ? (
                    <Pencil className="h-3.5 w-3.5" />
                  ) : (
                    <Settings className="h-3.5 w-3.5" />
                  )}
                  {stepCompleted[findStep("Push Notifications")!]
                    ? "Edit"
                    : "Set up"}
                </Button>
              }
            />
            {IS_ENTERPRISE && (
              <OverviewRow
                title="Revenue"
                description={serverKey ? "Configured" : "Not configured"}
                configured={stepCompleted[findStep("Revenue")!] ?? false}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEditStep(findStep("Revenue")!)}
                  >
                    {stepCompleted[findStep("Revenue")!] ? (
                      <Pencil className="h-3.5 w-3.5" />
                    ) : (
                      <Settings className="h-3.5 w-3.5" />
                    )}
                    {stepCompleted[findStep("Revenue")!] ? "Edit" : "Set up"}
                  </Button>
                }
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const AndroidSetupPage = () => {
  const { selectedInstance, selectedProject } = useProjectSelection();
  // Captured once at mount so subsequent in-wizard navigation doesn't keep
  // snapping back to the deep-linked step.
  const searchParams = useSearchParams();
  const initialStepParam = useRef(searchParams.get("step"));
  const deepLinkAppliedRef = useRef(false);
  // Surface active custom subdomains and migrated hostnames as additional
  // app-link intent filters.
  const { data: domainsProd } = useCustomDomainsQuery(
    selectedInstance?.production?.id
  );
  const { data: domainsTest } = useCustomDomainsQuery(
    selectedInstance?.test?.id
  );
  const activeHost = (
    domains: typeof domainsProd,
    purpose: "primary" | "migration"
  ) =>
    domains?.find((d) => d.purpose === purpose && d.status === "active")
      ?.hostname ?? null;
  const customProdHost = activeHost(domainsProd, "primary");
  const customTestHost = activeHost(domainsTest, "primary");
  const migratedProdHost = activeHost(domainsProd, "migration");
  const migratedTestHost = activeHost(domainsTest, "migration");
  const hasCustomIntentFilters = Boolean(
    customProdHost || customTestHost || migratedProdHost || migratedTestHost
  );
  const { data: instanceConfig } = useInstanceConfigQuery(selectedInstance?.id);
  const androidConfigMutation = useSetAndroidConfigMutation(
    selectedInstance?.id
  );
  const removeAndroidConfigMutation = useRemoveAndroidConfigMutation(
    selectedInstance?.id
  );
  const androidPushConfigMutation = useSetAndroidPushConfigMutation(
    selectedInstance?.id
  );
  const androidWebhookKeyMutation = useSetAndroidWebhookKeyMutation(
    selectedInstance?.id
  );
  const { data: googleConfigScript } = useGoogleConfigScriptQuery(
    selectedInstance?.id
  );

  const {
    walkedSteps,
    markStepComplete,
    reset: resetProgress,
  } = useSetupProgress(
    selectedInstance?.id,
    ANDROID_SETUP_CATEGORY,
    STEP_IDENTIFIERS
  );

  const stepName = (idx: number): AndroidStepName | undefined =>
    STEPS[idx]?.name;

  const router = useRouter();
  // Prefetch domain config for child components
  useDomainConfigQuery(selectedProject?.id);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputNotificationRef = useRef<HTMLInputElement>(null);
  const [androidConfig, setAndroidConfig] = useState<PlatformAppConfig | null>(
    null
  );
  const [releaseDataAndroid, setReleaseDataAndroid] = useState<{
    tag_name: string;
  } | null>(null);
  const [shaList, setShaList] = useState<string[]>([]);

  const [packageName, setPackageName] = useState<string>("");
  const [detailsChanged, setDetailsChanged] = useState<boolean>(false);
  const [certificateChanged, setCertificateChanged] = useState<boolean>(false);
  const [firebaseProjectId, setFirebaseProjectId] = useState<string>("");
  const [certificate, setCertificate] = useState<string | null>(null);
  const [pushNotificationCertificateFile, setPushNotificationCertificateFile] =
    useState<File | null>(null);

  const [webhookAuthKeyFile, setWebhookAuthKeyFile] = useState<File | null>(
    null
  );
  const [webhookAuthKey, setWebhookAuthKey] = useState<string>("");

  const [serverKeyChanged, setServerKeyChanged] = useState<boolean>(false);
  const [pushServerError, setPushServerError] = useState<string | null>(null);
  const [webhookServerError, setWebhookServerError] = useState<string | null>(
    null
  );
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  const [appstoreWebhookURL, setAppstoreWebhookURL] = useState<string>("");

  // Wizard state
  const [currentStep, setCurrentStep] = useState(0);
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(new Set([0]));
  const [wizardMode, setWizardMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  // Unsaved changes dialog
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const pendingNavigationRef = useRef<(() => void) | null>(null);

  // Refs for save handlers used inside useCallback to avoid stale closures without triggering re-creation
  const handleSaveConfigurationRef = useRef<
    (id: string, pkg: string, shas: string[], cb?: () => void) => void
  >(null!);
  const handleSaveCertificateRef = useRef<
    (id: string, fbId: string, cert: File | null, cb?: () => void) => void
  >(null!);
  const handleSaveAndroidApiKeyRef = useRef<
    (id: string, file: File | null, cb?: () => void) => void
  >(null!);

  const sdkConfigured = !!androidConfig?.configuration?.identifier;

  // Wizard sidebar: green when saved (interactive steps) or walked through (read-only steps)
  const stepCompleted = STEPS.map((step, idx) => {
    switch (step.name) {
      case "Register App":
        return sdkConfigured;
      case "Intent Filters":
        return walkedSteps.has(idx);
      case "Add the SDK":
        return walkedSteps.has(idx);
      case "Push Notifications":
        return !!androidConfig?.configuration?.push_configuration;
      case "Revenue":
        return !!androidConfig?.configuration?.server_api_key;
      case "Initialize SDK":
        return walkedSteps.has(idx);
      default: {
        step.name satisfies never;
        return false;
      }
    }
  });

  // Per-step change tracking
  const stepHasChanges = useCallback(
    (step: number): boolean => {
      switch (stepName(step)) {
        case "Register App":
          return detailsChanged;
        case "Push Notifications":
          return certificateChanged;
        case "Revenue":
          return serverKeyChanged;
        default:
          return false;
      }
    },
    [detailsChanged, certificateChanged, serverKeyChanged]
  );

  const stepIsInteractive = (step: number): boolean => {
    const name = stepName(step);
    return (
      name === "Register App" ||
      name === "Push Notifications" ||
      name === "Revenue"
    );
  };

  const stepFormValid = useCallback(
    (step: number): boolean => {
      switch (stepName(step)) {
        case "Register App":
          return (
            packageName.length > 0 &&
            shaList.some((s) => shaSchema.safeParse(s).success)
          );
        case "Push Notifications":
          return (
            firebaseProjectId !== "" &&
            (pushNotificationCertificateFile != null || certificate != null)
          );
        case "Revenue":
          return webhookAuthKeyFile != null;
        default:
          return true;
      }
    },
    [
      packageName,
      shaList,
      firebaseProjectId,
      pushNotificationCertificateFile,
      certificate,
      webhookAuthKeyFile,
    ]
  );

  const hasAnyChanges =
    detailsChanged || certificateChanged || serverKeyChanged;

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
    initializeValuesRef.current(androidConfig);
    setPushServerError(null);
    setWebhookServerError(null);
    pendingNavigationRef.current?.();
    pendingNavigationRef.current = null;
  }, [androidConfig]);

  const handleSaveAndNavigate = useCallback(() => {
    setUnsavedDialogOpen(false);
    const navigate = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    const saveAndNavigate = () => {
      setWizardMode(true);
      navigate?.();
    };
    if (!selectedInstance) return;
    // Trigger save for current step, then navigate on success
    switch (stepName(currentStep)) {
      case "Register App":
        handleSaveConfigurationRef.current(
          selectedInstance.id,
          packageName,
          shaList.filter((s) => shaSchema.safeParse(s).success),
          saveAndNavigate
        );
        break;
      case "Push Notifications":
        handleSaveCertificateRef.current(
          selectedInstance.id,
          firebaseProjectId,
          pushNotificationCertificateFile,
          saveAndNavigate
        );
        break;
      case "Revenue":
        handleSaveAndroidApiKeyRef.current(
          selectedInstance.id,
          webhookAuthKeyFile,
          saveAndNavigate
        );
        break;
      default:
        navigate?.();
    }
  }, [
    currentStep,
    selectedInstance,
    packageName,
    shaList,
    firebaseProjectId,
    pushNotificationCertificateFile,
    webhookAuthKeyFile,
  ]);

  // Guard all navigation when there are unsaved changes
  useEffect(() => {
    if (!hasAnyChanges) return;

    // Browser/tab close
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    // Intercept client-side link clicks (Next.js <Link>, <a> tags)
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // Only intercept internal same-origin navigation to a different path
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

    // Intercept browser back/forward
    const handlePopState = () => {
      // Push current URL back to undo the navigation
      window.history.pushState(null, "", window.location.href);
      pendingNavigationRef.current = () => window.history.back();
      setUnsavedDialogOpen(true);
    };

    // Push an extra history entry so we can intercept back
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
      // First-time user — reset visited steps and go to wizard
      setCurrentStep(0);
      setVisitedSteps(new Set([0]));
      setWizardMode(true);
    }
  }, [sdkConfigured, instanceConfig]);

  // Deep-link from elsewhere (e.g. the custom domain modal): jump straight to
  // the requested step once instanceConfig is ready. Only applies once.
  useEffect(() => {
    if (deepLinkAppliedRef.current) return;
    const targetId = initialStepParam.current;
    if (!targetId || !instanceConfig) return;
    const idx = STEPS.findIndex((s) => s.identifier === targetId);
    if (idx < 0) return;
    setCurrentStep(idx);
    setVisitedSteps((prev) => {
      const next = new Set(prev);
      for (let i = 0; i <= idx; i++) next.add(i);
      return next;
    });
    setWizardMode(true);
    deepLinkAppliedRef.current = true;
  }, [instanceConfig]);

  const goToStep = useCallback(
    (step: number) => {
      // Push Notifications and Revenue require Register App to be done, unless already visited in wizard
      if (
        (stepName(step) === "Push Notifications" ||
          stepName(step) === "Revenue") &&
        !sdkConfigured &&
        !visitedSteps.has(step)
      ) {
        showErrorNotification('You need to complete "Register the app" first');
        return;
      }

      const doNavigate = () => {
        markStepComplete(step);
        setCurrentStep(step);
        setVisitedSteps((prev) => new Set([...prev, step]));
      };

      guardNavigation(doNavigate);
    },
    [sdkConfigured, guardNavigation, markStepComplete, visitedSteps]
  );

  const advanceStep = useCallback(() => {
    // Block advancing past step 0 if required fields aren't filled
    if (currentStep === 0 && !stepFormValid(0)) {
      setShowValidationErrors(true);
      return;
    }
    markStepComplete(currentStep);
    const nextStep = currentStep + 1;
    if (nextStep < STEPS.length) {
      markStepComplete(nextStep);
      setCurrentStep(nextStep);
      setVisitedSteps((prev) => new Set([...prev, nextStep]));
    }
  }, [currentStep, markStepComplete, stepFormValid]);

  const enterWizardAtStep = useCallback(
    (step: number) => {
      markStepComplete(step);
      setCurrentStep(step);
      setVisitedSteps(ALL_STEP_INDICES);
      setWizardMode(true);
    },
    [markStepComplete]
  );

  const handleRemoveSha = (index: number) => {
    const list = deepClone(shaList);
    list.splice(index, 1);
    setShaList(list);
  };

  const clearFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (fileInputNotificationRef.current) {
      fileInputNotificationRef.current.value = "";
    }
  };

  const handleSetPushNotificationCertificateFile = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setCertificate(null);
    setPushServerError(null);
    setPushNotificationCertificateFile(e.currentTarget.files?.[0] ?? null);
  };

  const handleSetWebhookAuthenticationFile = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setWebhookServerError(null);
    setWebhookAuthKeyFile(e.currentTarget.files?.[0] ?? null);
  };

  const initializeValues = (config: PlatformAppConfig | null) => {
    const URL = process.env.NEXT_PUBLIC_API_URL;
    setAppstoreWebhookURL(
      URL + "/api/v1/iap/google/" + selectedInstance?.hash_id
    );

    if (!config || !config.configuration) {
      setPackageName("");
      setShaList([]);
      setCertificate(null);
      setFirebaseProjectId("");
      setPushNotificationCertificateFile(null);
      setWebhookAuthKey("");
      setWebhookAuthKeyFile(null);
      clearFileInput();
    } else {
      const cfg = config.configuration;
      setPackageName(cfg?.identifier || "");
      setShaList(cfg?.sha256s || []);

      if (cfg?.push_configuration) {
        setCertificate(cfg.push_configuration.certificate ?? null);
        setFirebaseProjectId(cfg.push_configuration.firebase_project_id ?? "");
      } else {
        setCertificate(null);
        setFirebaseProjectId("");
        setPushNotificationCertificateFile(null);
        clearFileInput();
      }
      if (cfg?.server_api_key) {
        setWebhookAuthKey(cfg.server_api_key.file ?? "");
        setWebhookAuthKeyFile(null);
        clearFileInput();
      } else {
        setWebhookAuthKey("");
        setWebhookAuthKeyFile(null);
        clearFileInput();
      }
    }
  };

  const monitorDetailsChanged = useCallback(
    (config: PlatformAppConfig | null) => {
      if (!config || !config.configuration) {
        if (!deepEqual(shaList, []) || packageName !== "") {
          setDetailsChanged(true);
        } else {
          setDetailsChanged(false);
        }
      } else {
        if (
          !deepEqual(shaList, config?.configuration.sha256s) ||
          packageName !== config?.configuration.identifier
        ) {
          setDetailsChanged(true);
        } else {
          setDetailsChanged(false);
        }
      }
    },
    [shaList, packageName]
  );

  const monitorCertificateChanged = useCallback(
    (config: PlatformAppConfig | null) => {
      if (!config || !config.configuration) {
        if (pushNotificationCertificateFile || firebaseProjectId !== "") {
          setCertificateChanged(true);
        } else {
          setCertificateChanged(false);
        }
      } else {
        const savedFirebaseId =
          config.configuration.push_configuration?.firebase_project_id ?? "";
        const hasNewFile = pushNotificationCertificateFile != null;
        const hasProjectIdChange = firebaseProjectId !== savedFirebaseId;
        setCertificateChanged(hasNewFile || hasProjectIdChange);
      }
    },
    [pushNotificationCertificateFile, firebaseProjectId]
  );

  const monitorServerKeyChanged = useCallback(
    (config: PlatformAppConfig | null) => {
      if (!config || !config.configuration) {
        if (webhookAuthKeyFile != null) {
          setServerKeyChanged(true);
        } else {
          setServerKeyChanged(false);
        }
      } else if (
        webhookAuthKeyFile != null &&
        webhookAuthKeyFile?.name !== webhookAuthKey &&
        webhookAuthKeyFile?.name?.split(".").at(-1) === "json"
      ) {
        setServerKeyChanged(true);
      } else {
        setServerKeyChanged(false);
      }
    },
    [webhookAuthKeyFile, webhookAuthKey]
  );

  const handleSetAndroidConfig = async (
    _instanceId: string,
    enabled: boolean,
    identifier: string,
    sha256s: string[]
  ) => {
    const data = {
      enabled: enabled,
      identifier: identifier,
      sha256s: sha256s,
    };

    if (!identifier && sha256s.length === 0) {
      try {
        await removeAndroidConfigMutation.mutateAsync();
        setAndroidConfig(null);
        resetProgress();
        showSuccessNotification("App registration removed");
      } catch {
        showGenericError();
      }
    } else if (identifier && sha256s.length > 0) {
      try {
        const response = await androidConfigMutation.mutateAsync(data);
        setAndroidConfig(response.data.config);
        trackEvent(EVENTS.SDK_INTEGRATED, { platform: "android" });
        showSuccessNotification("App registration saved");
      } catch {
        showGenericError();
      }
    } else {
      showErrorNotification(
        "You need to enter both the package name and SHA-256, before you can save the changes"
      );
      return;
    }
  };

  const handleSaveConfiguration = async (
    _instanceId: string,
    packageName: string,
    shaList: string[],
    onSuccess?: () => void
  ) => {
    let enabled = true;
    if (androidConfig) {
      enabled = androidConfig.enabled ?? true;
    }

    const data = {
      enabled: enabled,
      identifier: packageName,
      sha256s: shaList,
    };

    if (
      (packageName && shaList.length > 0) ||
      (!packageName && shaList.length === 0)
    ) {
      try {
        const response = await androidConfigMutation.mutateAsync(data);
        setAndroidConfig(response.data.config);
        trackEvent(EVENTS.SDK_INTEGRATED, { platform: "android" });
        showSuccessNotification(
          "App registration saved — package name and SHA-256 updated"
        );

        onSuccess?.();
      } catch {
        showGenericError();
      }
    } else {
      showErrorNotification(
        "You need to enter both the package name and SHA-256, before you can save the changes"
      );
    }
  };

  const handleSetAndroidPushConfig = async (
    _projectId: string,
    firebaseProjectId: string,
    certificateFile: File | null,
    onSuccess?: () => void
  ) => {
    const formData = new FormData();

    if (firebaseProjectId !== "" && certificateFile) {
      formData.append("firebase_project_id", firebaseProjectId);
      formData.append("push_certificate", certificateFile);
    }

    try {
      await androidPushConfigMutation.mutateAsync(formData);
      setPushNotificationCertificateFile(null);
      setPushServerError(null);
      showSuccessNotification(
        "Push notifications saved — Firebase credentials updated"
      );

      onSuccess?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const message =
          (err.data as { error?: string })?.error ?? "Invalid file";
        setPushServerError(message);
        showErrorNotification(message);
      } else {
        showGenericError();
      }
    }
  };

  const handleSetAndroidAppWebhookAccessKey = async (
    _instanceId: string,
    jsonFile: File | null,
    onSuccess?: () => void
  ) => {
    const formData = new FormData();

    if (jsonFile) {
      formData.append("file", jsonFile);
    }

    try {
      await androidWebhookKeyMutation.mutateAsync(formData);
      setWebhookServerError(null);
      showSuccessNotification(
        "Google Play notifications saved — API key updated"
      );
      clearFileInput();

      onSuccess?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const message =
          (err.data as { error?: string })?.error ?? "Invalid file";
        setWebhookServerError(message);
        showErrorNotification(message);
      } else {
        showGenericError();
      }
    }
  };

  const handleSaveCertificate = (
    instanceId: string,
    firebaseProjectId: string,
    pushNotificationCertificateFile: File | null,
    onSuccess?: () => void
  ) => {
    if (!packageName || shaList.length === 0) {
      showErrorNotification(
        `You need to fill "Register the app" section before adding the certificate`
      );
      return;
    }

    if (firebaseProjectId === "" || !pushNotificationCertificateFile) {
      showErrorNotification(
        "You need to fill in both the certificate and firebase project id, before you can save the changes."
      );
      return;
    }

    handleSetAndroidPushConfig(
      instanceId,
      firebaseProjectId,
      pushNotificationCertificateFile,
      onSuccess
    );
  };

  const handleSaveAndroidApiKey = (
    instanceId: string,
    jsonFile: File | null,
    onSuccess?: () => void
  ) => {
    if (!packageName || shaList.length === 0) {
      showErrorNotification(
        `You need to fill "Register the app" section before adding the key`
      );
      return;
    }
    if (!jsonFile) {
      return;
    }
    handleSetAndroidAppWebhookAccessKey(instanceId, jsonFile, onSuccess);
  };

  // Keep refs in sync so useCallback closures always call the latest version
  handleSaveConfigurationRef.current = handleSaveConfiguration;
  handleSaveCertificateRef.current = handleSaveCertificate;
  handleSaveAndroidApiKeyRef.current = handleSaveAndroidApiKey;

  const handleSaveAndContinue = () => {
    if (!selectedInstance) return;
    if (!stepFormValid(currentStep)) {
      setShowValidationErrors(true);
      return;
    }
    setShowValidationErrors(false);
    const saveAndAdvance = () => {
      setWizardMode(true);
      advanceStep();
    };
    switch (stepName(currentStep)) {
      case "Register App":
        handleSaveConfiguration(
          selectedInstance.id,
          packageName,
          shaList.filter((s) => shaSchema.safeParse(s).success),
          saveAndAdvance
        );
        break;
      case "Push Notifications":
        handleSaveCertificate(
          selectedInstance.id,
          firebaseProjectId,
          pushNotificationCertificateFile,
          saveAndAdvance
        );
        break;
      case "Revenue":
        handleSaveAndroidApiKey(
          selectedInstance.id,
          webhookAuthKeyFile,
          saveAndAdvance
        );
        break;
      default:
        advanceStep();
    }
  };

  const handleFinish = () => {
    markStepComplete(currentStep);
    if (sdkConfigured) {
      showSuccessNotification("Android setup complete!");
      setWizardMode(false);
    } else {
      showErrorNotification("Register your app in step 1 to complete setup.");
      setCurrentStep(0);
      setVisitedSteps(ALL_STEP_INDICES);
    }
  };

  const handleDownloadGoogleConfigScript = () => {
    if (!googleConfigScript) {
      return;
    }
    const blob = new Blob([googleConfigScript], { type: "application/x-sh" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "grovs_android_gcloud_setup.sh";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const package_name_code = [
    {
      highlightLines: [6, 8, 9],
      language: "xml",
      filename: "AndroidManifest.xml",
      code: `<intent-filter>
  <data android:scheme="${selectedInstance?.uri_scheme ?? "YOUR_URI_SCHEME"}" android:host="open" />
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
</intent-filter>

<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="${selectedInstance?.production?.domain}" />
</intent-filter>${[customProdHost, migratedProdHost]
        .filter(Boolean)
        .map(
          (host) => `

<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="${host}" />
</intent-filter>`
        )
        .join("")}

<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="${selectedInstance?.test?.domain}" />
</intent-filter>${[customTestHost, migratedTestHost]
        .filter(Boolean)
        .map(
          (host) => `

<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="${host}" />
</intent-filter>`
        )
        .join("")}
`,
    },
  ];

  const sdk_android_code = [
    {
      highlightLines: [6, 8, 9],
      language: "kotlin",
      filename: "MainApplication.kt",
      code: sdkAndroidValue.replace(
        "_GROVS_API_KEY_",
        selectedInstance?.api_key ?? "YOUR_API_KEY"
      ),
    },
  ];
  const sdk_android_google_script = [
    {
      highlightLines: [6, 8, 9],
      language: "groovy",
      filename: "build.gradle",
      code: googleCloudScript,
    },
  ];

  const react_native_code = [
    {
      highlightLines: [6, 8, 9],
      language: "kotlin",
      filename: "MainApplication.kt",
      code: sdkAndroidValue.replace(
        "_GROVS_API_KEY_",
        selectedInstance?.api_key ?? "YOUR_API_KEY"
      ),
    },
  ];
  const sdk_launcher_activity_code = [
    {
      highlightLines: [6, 8, 9],
      language: "kotlin",
      filename: "MainActivity.kt",
      code: sdkLauncherActivityValue,
    },
  ];

  const sdk_handle_deep_links_code = [
    {
      highlightLines: [6, 8, 9],
      language: "kotlin",
      filename: "MainActivity.kt",
      code: sdkHandleDeepLinksValue,
    },
  ];

  const sdk_react_native_app_code = [
    {
      highlightLines: [6, 8, 9],
      language: "jsx",
      filename: "App.js",
      code: sdkReactNativeAppValue,
    },
  ];

  useEffect(() => {
    const fetchGradleReleaseData = async () => {
      try {
        const response = await fetch(
          "https://api.github.com/repos/grovs-io/grovs-Android/releases/latest"
        );
        if (!response.ok) return;
        const data = await response.json();
        setReleaseDataAndroid(data);
      } catch {
        // GitHub API may be blocked by CSP or rate-limited — non-critical
      }
    };

    fetchGradleReleaseData();
  }, []);

  // Reset all state when project/instance changes.
  // initializeValues reads selectedInstance from closure — use a ref to avoid
  // adding it (and its transitive deps) to the dependency array.
  const initializeValuesRef = useRef(initializeValues);
  initializeValuesRef.current = initializeValues;

  // Skip the initial mount so we don't clobber state set by the deep-link
  // effect when this page is opened with ?step=... via client-side nav.
  const lastResetInstanceIdRef = useRef<string | undefined>(
    selectedInstance?.id
  );
  useEffect(() => {
    if (!selectedInstance) return;
    if (lastResetInstanceIdRef.current === selectedInstance.id) return;
    lastResetInstanceIdRef.current = selectedInstance.id;
    setAndroidConfig(null);
    setCurrentStep(0);
    setVisitedSteps(new Set([0]));
    setWizardMode(false);
    setDetailsChanged(false);
    setCertificateChanged(false);
    setServerKeyChanged(false);
    initializeValuesRef.current(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset when instance ID changes, not on every selectedInstance reference change
  }, [selectedInstance?.id]);

  useEffect(() => {
    if (!instanceConfig) {
      return;
    }
    const androidConf = instanceConfig.find(
      (config: PlatformAppConfig) => config.platform === ANDROID
    );

    if (instanceConfig.length > 0 && androidConf) {
      setAndroidConfig(androidConf);
      initializeValuesRef.current(androidConf);
    } else {
      setAndroidConfig(null);
      initializeValuesRef.current(null);
    }
  }, [instanceConfig]);

  useEffect(() => {
    monitorDetailsChanged(androidConfig);
  }, [monitorDetailsChanged, androidConfig]);

  useEffect(() => {
    monitorCertificateChanged(androidConfig);
  }, [monitorCertificateChanged, androidConfig]);

  useEffect(() => {
    monitorServerKeyChanged(androidConfig);
  }, [monitorServerKeyChanged, androidConfig]);

  // Scroll to top and reset validation errors when step changes
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setShowValidationErrors(false);
  }, [currentStep]);

  return (
    <div className="flex flex-col relative overflow-hidden h-dvh">
      <div className="border-b border-sidebar-border">
        <AppHeader hideEnvSelect />
      </div>

      {/* Overview mode */}
      {sdkConfigured && !wizardMode ? (
        <SetupOverview
          stepCompleted={stepCompleted}
          androidConfig={androidConfig}
          packageName={packageName}
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
            platformLabel="Android Setup"
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
                {/* Step: Register the app */}
                {stepName(currentStep) === "Register App" && (
                  <Step0RegisterApp
                    packageName={packageName}
                    setPackageName={setPackageName}
                    shaList={shaList}
                    setShaList={setShaList}
                    showValidationErrors={showValidationErrors}
                    onRemoveSha={handleRemoveSha}
                  />
                )}

                {/* Step: Intent Filters */}
                {stepName(currentStep) === "Intent Filters" && (
                  <Step1IntentFilters
                    packageNameCode={package_name_code}
                    hasCustom={hasCustomIntentFilters}
                  />
                )}

                {/* Step: Add the SDK */}
                {stepName(currentStep) === "Add the SDK" && (
                  <Step2AddSDK releaseTagName={releaseDataAndroid?.tag_name} />
                )}

                {/* Step: Push Notifications */}
                {stepName(currentStep) === "Push Notifications" && (
                  <Step3PushNotifications
                    certificate={certificate}
                    firebaseProjectId={firebaseProjectId}
                    setFirebaseProjectId={setFirebaseProjectId}
                    pushNotificationCertificateFile={
                      pushNotificationCertificateFile
                    }
                    fileInputNotificationRef={fileInputNotificationRef}
                    onCertificateFileChange={
                      handleSetPushNotificationCertificateFile
                    }
                    showValidationErrors={showValidationErrors}
                    serverError={pushServerError}
                  />
                )}

                {/* Step: Google Play Real-Time Notifications */}
                {stepName(currentStep) === "Revenue" && (
                  <Step4Revenue
                    appstoreWebhookURL={appstoreWebhookURL}
                    webhookAuthKey={webhookAuthKey}
                    webhookAuthKeyFile={webhookAuthKeyFile}
                    fileInputRef={fileInputRef}
                    onWebhookFileChange={handleSetWebhookAuthenticationFile}
                    onDownloadGoogleConfigScript={
                      handleDownloadGoogleConfigScript
                    }
                    googleScriptCode={sdk_android_google_script}
                    showValidationErrors={showValidationErrors}
                    serverError={webhookServerError}
                  />
                )}

                {/* Step: Initialize the SDK */}
                {stepName(currentStep) === "Initialize SDK" && (
                  <Step5InitializeSDK
                    sdkAndroidCode={sdk_android_code}
                    sdkLauncherActivityCode={sdk_launcher_activity_code}
                    sdkHandleDeepLinksCode={sdk_handle_deep_links_code}
                    reactNativeCode={react_native_code}
                    sdkReactNativeAppCode={sdk_react_native_app_code}
                  />
                )}
              </div>
            </div>

            {/* Step Navigation */}
            <StepNavigation
              currentStep={currentStep}
              totalSteps={STEPS.length}
              isOptional={STEPS[currentStep]?.optional}
              hasChanges={stepHasChanges(currentStep)}
              isInteractive={stepIsInteractive(currentStep)}
              isSaving={
                androidConfigMutation.isPending ||
                androidPushConfigMutation.isPending
              }
              onBack={() => goToStep(currentStep - 1)}
              onContinue={advanceStep}
              onSaveAndContinue={handleSaveAndContinue}
              onSkip={advanceStep}
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
            <DialogTitle>Remove app registration</DialogTitle>
            <DialogDescription>
              This will clear the package name, SHA-256 fingerprints, and
              disable deep linking for this app. This action cannot be undone.
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
                  handleSetAndroidConfig(selectedInstance.id, false, "", []);
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

export default AndroidSetupPage;
