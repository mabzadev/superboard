"use client";
import { useUserContext } from "@/context/useUserContext";
import { useState } from "react";
import { RegisterForm } from "@/components/registerForm/RegisterForm";
import { showErrorNotification } from "@/lib/Notifications";
import { ApiError } from "@/lib/ApiError";
import { useRouter, useSearchParams } from "next/navigation";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema, type RegisterFormValues } from "@/schemas/auth";

const Page = () => {
  const { acceptInvitation } = useUserContext();
  const searchParams = useSearchParams();

  const [passwordRulesValid, setPasswordRulesValid] = useState(false);
  const [showConditions, setShowConditions] = useState(false);
  const router = useRouter();

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      email: "",
      password: "",
      password_confirm: "",
    },
  });

  const handleRegister = async (data: RegisterFormValues) => {
    const invitationToken = searchParams.get("token");

    if (!passwordRulesValid) {
      setShowConditions(true);
      return;
    }

    try {
      await acceptInvitation(invitationToken ?? "", data.name, data.password);
      router.replace("/dashboard");
    } catch (error) {
      showErrorNotification(
        error instanceof ApiError
          ? error.message
          : "Something went wrong, please try again"
      );
    }
  };

  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10 w-full">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <RegisterForm
          form={form}
          handleRegister={form.handleSubmit(handleRegister)}
          passwordRulesValid={passwordRulesValid}
          setPasswordRulesValid={setPasswordRulesValid}
          showConditions={showConditions}
          acceptInvite={true}
        />
      </div>
    </div>
  );
};

export default Page;
