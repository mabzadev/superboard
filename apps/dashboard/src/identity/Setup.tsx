"use client";

import { useEffect, useState, type PropsWithChildren } from "react";
import { Provider, useDispatch } from "react-redux";
import { AlertCircle, Fingerprint, LoaderCircle } from "lucide-react";
import { useProjectSelection } from "@/context/useProjectSelection";
import LocalStorage from "@/lib/LocalStorage";
import { config } from "@/lib/config";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "identity/components/ui/alert";
import { configSignal, errorSignal } from "signals";
import { defaultIdentityConfig } from "signals/config";
import { appSlice } from "stores/app";
import { authApi } from "services/auth";
import { store, type AppDispatch } from "stores";
import useSignalValue from "./useSignalValue";

export default function Setup({ children }: PropsWithChildren) {
  return (
    <Provider store={store}>
      <ProjectIdentity>{children}</ProjectIdentity>
    </Provider>
  );
}

function ProjectIdentity({ children }: PropsWithChildren) {
  const dispatch = useDispatch<AppDispatch>();
  const { selectedProject, selectedInstance } = useProjectSelection();
  const error = useSignalValue(errorSignal);
  const projectRef = selectedProject?.id ?? null;
  const canAdminister =
    !selectedInstance?.role ||
    selectedInstance.role === "owner" ||
    selectedInstance.role === "admin";
  const [readyProjectRef, setReadyProjectRef] = useState<string | null>(null);
  const [initializationFailed, setInitializationFailed] = useState(false);

  useEffect(() => {
    dispatch(authApi.util.resetApiState());
    dispatch(appSlice.actions.selectProject(projectRef));
    dispatch(
      appSlice.actions.storeAcquireAuthToken(
        async () => LocalStorage.getAuthenticationToken() ?? ""
      )
    );
    setReadyProjectRef(null);
    setInitializationFailed(false);
    configSignal.value = defaultIdentityConfig;
    errorSignal.value = "";
    window.sessionStorage.removeItem("superboard.identity.primaryApp");
    if (!projectRef || !canAdminister) return;

    const controller = new AbortController();
    const loadConfiguration = async () => {
      const runtimeApiUrl =
        (window as Window & { __SUPERBOARD_API_URL__?: string })
          .__SUPERBOARD_API_URL__ ?? config.apiUrl;
      const base = `${runtimeApiUrl}${config.apiPath}/identity-admin/projects/${encodeURIComponent(projectRef)}`;
      const token = LocalStorage.getAuthenticationToken();
      const headers = {
        accept: "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      };
      const response = await fetch(base, {
        headers,
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as {
        configs?: Record<string, unknown>;
      };
      if (controller.signal.aborted) return;
      configSignal.value = {
        ...defaultIdentityConfig,
        ...(payload.configs ?? {}),
      };
      const appsResponse = await fetch(`${base}/api/v1/apps`, {
        headers,
        credentials: "include",
        signal: controller.signal,
      });
      if (!appsResponse.ok) throw new Error(await appsResponse.text());
      const appsPayload = (await appsResponse.json()) as {
        apps?: Array<{
          clientId?: unknown;
          isActive?: unknown;
          redirectUris?: unknown;
          type?: unknown;
        }>;
      };
      if (controller.signal.aborted) return;
      const primary = appsPayload.apps?.find(
        (app) =>
          app.type === "spa" &&
          app.isActive === true &&
          typeof app.clientId === "string" &&
          Array.isArray(app.redirectUris) &&
          typeof app.redirectUris[0] === "string"
      );
      if (primary && Array.isArray(primary.redirectUris)) {
        window.sessionStorage.setItem(
          "superboard.identity.primaryApp",
          JSON.stringify({
            clientId: primary.clientId,
            redirectUri: primary.redirectUris[0],
          })
        );
      }
      setReadyProjectRef(projectRef);
    };
    void loadConfiguration().catch((cause) => {
      if (!controller.signal.aborted) {
        setInitializationFailed(true);
        errorSignal.value =
          cause instanceof Error
            ? cause.message
            : "Identity configuration could not be loaded.";
      }
    });
    return () => controller.abort();
  }, [canAdminister, dispatch, projectRef]);

  if (!projectRef) {
    return (
      <div className="flex min-h-80 items-center justify-center gap-3 text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
        Loading the selected project…
      </div>
    );
  }
  if (!canAdminister) {
    return (
      <div className="mx-auto max-w-2xl p-6 md:p-10">
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Administrator access required</AlertTitle>
          <AlertDescription>
            Identity settings can be changed only by a project owner or
            administrator.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const isReady = readyProjectRef === projectRef;

  return (
    <section className="identity-admin mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-4 md:p-7">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Fingerprint className="size-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Identity</h1>
          <p className="text-sm text-muted-foreground">
            Authentication, users, organizations, access and SSO for this
            project.
          </p>
        </div>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Identity request failed</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}
      {!isReady && !initializationFailed && (
        <div className="flex min-h-64 items-center justify-center gap-3 text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin" />
          Loading Identity configuration…
        </div>
      )}
      {isReady ? children : null}
    </section>
  );
}
