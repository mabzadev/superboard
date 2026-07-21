"use client";

import { LoginForm } from "@/components/loginForm/login-form";
import { ACCOUNT_LOGIN, SSO_LOGIN } from "@/constants/OptionsConstants";
import { useUserContext } from "@/context/useUserContext";

import LocalStorage from "@/lib/LocalStorage";
import { useEffect, useRef, useState } from "react";
import { showErrorNotification } from "@/lib/Notifications";
import { ApiError } from "@/lib/ApiError";
import { useRouter, useSearchParams } from "next/navigation";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  loginSchema,
  loginWithOtpSchema,
  type LoginFormValues,
} from "@/schemas/auth";

interface SSOReturnData {
  authToken: string | null;
  refreshToken: string | null;
  redirectUrl: string;
}

const LOGIN_DEFAULT_VALUES: LoginFormValues = {
  email: "",
  password: "",
  otp: "",
};

export default function LoginPage() {
  const { loginUser, getSSOAuthenticationLink, userRef, isHydrated } =
    useUserContext();
  const [otpEnabled, setOtpEnabled] = useState<boolean>(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  const backToRef = useRef<string | null>(null);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(otpEnabled ? loginWithOtpSchema : loginSchema),
    mode: "onChange",
    defaultValues: LOGIN_DEFAULT_VALUES,
  });

  const handleLogin = async (data: LoginFormValues): Promise<void> => {
    LocalStorage.setLoginType(ACCOUNT_LOGIN);
    try {
      const response = await loginUser(
        data.email,
        data.password,
        data.otp ?? ""
      );
      if (response.data.requires_otp) {
        setOtpEnabled(true);
        return;
      }
      const backTo = backToRef.current;
      router.push(backTo && backTo.startsWith("/") ? backTo : "/");
    } catch (error) {
      if (otpEnabled) {
        form.setValue("otp", "");
      }
      if (
        error instanceof ApiError &&
        (error.data as Record<string, unknown>)?.error === "invalid_grant"
      ) {
        showErrorNotification(
          otpEnabled
            ? "Invalid OTP code. Please try again."
            : "Provided credentials are invalid"
        );
      } else if (error instanceof ApiError) {
        showErrorNotification(error.message);
      }
    }
  };

  const handleSSOAuthWindow = (
    authWindow: Window | null,
    redirectURL: string,
    onSuccess: (data: SSOReturnData) => void,
    onFailure: (error: Error) => void
  ): void => {
    // Open a popup window for authentication
    authWindow = window.open(
      redirectURL,
      "SSOAuthWindow",
      "width=600,height=700"
    );

    if (!authWindow) {
      onFailure(
        new Error(
          "Popup window was blocked. Please allow popups for this site."
        )
      );
      return;
    }

    const currentHost = window.location.origin;
    let authCompleted = false;

    // Poll frequently to detect URL changes
    const checkInterval = setInterval(() => {
      if (authWindow!.closed) {
        clearInterval(checkInterval);

        if (!authCompleted) {
          onFailure(
            new Error("Authentication window was closed before completion")
          );
        }
        return;
      }

      try {
        // This will throw if cross-origin
        const currentUrl = authWindow!.location.href;

        // Check if we're back on our domain
        if (authWindow!.location.origin === currentHost) {
          authCompleted = true;
          clearInterval(checkInterval);

          // Extract tokens from URL before any further redirects happen
          const url = new URL(currentUrl);
          const params = new URLSearchParams(url.search);

          // Get tokens from URL parameters
          const authToken =
            params.get("token") ||
            params.get("auth_token") ||
            params.get("access_token");
          const refreshToken = params.get("refresh_token");

          // Store tokens temporarily in sessionStorage before transferring to localStorage
          if (authToken) {
            window.sessionStorage.setItem("authToken", authToken);
          }

          if (refreshToken) {
            window.sessionStorage.setItem("refreshToken", refreshToken);
          }

          // Close the window
          authWindow!.close();

          // Trigger success callback with the tokens
          onSuccess({ authToken, refreshToken, redirectUrl: currentUrl });
        }
      } catch {
        // Cross-origin error - still in external auth flow
      }
    }, 50); // Poll frequently to catch the redirect quickly
  };

  const loginWithSSO = async (sso: string): Promise<void> => {
    const width = 600;
    const height = 700;

    const top = window.top;
    const y = top
      ? top.outerHeight / 2 + top.screenY - height / 2
      : window.outerHeight / 2 + window.screenY - height / 2;
    const x = top
      ? top.outerWidth / 2 + top.screenX - width / 2
      : window.outerWidth / 2 + window.screenX - width / 2;

    const authWindow = window.open(
      "",
      "SSOAuthWindow",
      `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${width}, height=${height}, top=${y}, left=${x}`
    );

    LocalStorage.setLoginType(SSO_LOGIN);

    try {
      const response = await getSSOAuthenticationLink(sso);

      const redirectURL: string = response.data.redirect_url;
      handleSSOAuthWindow(
        authWindow,
        redirectURL,
        (returnData: SSOReturnData) => {
          // Success callback
          if (returnData.authToken != null && returnData.refreshToken != null) {
            LocalStorage.setAuthenticationToken(returnData.authToken);
            LocalStorage.setRefreshToken(returnData.refreshToken);
            sessionStorage.removeItem("authToken");
            sessionStorage.removeItem("refreshToken");
          }

          if (backToRef.current) {
            router.push(backToRef.current);
          } else {
            router.push("/");
          }
        },
        () => {
          // Failure callback — silently ignored
        }
      );
    } catch {}
  };

  useEffect(() => {
    backToRef.current = searchParams.get("backTo");
  }, [searchParams]);

  useEffect(() => {
    if (!isHydrated) return;

    // Mount-only: userRef and backToRef are refs whose .current is read but shouldn't trigger re-runs
    if (userRef.current && !backToRef.current) {
      router.replace("/dashboard");
    }
  }, [isHydrated, router, userRef]);

  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10 w-full">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <LoginForm
          form={form}
          otpEnabled={otpEnabled}
          handleLogin={form.handleSubmit(handleLogin)}
          loginWithSSO={loginWithSSO}
        />
      </div>
    </div>
  );
}
