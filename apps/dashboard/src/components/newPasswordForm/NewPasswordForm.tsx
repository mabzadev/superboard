"use client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ReactPasswordChecklist from "react-password-checklist";
import type { UseFormReturn } from "react-hook-form";
import type { NewPasswordFormValues } from "@/schemas/auth";

export function NewPasswordForm({
  className,
  form,
  handleChangePassword,
  showConditions,
  setPasswordRulesValid,
  passwordRulesValid,
  ...props
}: NewPasswordFormProps) {
  const {
    formState: { isValid },
  } = form;
  const watchedPassword = form.watch("password");
  const watchedPasswordConfirm = form.watch("password_confirm");

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">New password</CardTitle>
          <CardDescription>
            Pick a new password to use for your login credentials.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword}>
            <div className="grid gap-6">
              <div className="grid gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    required
                    {...form.register("password")}
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="password_confirm">Password confirm</Label>
                  <Input
                    id="password_confirm"
                    type="password"
                    placeholder="Confirm your password"
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
                  Change password
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

type NewPasswordFormProps = React.ComponentProps<"div"> & {
  form: UseFormReturn<NewPasswordFormValues>;
  handleChangePassword: (e?: React.BaseSyntheticEvent) => void;
  setPasswordRulesValid: (valid: boolean) => void;
  passwordRulesValid: boolean;
  showConditions: boolean;
};
