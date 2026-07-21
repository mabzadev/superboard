"use client";
import { useUserContext } from "@/context/useUserContext";
import { useRef, useState } from "react";
import { showGenericError } from "@/lib/Notifications";
import { useRouter, useSearchParams } from "next/navigation";
import { NewPasswordForm } from "@/components/newPasswordForm/NewPasswordForm";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { newPasswordSchema, type NewPasswordFormValues } from "@/schemas/auth";

const Page = () => {
  const { changePassword } = useUserContext();
  const resetTokenRef = useRef<string | null>(null);

  const [passwordRulesValid, setPasswordRulesValid] = useState(false);
  const [showConditions, setShowConditions] = useState(false);

  const searchParams = useSearchParams();

  resetTokenRef.current = searchParams.get("token");

  const router = useRouter();

  const form = useForm<NewPasswordFormValues>({
    resolver: zodResolver(newPasswordSchema),
    mode: "onChange",
    defaultValues: {
      password: "",
      password_confirm: "",
    },
  });

  const handleChangePassword = async (data: NewPasswordFormValues) => {
    if (!passwordRulesValid) {
      setShowConditions(true);
      return;
    }

    if (passwordRulesValid && resetTokenRef.current) {
      try {
        await changePassword(resetTokenRef.current, data.password);
        router.replace("/login");
      } catch {
        showGenericError();
      }
    }
  };

  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10 w-full">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <NewPasswordForm
          form={form}
          setPasswordRulesValid={setPasswordRulesValid}
          passwordRulesValid={passwordRulesValid}
          handleChangePassword={form.handleSubmit(handleChangePassword)}
          showConditions={showConditions}
        />
      </div>
    </div>
  );
};

export default Page;
