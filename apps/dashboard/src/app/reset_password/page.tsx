"use client";

import { ResetPasswordForm } from "@/components/resetPasswordForm/ResetPasswordForm";

import { useUserContext } from "@/context/useUserContext";
import { showGenericError, showSuccessNotification } from "@/lib/Notifications";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  resetPasswordSchema,
  type ResetPasswordFormValues,
} from "@/schemas/auth";

const Page = () => {
  const { resetPassword } = useUserContext();
  const [linkSent, setLinkSent] = useState(false);

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { email: "" },
    mode: "onChange",
  });

  const handleResetPassword = async (data: ResetPasswordFormValues) => {
    try {
      await resetPassword(data.email);
      setLinkSent(true);
      showSuccessNotification("Email sent");
    } catch {
      showGenericError();
    }
  };

  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10 w-full">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <ResetPasswordForm
          form={form}
          handleResetPassword={handleResetPassword}
          linkSent={linkSent}
        />
      </div>
    </div>
  );
};

export default Page;
