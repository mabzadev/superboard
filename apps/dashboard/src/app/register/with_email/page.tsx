"use client";
import { useUserContext } from "@/context/useUserContext";
import { useState } from "react";

import { RegisterForm } from "@/components/registerForm/RegisterForm";
import { showGenericError } from "@/lib/Notifications";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema, type RegisterFormValues } from "@/schemas/auth";

const REGISTER_DEFAULT_VALUES: RegisterFormValues = {
  name: "",
  email: "",
  password: "",
  password_confirm: "",
};

const Page = () => {
  const { createUser } = useUserContext();
  const [passwordRulesValid, setPasswordRulesValid] = useState(false);
  const [showConditions, setShowConditions] = useState(false);
  const router = useRouter();

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    mode: "onChange",
    defaultValues: REGISTER_DEFAULT_VALUES,
  });

  const handleRegister = async (data: RegisterFormValues) => {
    if (!passwordRulesValid) {
      setShowConditions(true);
      return;
    }

    try {
      await createUser(data.email, data.password, data.name);
      router.replace("/");
    } catch {
      showGenericError();
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
        />
      </div>
    </div>
  );
};

export default Page;
