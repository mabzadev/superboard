"use client";
import AppHeader from "@/components/layout/app-header";
import { useEffect, useMemo, useRef, useState } from "react";
import FallBackURL from "./FallBackURL";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showGenericError,
  showSuccessNotification,
} from "@/lib/Notifications";
import { httpUrlSchema } from "@/schemas/shared";
import { Button } from "@/components/ui/button";
import { PanelRightClose, PanelRightOpen, Save, Undo2 } from "lucide-react";
import { ANDROID, DESKTOP, IOS, PHONE } from "@/constants/OptionsConstants";
import AndroidRedirect from "./AndroidRedirect";
import IosRedirect from "./IosRedirect";
import ComputersRedirect from "./ComputersRedirect";
import RedirectFlowPanel from "./RedirectFlowPanel";
import type { RedirectPlatformConfig, PlatformAppConfig } from "@/types";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useRedirectConfigQuery } from "@/hooks/queries/useConfigurationQueries";
import { useInstanceConfigQuery } from "@/hooks/queries/useInstanceQueries";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  useSetDefaultRedirectMutation,
  useSetRedirectMutation,
} from "@/hooks/mutations/useConfigurationMutations";
import { useForm, FormProvider } from "react-hook-form";
import type { RedirectRulesFormValues } from "@/schemas/redirect";

const defaultFormValues: RedirectRulesFormValues = {
  defaultUrl: "",
  android: {
    enabled: false,
    appStore: false,
    customUrl: "",
    showPreview: false,
  },
  ios: {
    enabled: false,
    appStore: true,
    customUrl: "",
    showPreview: false,
  },
  desktop: {
    generatedPage: true,
    customUrl: "",
  },
};

function buildFormValuesFromServer(
  config:
    | {
        default_fallback: string;
        show_preview_android: boolean;
        show_preview_ios: boolean;
        android?: RedirectPlatformConfig;
        ios?: RedirectPlatformConfig;
        desktop?: RedirectPlatformConfig;
      }
    | undefined
): RedirectRulesFormValues {
  if (!config) return defaultFormValues;

  const androidPhone = config.android?.phone;
  const iosPhone = config.ios?.phone;
  const desktopAll = config.desktop?.all;

  return {
    defaultUrl: config.default_fallback || "",
    android: {
      enabled: !!androidPhone?.enabled,
      appStore: !!androidPhone?.appstore,
      customUrl: androidPhone?.fallback_url || "",
      showPreview: !!config.show_preview_android,
    },
    ios: {
      enabled: !!iosPhone?.enabled,
      appStore: iosPhone?.appstore != null ? !!iosPhone.appstore : true,
      customUrl: iosPhone?.fallback_url || "",
      showPreview: !!config.show_preview_ios,
    },
    desktop: {
      generatedPage:
        desktopAll?.appstore != null ? !!desktopAll.appstore : true,
      customUrl: desktopAll?.fallback_url || "",
    },
  };
}

const RedirectRulesPage = () => {
  const { selectedProject, selectedInstance } = useProjectSelection();

  const projectId = selectedProject?.id;
  const { data: instanceConfig } = useInstanceConfigQuery(selectedInstance?.id);

  const { data: projectRedirectsConfig } = useRedirectConfigQuery(projectId);

  const queryClient = useQueryClient();
  const setDefaultRedirectMutation = useSetDefaultRedirectMutation(projectId);
  const setRedirectMutation = useSetRedirectMutation(projectId);

  // Guard to prevent intermediate query refetches from resetting the form mid-save
  const isSavingRef = useRef(false);

  const form = useForm<RedirectRulesFormValues>({
    mode: "onChange",
    defaultValues: defaultFormValues,
  });

  const { watch, setValue, reset } = form;

  // Watch all values for reactive UI
  const defaultUrl = watch("defaultUrl");
  const androidEnabled = watch("android.enabled");
  const androidStore = watch("android.appStore");
  const androidCustomUrl = watch("android.customUrl");
  const androidShowPreview = watch("android.showPreview");
  const iosEnabled = watch("ios.enabled");
  const iosStore = watch("ios.appStore");
  const iosCustomUrl = watch("ios.customUrl");
  const iosShowPreview = watch("ios.showPreview");
  const desktopGeneratedPage = watch("desktop.generatedPage");
  const desktopCustomUrl = watch("desktop.customUrl");

  // Server config snapshots for change detection
  const [androidRedirectConfig, setAndroidRedirectConfig] =
    useState<RedirectPlatformConfig | null>(null);
  const [iOSRedirectConfig, setIOSRedirectConfig] =
    useState<RedirectPlatformConfig | null>(null);
  const [desktopRedirectConfig, setDesktopRedirectConfig] =
    useState<RedirectPlatformConfig | null>(null);

  // SDK platform configs
  const [androidConfig, setAndroidConfig] = useState<PlatformAppConfig | null>(
    null
  );
  const [iosConfig, setIosConfig] = useState<PlatformAppConfig | null>(null);

  // UI-only state
  const [showErrorsFallback, setShowErrorsFallback] = useState<boolean>(false);
  const [showErrorsAndroid, setShowErrorsAndroid] = useState<boolean>(false);
  const [showErrorsIos, setShowErrorsIos] = useState<boolean>(false);
  const [showErrorsDesktop, setShowErrorsDesktop] = useState<boolean>(false);
  const [flowPanelOpen, setFlowPanelOpen] = useState<boolean>(true);

  const fallbackRef = useRef<HTMLDivElement>(null);
  const androidRef = useRef<HTMLDivElement>(null);
  const iosRef = useRef<HTMLDivElement>(null);
  const desktopRef = useRef<HTMLDivElement>(null);

  // --- Change detection ---

  const fallbackChanges = useMemo(() => {
    if (!projectRedirectsConfig) return false;
    if (projectRedirectsConfig.default_fallback) {
      return (
        defaultUrl !== projectRedirectsConfig.default_fallback &&
        defaultUrl !== ""
      );
    }
    return defaultUrl !== "";
  }, [defaultUrl, projectRedirectsConfig]);

  const isBehaviourChangedAndroid = () => {
    if (
      androidShowPreview === false &&
      !projectRedirectsConfig?.show_preview_android
    ) {
      return false;
    }
    return androidShowPreview !== projectRedirectsConfig?.show_preview_android;
  };

  const isBehaviourChangedIOS = () => {
    if (iosShowPreview === false && !projectRedirectsConfig?.show_preview_ios) {
      return false;
    }
    return iosShowPreview !== projectRedirectsConfig?.show_preview_ios;
  };

  const androidChanges = useMemo(() => {
    if (!androidRedirectConfig) return false;
    let haveChanged = false;
    if (androidRedirectConfig?.phone) {
      if (androidRedirectConfig?.phone?.fallback_url) {
        if (
          androidEnabled !== androidRedirectConfig?.phone?.enabled ||
          androidStore !== androidRedirectConfig?.phone?.appstore ||
          androidCustomUrl !== androidRedirectConfig?.phone?.fallback_url
        ) {
          haveChanged = true;
        }
      } else if (
        androidEnabled !== androidRedirectConfig?.phone?.enabled ||
        androidStore !== androidRedirectConfig?.phone?.appstore ||
        androidCustomUrl !== ""
      ) {
        haveChanged = true;
      }
    } else {
      if (
        androidEnabled !== false ||
        androidStore !== false ||
        androidCustomUrl !== ""
      ) {
        haveChanged = true;
      }
    }
    const behaviourChanged =
      androidShowPreview === false &&
      !projectRedirectsConfig?.show_preview_android
        ? false
        : androidShowPreview !== projectRedirectsConfig?.show_preview_android;
    return haveChanged || behaviourChanged;
  }, [
    androidEnabled,
    androidStore,
    androidCustomUrl,
    androidShowPreview,
    androidRedirectConfig,
    projectRedirectsConfig,
  ]);

  const iosChanges = useMemo(() => {
    if (!iOSRedirectConfig) return false;
    let haveChanged = false;
    if (iOSRedirectConfig?.phone) {
      if (iOSRedirectConfig?.phone?.fallback_url) {
        if (
          iosEnabled !== iOSRedirectConfig?.phone?.enabled ||
          iosStore !== iOSRedirectConfig?.phone?.appstore ||
          iosCustomUrl !== iOSRedirectConfig?.phone?.fallback_url
        ) {
          haveChanged = true;
        }
      } else if (
        iosEnabled !== iOSRedirectConfig?.phone?.enabled ||
        iosStore !== iOSRedirectConfig?.phone?.appstore ||
        iosCustomUrl !== ""
      ) {
        haveChanged = true;
      }
    } else {
      if (iosEnabled !== false || iosStore !== true || iosCustomUrl !== "") {
        haveChanged = true;
      }
    }
    const behaviourChanged =
      iosShowPreview === false && !projectRedirectsConfig?.show_preview_ios
        ? false
        : iosShowPreview !== projectRedirectsConfig?.show_preview_ios;
    return haveChanged || behaviourChanged;
  }, [
    iosEnabled,
    iosStore,
    iosCustomUrl,
    iosShowPreview,
    iOSRedirectConfig,
    projectRedirectsConfig,
  ]);

  const desktopChanges = useMemo(() => {
    if (!desktopRedirectConfig) return false;
    let haveChanged = false;
    if (desktopRedirectConfig.all) {
      if (desktopGeneratedPage) {
        if (desktopGeneratedPage !== desktopRedirectConfig?.all?.appstore) {
          haveChanged = true;
        }
      } else {
        if (desktopRedirectConfig?.all?.fallback_url !== desktopCustomUrl) {
          haveChanged = true;
        }
      }
    } else {
      if (desktopGeneratedPage !== true || desktopCustomUrl !== "") {
        haveChanged = true;
      }
    }
    return haveChanged;
  }, [desktopGeneratedPage, desktopCustomUrl, desktopRedirectConfig]);

  const hasAnyChanges =
    fallbackChanges || androidChanges || iosChanges || desktopChanges;

  // --- Validation ---

  const isDefaultUrlValid = () => {
    if (
      defaultUrl === "" ||
      (defaultUrl && httpUrlSchema.safeParse(defaultUrl).success)
    ) {
      return true;
    }
    return false;
  };

  const androidValidConfig = useMemo(() => {
    if (!androidEnabled) {
      if (androidRedirectConfig?.phone?.fallback_url) {
        return (
          httpUrlSchema.safeParse(androidCustomUrl).success ||
          androidCustomUrl === ""
        );
      }
      if (androidCustomUrl) {
        return httpUrlSchema.safeParse(androidCustomUrl).success;
      }
      return androidCustomUrl === "" || androidCustomUrl == null;
    }
    if (androidStore) return true;
    return (
      androidCustomUrl != null &&
      androidCustomUrl.length > 0 &&
      httpUrlSchema.safeParse(androidCustomUrl).success
    );
  }, [androidEnabled, androidCustomUrl, androidStore, androidRedirectConfig]);

  const iosValidConfig = useMemo(() => {
    if (!iosEnabled) {
      if (iOSRedirectConfig?.phone?.fallback_url) {
        return (
          httpUrlSchema.safeParse(iosCustomUrl).success || iosCustomUrl === ""
        );
      }
      if (iosCustomUrl) {
        return httpUrlSchema.safeParse(iosCustomUrl).success;
      }
      return iosCustomUrl === "" || iosCustomUrl == null;
    }
    if (iosStore) return true;
    return (
      iosCustomUrl != null &&
      iosCustomUrl.length > 0 &&
      httpUrlSchema.safeParse(iosCustomUrl).success
    );
  }, [iosEnabled, iosCustomUrl, iosStore, iOSRedirectConfig]);

  const isDesktopUrlValid = () => {
    if (desktopGeneratedPage) return true;
    return (
      desktopCustomUrl != null &&
      desktopCustomUrl.length > 0 &&
      httpUrlSchema.safeParse(desktopCustomUrl).success
    );
  };

  // --- API handlers ---

  const handleSetRedirect = async (
    platform: string,
    variation: string,
    appStore: boolean,
    fallbackUrl: string | null,
    enabled: boolean
  ) => {
    try {
      const response = await setRedirectMutation.mutateAsync({
        platform,
        variation,
        appstore: appStore,
        fallbackUrl,
        enabled,
      });
      return response.data.redirect_config;
    } catch {
      showGenericError();
      throw new Error(`Failed to set ${platform} redirect`);
    }
  };

  const handleSetDefaultRedirect = async () => {
    let normalizedUrl = defaultUrl?.trim();
    if (normalizedUrl && !/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    try {
      const response = await setDefaultRedirectMutation.mutateAsync({
        defaultFallback: normalizedUrl,
        showAndroidPreview: androidShowPreview,
        showIosPreview: iosShowPreview,
      });
      setValue("defaultUrl", normalizedUrl, { shouldDirty: false });
      return response.data.redirect_config;
    } catch {
      showGenericError();
      throw new Error("Failed to set default redirect");
    }
  };

  const handleSaveAndroid = async () => {
    if (androidEnabled) {
      if (androidStore) {
        return handleSetRedirect(ANDROID, PHONE, true, null, true);
      } else {
        return handleSetRedirect(ANDROID, PHONE, false, androidCustomUrl, true);
      }
    } else {
      return handleSetRedirect(ANDROID, PHONE, false, androidCustomUrl, false);
    }
  };

  const handleSaveIos = async () => {
    if (iosEnabled) {
      if (iosStore) {
        return handleSetRedirect(IOS, PHONE, true, null, true);
      } else {
        return handleSetRedirect(IOS, PHONE, false, iosCustomUrl, true);
      }
    } else {
      return handleSetRedirect(IOS, PHONE, false, iosCustomUrl, false);
    }
  };

  const handleSaveDesktop = async () => {
    if (desktopGeneratedPage) {
      return handleSetRedirect(DESKTOP, DESKTOP, true, null, true);
    } else {
      if (desktopCustomUrl !== "") {
        return handleSetRedirect(
          DESKTOP,
          DESKTOP,
          false,
          desktopCustomUrl,
          true
        );
      } else {
        return handleSetRedirect(DESKTOP, DESKTOP, false, null, true);
      }
    }
  };

  // --- Save all ---

  const handleSaveAll = async () => {
    if (fallbackChanges) setShowErrorsFallback(true);
    if (androidChanges) setShowErrorsAndroid(true);
    if (iosChanges) setShowErrorsIos(true);
    if (desktopChanges) setShowErrorsDesktop(true);

    // Check which platforms need SDK but don't have it
    const androidSdkMissing =
      androidChanges &&
      androidEnabled &&
      !androidConfig?.configuration?.identifier;
    const iosSdkMissing =
      iosChanges && iosEnabled && !iosConfig?.configuration?.bundle_id;

    // Block save if any changed platform has an empty visible URL field
    const androidUrlRequired =
      androidChanges &&
      !androidSdkMissing &&
      ((!androidEnabled && androidCustomUrl === "") ||
        (androidEnabled && !androidStore && androidCustomUrl === ""));
    const iosUrlRequired =
      iosChanges &&
      !iosSdkMissing &&
      ((!iosEnabled && iosCustomUrl === "") ||
        (iosEnabled && !iosStore && iosCustomUrl === ""));
    const desktopUrlRequired =
      desktopChanges && !desktopGeneratedPage && desktopCustomUrl === "";

    if (androidUrlRequired || iosUrlRequired || desktopUrlRequired) {
      const ref = androidUrlRequired
        ? androidRef
        : iosUrlRequired
          ? iosRef
          : desktopRef;
      setTimeout(
        () =>
          ref.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
        50
      );
      return;
    }

    const defaultUrlValid = isDefaultUrlValid();
    const androidValid = androidValidConfig;
    const iosValid = iosValidConfig;
    const desktopValid = isDesktopUrlValid();

    // Validate non-SDK-blocked platforms
    if (
      !defaultUrlValid ||
      (androidChanges && !androidSdkMissing && !androidValid) ||
      (iosChanges && !iosSdkMissing && !iosValid) ||
      (desktopChanges && !desktopValid)
    ) {
      const ref = !defaultUrlValid
        ? fallbackRef
        : androidChanges && !androidSdkMissing && !androidValid
          ? androidRef
          : iosChanges && !iosSdkMissing && !iosValid
            ? iosRef
            : desktopRef;
      setTimeout(
        () =>
          ref.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
        50
      );
      return;
    }

    // Check if there are any saveable changes
    const hasAndroidSaveable = androidChanges && !androidSdkMissing;
    const hasIosSaveable = iosChanges && !iosSdkMissing;
    const hasSaveableChanges =
      fallbackChanges || hasAndroidSaveable || hasIosSaveable || desktopChanges;

    // If all changes are SDK-blocked, show warning and return
    if (!hasSaveableChanges && (androidSdkMissing || iosSdkMissing)) {
      const skippedPlatforms = [
        androidSdkMissing && "Android",
        iosSdkMissing && "iOS",
      ].filter(Boolean);
      showErrorNotification(
        `${skippedPlatforms.join(" and ")} app redirect requires SDK configuration. Configure the SDK first.`
      );
      return;
    }

    if (!hasSaveableChanges) {
      return;
    }

    // Prevent intermediate query refetches from resetting the form mid-save
    isSavingRef.current = true;

    try {
      // Save default fallback first if needed
      if (fallbackChanges) {
        await handleSetDefaultRedirect();
      }

      // Save Android (skip if SDK missing)
      if (hasAndroidSaveable && androidValid) {
        const androidBehaviourChanges = isBehaviourChangedAndroid();
        if (androidBehaviourChanges && defaultUrlValid) {
          await handleSetDefaultRedirect();
        }
        await handleSaveAndroid();
      }

      // Save iOS (skip if SDK missing)
      if (hasIosSaveable && iosValid) {
        const iosBehaviourChanges = isBehaviourChangedIOS();
        if (iosBehaviourChanges && defaultUrlValid) {
          await handleSetDefaultRedirect();
        }
        await handleSaveIos();
      }

      // Save Desktop
      if (desktopChanges && desktopValid) {
        await handleSaveDesktop();
      }

      setShowErrorsFallback(false);
      setShowErrorsAndroid(false);
      setShowErrorsIos(false);
      setShowErrorsDesktop(false);

      // Show appropriate notification
      const skippedPlatforms = [
        androidSdkMissing && "Android",
        iosSdkMissing && "iOS",
      ].filter(Boolean);

      if (skippedPlatforms.length > 0) {
        showSuccessNotification(
          `Settings saved. ${skippedPlatforms.join(" and ")} app redirect was skipped — configure the SDK first.`
        );
      } else {
        showSuccessNotification("Settings saved successfully!");
      }
    } catch {
      showGenericError();
    } finally {
      isSavingRef.current = false;
      // Single invalidation after all saves complete — ensures we fetch the final server state
      if (projectId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.redirectConfig(projectId),
        });
      }
    }
  };

  const handleDiscard = () => {
    if (!projectRedirectsConfig) return;
    setShowErrorsFallback(false);
    setShowErrorsAndroid(false);
    setShowErrorsIos(false);
    setShowErrorsDesktop(false);

    const serverValues = buildFormValuesFromServer(projectRedirectsConfig);
    reset(serverValues);
  };

  // --- SDK config from instanceConfig ---

  useEffect(() => {
    if (!instanceConfig) return;
    const androidConfigFound = instanceConfig.find(
      (config: PlatformAppConfig) => config.platform === ANDROID
    );
    const iosConfigFound = instanceConfig.find(
      (config: PlatformAppConfig) => config.platform === IOS
    );

    setAndroidConfig(
      androidConfigFound && instanceConfig.length > 0
        ? androidConfigFound
        : null
    );
    setIosConfig(
      iosConfigFound && instanceConfig.length > 0 ? iosConfigFound : null
    );
  }, [instanceConfig]);

  // --- Load server data into form ---

  useEffect(() => {
    if (!projectRedirectsConfig) return;
    // Skip resetting during an active save — intermediate refetches would
    // overwrite form values with stale server state before all platforms are saved.
    if (isSavingRef.current) return;

    setAndroidRedirectConfig(projectRedirectsConfig.android ?? null);
    setIOSRedirectConfig(projectRedirectsConfig.ios ?? null);
    setDesktopRedirectConfig(projectRedirectsConfig.desktop ?? null);

    const serverValues = buildFormValuesFromServer(projectRedirectsConfig);
    reset(serverValues);
  }, [projectRedirectsConfig, reset]);

  return (
    <FormProvider {...form}>
      <div className="flex flex-col relative overflow-hidden h-dvh">
        <div className="border-b border-sidebar-border">
          <AppHeader />
        </div>
        <div className="flex flex-1 overflow-hidden">
          {/* Left column: scrollable settings */}
          <div
            className={cn(
              "flex flex-col overflow-hidden min-w-0 w-full",
              flowPanelOpen && "min-[1400px]:w-[800px] min-[1400px]:shrink-0"
            )}
          >
            <div className="flex-1 overflow-auto">
              {/* Sticky toolbar: unsaved changes + flow toggle */}
              <div className="sticky top-0 z-10 bg-sidebar/80 backdrop-blur-md border-b border-sidebar-border px-6 py-2 flex items-center gap-3">
                {hasAnyChanges && (
                  <span className="text-xs text-muted-foreground">
                    Unsaved changes in{" "}
                    {[
                      fallbackChanges && "Fallback",
                      androidChanges && "Android",
                      iosChanges && "iOS",
                      desktopChanges && "Desktop",
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                )}
                <div className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden min-[1400px]:inline-flex shrink-0"
                  onClick={() => setFlowPanelOpen(!flowPanelOpen)}
                >
                  {flowPanelOpen ? (
                    <>
                      <PanelRightClose className="h-3.5 w-3.5" />
                      Hide Flow
                    </>
                  ) : (
                    <>
                      <PanelRightOpen className="h-3.5 w-3.5" />
                      Show Flow
                    </>
                  )}
                </Button>
                {hasAnyChanges && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="pl-3 pr-4"
                      onClick={handleDiscard}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      Discard
                    </Button>
                    <Button
                      size="sm"
                      className="pl-3 pr-4"
                      onClick={handleSaveAll}
                    >
                      <Save className="h-3.5 w-3.5" />
                      Save Changes
                    </Button>
                  </>
                )}
              </div>

              <div className="flex flex-col gap-0 px-6 pt-4 pb-16 max-w-[900px]">
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex flex-col gap-0.5 flex-1">
                    <h2 className="text-sm font-semibold">Redirect Rules</h2>
                    <p className="text-xs text-muted-foreground">
                      Configure how links behave across different platforms.
                    </p>
                  </div>
                </div>

                <div ref={fallbackRef}>
                  <FallBackURL showErrors={showErrorsFallback} />
                </div>

                <Separator className="my-6" />

                <div ref={androidRef}>
                  <AndroidRedirect
                    showErrors={showErrorsAndroid}
                    sdkConfigured={!!androidConfig?.configuration?.identifier}
                  />
                </div>

                <Separator className="my-6" />

                <div ref={iosRef}>
                  <IosRedirect
                    showErrors={showErrorsIos}
                    sdkConfigured={!!iosConfig?.configuration?.bundle_id}
                  />
                </div>

                <Separator className="my-6" />

                <div ref={desktopRef}>
                  <ComputersRedirect showErrors={showErrorsDesktop} />
                </div>
              </div>
            </div>
          </div>

          {/* Right column: flow diagram */}
          <div
            className={cn(
              "flex-1 flex-col border-l border-sidebar-border bg-sidebar overflow-auto",
              flowPanelOpen ? "hidden min-[1400px]:flex" : "hidden"
            )}
          >
            <RedirectFlowPanel
              androidApp={androidEnabled}
              androidStore={androidStore}
              androidCustomUrl={androidCustomUrl}
              androidShowPreview={androidShowPreview}
              iosApp={iosEnabled}
              iosStore={iosStore}
              iosCustomUrl={iosCustomUrl}
              iosShowPreview={iosShowPreview}
              desktopGeneratedPage={desktopGeneratedPage}
              desktopCustomUrl={desktopCustomUrl}
              defaultUrl={defaultUrl}
            />
          </div>
        </div>
      </div>
    </FormProvider>
  );
};

export default RedirectRulesPage;
