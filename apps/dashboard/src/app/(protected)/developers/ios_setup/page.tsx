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
import { IOS } from "@/constants/OptionsConstants";
import { trackEvent, EVENTS } from "@/analytics";
import { bundleIdSchema } from "@/schemas/shared";

import {
  Bell,
  Code2,
  Eye,
  Link,
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
import { useRouter } from "next/navigation";

import {
  showErrorNotification,
  showGenericError,
  showSuccessNotification,
} from "@/lib/Notifications";
import { ApiError } from "@/lib/ApiError";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useInstanceConfigQuery } from "@/hooks/queries/useInstanceQueries";
import {
  useSetIosConfigMutation,
  useSetIosPushConfigMutation,
  useSetIosApiAccessKeyMutation,
  useRemoveIosConfigMutation,
} from "@/hooks/mutations/useInstanceMutations";
import { IOS_SETUP_CATEGORY } from "@/constants/SetupStepConstants";
import { useSetupProgress } from "@/hooks/useSetupProgress";
import {
  appDelegateContent,
  reactNativeContent,
  sceneDelegateContent,
} from "@/lib/IosPageConstants";
import {
  OverviewRow,
  WizardSidebar,
  StepNavigation,
} from "@/components/developers/SetupShared";
import Image from "next/image";
import iosIcon from "@/assets/icons/generic/Apple.svg";
import type { PlatformAppConfig } from "@/types";
import Step0RegisterApp from "./steps/Step0RegisterApp";
import Step1URLScheme from "./steps/Step1URLScheme";
import Step2AddSDK from "./steps/Step2AddSDK";
import Step3PushNotifications from "./steps/Step3PushNotifications";
import Step4Revenue from "./steps/Step4Revenue";
import Step5InitializeSDK from "./steps/Step5InitializeSDK";

type IosStepName =
  | "Register App"
  | "URL Scheme"
  | "Add the SDK"
  | "Push Notifications"
  | "Revenue"
  | "Initialize SDK";

type Step = {
  readonly name: IosStepName;
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
  { name: "URL Scheme", identifier: "url_scheme", icon: Link, optional: false },
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
  {
    name: "Revenue",
    identifier: "appstore_notifications",
    icon: Store,
    optional: true,
  },
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
  iosConfig,
  bundleId,
  onRunSetup,
  onEditStep,
  onRemoveRegistration,
}: {
  stepCompleted: boolean[];
  iosConfig: PlatformAppConfig | null;
  bundleId: string;
  onRunSetup: () => void;
  onEditStep: (step: number) => void;
  onRemoveRegistration: () => void;
}) => {
  const pushConfig = iosConfig?.configuration?.push_configuration;
  const serverKey = iosConfig?.configuration?.server_api_key;
  const findStep = (name: IosStepName): number | null => {
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
              src={iosIcon}
              alt="iOS"
              width={16}
              height={20}
              className="w-4 h-5 dark:invert"
            />
          </div>
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="text-sm font-semibold">iOS Setup</span>
            <span className="text-xs text-muted-foreground">
              Your iOS SDK is configured and ready to use.
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
              description={bundleId || "Not configured"}
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
              title="URL Scheme"
              description="Deep link routing"
              configured={stepCompleted[findStep("URL Scheme")!] ?? false}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEditStep(findStep("URL Scheme")!)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  View
                </Button>
              }
            />
            <OverviewRow
              title="Add the SDK"
              description="SPM / Cocoapods / NPM / Yarn"
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
                  ? `Certificate: ${pushConfig.certificate}`
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
            <OverviewRow
              title="App Store Purchases"
              description={
                serverKey?.configured
                  ? `Credentials configured · ${serverKey.key_id ?? "Key ID saved"}`
                  : "Credentials not configured"
              }
              configured={stepCompleted[findStep("Revenue")!] ?? false}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEditStep(findStep("Revenue")!)}
                >
                  {serverKey?.configured ? (
                    <Pencil className="h-3.5 w-3.5" />
                  ) : (
                    <Settings className="h-3.5 w-3.5" />
                  )}
                  {serverKey?.configured ? "Edit" : "Set up"}
                </Button>
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};

const IosSetupPage = () => {
  const { selectedInstance } = useProjectSelection();
  const { data: instanceConfig } = useInstanceConfigQuery(selectedInstance?.id);
  const iosConfigMutation = useSetIosConfigMutation(selectedInstance?.id);
  const removeIosConfigMutation = useRemoveIosConfigMutation(
    selectedInstance?.id
  );
  const iosPushConfigMutation = useSetIosPushConfigMutation(
    selectedInstance?.id
  );
  const iosApiAccessKeyMutation = useSetIosApiAccessKeyMutation(
    selectedInstance?.id
  );

  const {
    walkedSteps,
    markStepComplete,
    reset: resetProgress,
  } = useSetupProgress(
    selectedInstance?.id,
    IOS_SETUP_CATEGORY,
    STEP_IDENTIFIERS
  );

  const stepName = (idx: number): IosStepName | undefined => STEPS[idx]?.name;

  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const apiKeyFileInputRef = useRef<HTMLInputElement>(null);
  const [bundleId, setBundleId] = useState<string>("");
  const [appleAppPrefix, setAppleAppPrefix] = useState<string>("");
  const [pushNotificationCertificateFile, setPushNotificationCertificateFile] =
    useState<File | null>(null);
  const [certificate, setCertificate] = useState<string | null>(null);
  const [certificatePassword, setCertificatePassword] = useState<string>("");
  const [associatedDomainProd, setAssociatedDomainProd] = useState<string>("");
  const [associatedDomainTest, setAssociatedDomainTest] = useState<string>("");

  const [pushServerError, setPushServerError] = useState<string | null>(null);

  const [detailsChanged, setDetailsChanged] = useState<boolean>(false);
  const [certificateChanged, setCertificateChanged] = useState<boolean>(false);
  const [apiKeyChanged, setApiKeyChanged] = useState<boolean>(false);
  const [urlScheme, setUrlScheme] = useState<string>("");

  const [appstoreURLProduction, setAppstoreURLProduction] =
    useState<string>("");
  const [appstoreURLSandbox, setAppstoreURLSandbox] = useState<string>("");
  const [appleAppId, setAppleAppId] = useState<string>("");
  const [appStoreKeyId, setAppStoreKeyId] = useState<string>("");
  const [appStoreIssuerId, setAppStoreIssuerId] = useState<string>("");
  const [apiKeyFilename, setApiKeyFilename] = useState<string>("");
  const [apiKeyFile, setApiKeyFile] = useState<File | null>(null);
  const [apiKeyServerError, setApiKeyServerError] = useState<string | null>(
    null
  );

  const [iosConfig, setIosConfig] = useState<PlatformAppConfig | null>(null);

  // Wizard state
  const [currentStep, setCurrentStep] = useState(0);
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(new Set([0]));
  const [wizardMode, setWizardMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  // Unsaved changes dialog
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const pendingNavigationRef = useRef<(() => void) | null>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  // Refs for save handlers used inside useCallback to avoid stale closures without triggering re-creation
  const handleSaveConfigurationRef = useRef<
    (
      instanceId: string,
      bundleId: string,
      appPrefix: string,
      onSuccess?: () => void
    ) => void
  >(null!);
  const handleSaveCertificateRef = useRef<
    (
      projectId: string,
      certPassword: string,
      certFile: File | null,
      onSuccess?: () => void
    ) => void
  >(null!);
  const handleSaveApiKeyRef = useRef<
    (
      projectId: string,
      file: File | null,
      keyId: string,
      issuerId: string,
      appId: string,
      onSuccess?: () => void
    ) => void
  >(null!);

  const sdkConfigured = !!iosConfig?.configuration?.bundle_id;

  // Wizard sidebar: green when saved (interactive steps) or walked through (read-only steps)
  const stepCompleted = STEPS.map((step, idx) => {
    switch (step.name) {
      case "Register App":
        return sdkConfigured;
      case "URL Scheme":
        return walkedSteps.has(idx);
      case "Add the SDK":
        return walkedSteps.has(idx);
      case "Push Notifications":
        return !!iosConfig?.configuration?.push_configuration;
      case "Revenue":
        return !!iosConfig?.configuration?.server_api_key?.configured;
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
          return apiKeyChanged;
        default:
          return false;
      }
    },
    [detailsChanged, certificateChanged, apiKeyChanged]
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
            bundleIdSchema.safeParse(bundleId).success &&
            appleAppPrefix.length > 2
          );
        case "Push Notifications":
          return (
            (pushNotificationCertificateFile != null || certificate != null) &&
            certificatePassword !== ""
          );
        case "Revenue":
          return (
            appleAppId.trim().length > 0 &&
            appStoreKeyId.trim().length > 0 &&
            appStoreIssuerId.trim().length > 0 &&
            (apiKeyFile != null ||
              !!iosConfig?.configuration?.server_api_key?.configured)
          );
        default:
          return true;
      }
    },
    [
      bundleId,
      appleAppPrefix,
      pushNotificationCertificateFile,
      certificate,
      certificatePassword,
      appleAppId,
      appStoreKeyId,
      appStoreIssuerId,
      apiKeyFile,
      iosConfig,
    ]
  );

  const hasAnyChanges = detailsChanged || certificateChanged || apiKeyChanged;

  // Code blocks
  const app_delegate_code = [
    {
      highlightLines: [6, 8, 9],
      language: "swift",
      filename: "AppDelegate.swift",
      code: appDelegateContent.replace(
        "_OPENGROW_API_KEY_",
        selectedInstance?.api_key ?? "YOUR_API_KEY"
      ),
    },
  ];

  const scene_delegate_code = [
    {
      highlightLines: [6, 8, 9],
      language: "swift",
      filename: "SceneDelegate.swift",
      code: sceneDelegateContent.replace(
        "_OPENGROW_API_KEY_",
        selectedInstance?.api_key ?? "YOUR_API_KEY"
      ),
    },
  ];

  const react_native_code = [
    {
      highlightLines: [6, 8, 9],
      language: "swift",
      filename: "AppDelegate.swift",
      code: reactNativeContent.replace(
        "_OPENGROW_API_KEY_",
        selectedInstance?.api_key ?? "YOUR_API_KEY"
      ),
    },
  ];

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
    initializeValuesRef.current(iosConfig);
    setPushServerError(null);
    setApiKeyServerError(null);
    pendingNavigationRef.current?.();
    pendingNavigationRef.current = null;
  }, [iosConfig]);

  const handleSaveAndNavigate = useCallback(() => {
    setUnsavedDialogOpen(false);
    const navigate = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    if (!selectedInstance) return;
    const saveAndNavigate = () => {
      setWizardMode(true);
      navigate?.();
    };
    switch (stepName(currentStep)) {
      case "Register App":
        handleSaveConfigurationRef.current(
          selectedInstance.id,
          bundleId,
          appleAppPrefix,
          saveAndNavigate
        );
        break;
      case "Push Notifications":
        handleSaveCertificateRef.current(
          selectedInstance.id,
          certificatePassword,
          pushNotificationCertificateFile,
          saveAndNavigate
        );
        break;
      case "Revenue":
        handleSaveApiKeyRef.current(
          selectedInstance.id,
          apiKeyFile,
          appStoreKeyId,
          appStoreIssuerId,
          appleAppId,
          saveAndNavigate
        );
        break;
      default:
        navigate?.();
    }
  }, [
    currentStep,
    selectedInstance,
    bundleId,
    appleAppPrefix,
    certificatePassword,
    pushNotificationCertificateFile,
    apiKeyFile,
    appStoreKeyId,
    appStoreIssuerId,
    appleAppId,
  ]);

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

  const handleSetPushNotificationCertificateFile = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setCertificate(null);
    setPushServerError(null);
    setPushNotificationCertificateFile(e.currentTarget.files?.[0] ?? null);
  };

  const handleSetApiKeyFile = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setApiKeyServerError(null);
    setApiKeyFile(event.currentTarget.files?.[0] ?? null);
  };

  const monitorDetailsChange = useCallback(
    (config: PlatformAppConfig | null) => {
      if (!config || !config.configuration) {
        if (bundleId !== "" || appleAppPrefix !== "") {
          setDetailsChanged(true);
        } else {
          setDetailsChanged(false);
        }
      } else if (
        bundleId !== config?.configuration.bundle_id ||
        appleAppPrefix !== config?.configuration.app_prefix
      ) {
        setDetailsChanged(true);
      } else {
        setDetailsChanged(false);
      }
    },
    [bundleId, appleAppPrefix]
  );

  const monitorCertificateChange = useCallback(
    (config: PlatformAppConfig | null) => {
      if (!config || !config.configuration) {
        if (pushNotificationCertificateFile || certificatePassword !== "") {
          setCertificateChanged(true);
        } else {
          setCertificateChanged(false);
        }
      } else if (
        pushNotificationCertificateFile != null &&
        certificatePassword !== ""
      ) {
        setCertificateChanged(true);
      } else {
        setCertificateChanged(false);
      }
    },
    [pushNotificationCertificateFile, certificatePassword]
  );

  const monitorApiKeyChange = useCallback(
    (config: PlatformAppConfig | null) => {
      const saved = config?.configuration?.server_api_key;
      const savedAppId = config?.configuration?.app_apple_id ?? "";
      setApiKeyChanged(
        apiKeyFile != null ||
          appleAppId !== savedAppId ||
          appStoreKeyId !== (saved?.key_id ?? "") ||
          appStoreIssuerId !== (saved?.issuer_id ?? "")
      );
    },
    [apiKeyFile, appleAppId, appStoreKeyId, appStoreIssuerId]
  );

  const handleSetIosConfig = async (
    _instanceId: string,
    enabled: boolean,
    bundle_id: string,
    app_prefix: string
  ) => {
    const dataObject = {
      enabled: enabled,
      bundle_id: bundle_id,
      app_prefix: app_prefix,
      app_apple_id: appleAppId || undefined,
    };

    if (!bundle_id && !app_prefix) {
      try {
        await removeIosConfigMutation.mutateAsync();
        setIosConfig(null);
        resetProgress();
        showSuccessNotification("App registration removed");
      } catch {
        showGenericError();
      }
    } else if (
      bundle_id &&
      bundleIdSchema.safeParse(bundle_id).success &&
      app_prefix
    ) {
      try {
        const response = await iosConfigMutation.mutateAsync(dataObject);
        setIosConfig(response.data.config);
        trackEvent(EVENTS.SDK_INTEGRATED, { platform: "ios" });
        showSuccessNotification(
          "App registration saved — bundle ID and prefix updated"
        );
      } catch {
        showGenericError();
      }
    } else {
      showErrorNotification(
        "You need to fill in both the bundle ID and Apple App Prefix, before you can save the changes."
      );
      return;
    }
  };

  const handleSaveConfiguration = async (
    _instanceId: string,
    bundle_id: string,
    app_prefix: string,
    onSuccess?: () => void
  ) => {
    let enabled = true;
    if (iosConfig) {
      enabled = iosConfig.enabled ?? true;
    }

    const dataObject = {
      enabled: enabled,
      bundle_id: bundle_id,
      app_prefix: app_prefix,
      app_apple_id: appleAppId || undefined,
    };

    if (
      (bundle_id &&
        bundleIdSchema.safeParse(bundle_id).success &&
        app_prefix) ||
      (!bundle_id && !app_prefix)
    ) {
      try {
        const response = await iosConfigMutation.mutateAsync(dataObject);
        setIosConfig(response.data.config);
        trackEvent(EVENTS.SDK_INTEGRATED, { platform: "ios" });
        showSuccessNotification(
          "App registration saved — bundle ID and prefix updated"
        );

        onSuccess?.();
      } catch {
        showGenericError();
      }
    } else {
      showErrorNotification(
        "You need to fill in both the bundle ID and Apple App Prefix, before you can save the changes."
      );
    }
  };

  const handleSetIOSPushConfig = async (
    _projectId: string,
    certificatePassword: string,
    certificateFile: File | null,
    onSuccess?: () => void
  ) => {
    const formData = new FormData();
    if (certificatePassword !== "" && certificateFile) {
      formData.append("push_certificate_password", certificatePassword);
      formData.append("push_certificate", certificateFile);
    }

    try {
      await iosPushConfigMutation.mutateAsync(formData);
      setCertificatePassword("");
      setPushNotificationCertificateFile(null);
      setPushServerError(null);
      showSuccessNotification(
        "Push notifications saved — APN certificate updated"
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

  const handleSaveCertificate = (
    projectId: string,
    certificatePassword: string,
    pushNotificationCertificateFile: File | null,
    onSuccess?: () => void
  ) => {
    if (certificatePassword === "" && !pushNotificationCertificateFile) {
      showErrorNotification(
        "You need to fill in both the certificate and password, before you can save the changes."
      );
      return;
    }

    if (!bundleId || !appleAppPrefix) {
      showErrorNotification(
        `You need to fill "Register the app" section before adding the certificate`
      );
      return;
    }
    handleSetIOSPushConfig(
      projectId,
      certificatePassword,
      pushNotificationCertificateFile,
      onSuccess
    );
  };

  const handleSaveApiKey = async (
    _projectId: string,
    file: File | null,
    keyId: string,
    issuerId: string,
    appId: string,
    onSuccess?: () => void
  ) => {
    if (!file) {
      showErrorNotification(
        "Select the App Store Connect .p8 key before saving credential changes."
      );
      return;
    }
    if (!bundleId || !keyId.trim() || !issuerId.trim() || !appId.trim()) {
      showErrorNotification(
        "Bundle ID, Apple App ID, Key ID and Issuer ID are required."
      );
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("filename", file.name);
    formData.append("bundle_id", bundleId);
    formData.append("app_apple_id", appId.trim());
    formData.append("key_id", keyId.trim());
    formData.append("issuer_id", issuerId.trim());

    try {
      const response = await iosApiAccessKeyMutation.mutateAsync(formData);
      setIosConfig(response.data.config);
      setApiKeyFilename(file.name);
      setApiKeyFile(null);
      if (apiKeyFileInputRef.current) apiKeyFileInputRef.current.value = "";
      setApiKeyServerError(null);
      showSuccessNotification(
        "App Store credentials encrypted and saved successfully"
      );
      onSuccess?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        const message =
          (error.data as { error?: string })?.error ?? "Invalid Apple key";
        setApiKeyServerError(message);
        showErrorNotification(message);
      } else {
        showGenericError();
      }
    }
  };

  // Keep refs in sync so useCallback closures always call the latest version
  handleSaveConfigurationRef.current = handleSaveConfiguration;
  handleSaveCertificateRef.current = handleSaveCertificate;
  handleSaveApiKeyRef.current = handleSaveApiKey;

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
          bundleId,
          appleAppPrefix,
          saveAndAdvance
        );
        break;
      case "Push Notifications":
        handleSaveCertificate(
          selectedInstance.id,
          certificatePassword,
          pushNotificationCertificateFile,
          saveAndAdvance
        );
        break;
      case "Revenue":
        handleSaveApiKey(
          selectedInstance.id,
          apiKeyFile,
          appStoreKeyId,
          appStoreIssuerId,
          appleAppId,
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
      showSuccessNotification("iOS setup complete!");
      setWizardMode(false);
    } else {
      showErrorNotification("Register your app in step 1 to complete setup.");
      setCurrentStep(0);
      setVisitedSteps(ALL_STEP_INDICES);
    }
  };

  const initializeValues = (config: PlatformAppConfig | null) => {
    if (!selectedInstance) return;
    setUrlScheme(selectedInstance.uri_scheme);

    setAssociatedDomainProd("applinks:" + selectedInstance.production.domain);
    setAssociatedDomainTest("applinks:" + selectedInstance.test.domain);

    const URL = process.env.NEXT_PUBLIC_API_URL;

    setAppstoreURLSandbox(
      URL + "/api/v1/iap/apple/test/" + selectedInstance.test.hash_id
    );
    setAppstoreURLProduction(
      URL +
        "/api/v1/iap/apple/production/" +
        selectedInstance.production.hash_id
    );

    if (!config || !config.configuration) {
      setBundleId("");
      setAppleAppPrefix("");

      setCertificate(null);
      setCertificatePassword("");
      setPushNotificationCertificateFile(null);
      setAppleAppId("");
      setAppStoreKeyId("");
      setAppStoreIssuerId("");
      setApiKeyFilename("");
      setApiKeyFile(null);
      if (apiKeyFileInputRef.current) apiKeyFileInputRef.current.value = "";
    } else {
      const cfg = config.configuration;
      setBundleId(cfg?.bundle_id ?? "");
      setAppleAppPrefix(cfg?.app_prefix ?? "");
      if (cfg?.push_configuration) {
        setCertificate(cfg.push_configuration.certificate ?? null);
        setCertificatePassword(String(cfg.push_configuration.key_id ?? ""));
      } else {
        setCertificate(null);
        setCertificatePassword("");
        setPushNotificationCertificateFile(null);
      }
      setAppleAppId(cfg.app_apple_id ?? "");
      if (cfg.server_api_key) {
        setAppStoreKeyId(cfg.server_api_key.key_id ?? "");
        setAppStoreIssuerId(cfg.server_api_key.issuer_id ?? "");
        setApiKeyFilename(
          cfg.server_api_key.filename ?? cfg.server_api_key.file ?? ""
        );
        setApiKeyFile(null);
      } else {
        setAppStoreKeyId("");
        setAppStoreIssuerId("");
        setApiKeyFilename("");
        setApiKeyFile(null);
      }
      if (apiKeyFileInputRef.current) apiKeyFileInputRef.current.value = "";
    }
  };

  // Reset all state when project/instance changes.
  // initializeValues reads selectedInstance from closure — use a ref to avoid
  // adding it (and its transitive deps) to the dependency array.
  const initializeValuesRef = useRef(initializeValues);
  initializeValuesRef.current = initializeValues;

  useEffect(() => {
    if (!selectedInstance) return;
    setIosConfig(null);
    setCurrentStep(0);
    setVisitedSteps(new Set([0]));
    setWizardMode(false);
    setDetailsChanged(false);
    setCertificateChanged(false);
    setApiKeyChanged(false);
    initializeValuesRef.current(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset when instance ID changes, not on every selectedInstance reference change
  }, [selectedInstance?.id]);

  useEffect(() => {
    if (!instanceConfig) {
      return;
    }

    const found = instanceConfig.find(
      (config: PlatformAppConfig) => config.platform === IOS
    );
    if (instanceConfig.length > 0 && found) {
      setIosConfig(found);
      initializeValuesRef.current(found);
    } else {
      setIosConfig(null);
      initializeValuesRef.current(null);
    }
  }, [instanceConfig]);

  useEffect(() => {
    monitorDetailsChange(iosConfig);
  }, [monitorDetailsChange, iosConfig]);

  useEffect(() => {
    monitorCertificateChange(iosConfig);
  }, [monitorCertificateChange, iosConfig]);

  useEffect(() => {
    monitorApiKeyChange(iosConfig);
  }, [monitorApiKeyChange, iosConfig]);

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
          iosConfig={iosConfig}
          bundleId={bundleId}
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
            platformLabel="iOS Setup"
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
                    bundleId={bundleId}
                    setBundleId={setBundleId}
                    appleAppPrefix={appleAppPrefix}
                    setAppleAppPrefix={setAppleAppPrefix}
                    showValidationErrors={showValidationErrors}
                  />
                )}

                {/* Step: URL Scheme */}
                {stepName(currentStep) === "URL Scheme" && (
                  <Step1URLScheme
                    urlScheme={urlScheme}
                    associatedDomainProd={associatedDomainProd}
                    associatedDomainTest={associatedDomainTest}
                  />
                )}

                {/* Step: Add the SDK */}
                {stepName(currentStep) === "Add the SDK" && <Step2AddSDK />}

                {/* Step: Push Notifications */}
                {stepName(currentStep) === "Push Notifications" && (
                  <Step3PushNotifications
                    certificate={certificate}
                    certificatePassword={certificatePassword}
                    setCertificatePassword={setCertificatePassword}
                    pushNotificationCertificateFile={
                      pushNotificationCertificateFile
                    }
                    fileInputRef={fileInputRef}
                    onCertificateFileChange={
                      handleSetPushNotificationCertificateFile
                    }
                    showValidationErrors={showValidationErrors}
                    serverError={pushServerError}
                  />
                )}

                {/* Step: App Store Server Notifications */}
                {stepName(currentStep) === "Revenue" && (
                  <Step4Revenue
                    appstoreURLProduction={appstoreURLProduction}
                    appstoreURLSandbox={appstoreURLSandbox}
                    appleAppId={appleAppId}
                    setAppleAppId={setAppleAppId}
                    appStoreKeyId={appStoreKeyId}
                    setAppStoreKeyId={setAppStoreKeyId}
                    appStoreIssuerId={appStoreIssuerId}
                    setAppStoreIssuerId={setAppStoreIssuerId}
                    apiKeyFilename={apiKeyFilename}
                    apiKeyFile={apiKeyFile}
                    fileInputRef={apiKeyFileInputRef}
                    onApiKeyFileChange={handleSetApiKeyFile}
                    showValidationErrors={showValidationErrors}
                    serverError={apiKeyServerError}
                  />
                )}

                {/* Step: Initialize the SDK */}
                {stepName(currentStep) === "Initialize SDK" && (
                  <Step5InitializeSDK
                    appDelegateCode={app_delegate_code}
                    sceneDelegateCode={scene_delegate_code}
                    reactNativeCode={react_native_code}
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
                iosConfigMutation.isPending ||
                iosPushConfigMutation.isPending ||
                iosApiAccessKeyMutation.isPending
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
              This will clear the bundle ID, Apple App Prefix, and disable deep
              linking for this app. This action cannot be undone.
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
                  handleSetIosConfig(selectedInstance.id, false, "", "");
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

export default IosSetupPage;
