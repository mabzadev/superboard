"use client";

import { LoginForm } from "@/components/loginForm/login-form";
import { ACCOUNT_LOGIN } from "@/constants/OptionsConstants";
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

const LOGIN_DEFAULT_VALUES: LoginFormValues = {
  email: "",
  password: "",
  otp: "",
};

export default function LoginPage() {
  const { loginUser, userRef, isHydrated } = useUserContext();
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
        />
      </div>
    </div>
  );
}
