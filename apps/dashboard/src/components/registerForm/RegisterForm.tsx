"use client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ReactPasswordChecklist from "react-password-checklist";
import type { UseFormReturn } from "react-hook-form";
import type { RegisterFormValues } from "@/schemas/auth";

export function RegisterForm({
  className,
  form,
  handleRegister,
  showConditions,
  setPasswordRulesValid,
  passwordRulesValid,
  acceptInvite,
  ...props
}: RegisterFormProps) {
  const {
    formState: { isValid, errors },
  } = form;
  const watchedPassword = form.watch("password");
  const watchedPasswordConfirm = form.watch("password_confirm");

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Create your account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRegister}>
            <div className="grid gap-6">
              <div className="grid gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Enter name"
                    required
                    {...form.register("name")}
                  />
                  {errors.name && (
                    <p className="text-sm text-red-600">
                      {errors.name.message}
                    </p>
                  )}
                </div>
                {!acceptInvite && (
                  <div className="grid gap-3">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="Enter email"
                      required
                      {...form.register("email")}
                    />
                    {errors.email && (
                      <p className="text-sm text-red-600">
                        {errors.email.message}
                      </p>
                    )}
                  </div>
                )}
                <div className="grid gap-3">
                  <div className="flex items-center">
                    <Label htmlFor="password">Password</Label>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter password"
                    required
                    {...form.register("password")}
                  />
                </div>
                <div className="grid gap-3">
                  <div className="flex items-center">
                    <Label htmlFor="password_confirm">Confirm password</Label>
                  </div>
                  <Input
                    id="password_confirm"
                    type="password"
                    placeholder="Confirm password"
                    required
                    {...form.register("password_confirm")}
                  />
                </div>
                <div className={showConditions ? "visible" : "hidden"}>
                  <ReactPasswordChecklist
                    iconSize={14}
                    minLength={8}
                    value={watchedPassword}
                    valueAgain={watchedPasswordConfirm}
                    rules={[
                      "minLength",
                      "specialChar",
                      "capital",
                      "lowercase",
                      "number",
                      "match",
                    ]}
                    onChange={(isValid) => setPasswordRulesValid(isValid)}
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={!isValid || !passwordRulesValid}
                >
                  Get started
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

type RegisterFormProps = React.ComponentProps<"div"> & {
  form: UseFormReturn<RegisterFormValues>;
  handleRegister: (e?: React.BaseSyntheticEvent) => void;
  showConditions: boolean;
  setPasswordRulesValid: (valid: boolean) => void;
  passwordRulesValid: boolean;
  acceptInvite?: boolean;
};
