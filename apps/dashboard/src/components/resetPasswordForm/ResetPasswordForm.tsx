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
import Link from "next/link";
import type { UseFormReturn } from "react-hook-form";
import type { ResetPasswordFormValues } from "@/schemas/auth";

export function ResetPasswordForm({
  className,
  form,
  handleResetPassword,
  linkSent,
  ...props
}: ResetPasswordFormProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            {linkSent ? "Check your e-mail!" : "Reset password"}
          </CardTitle>
          <CardDescription>
            {linkSent
              ? "We have sent a password recover instructions to your email."
              : "  Enter the email address associated with your account and we'll send you a link to reset your password."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(handleResetPassword)}>
            <div className="grid gap-6">
              <div className="grid gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="m@example.com"
                    required
                    {...form.register("email")}
                  />
                  {form.formState.errors.email && (
                    <p className="text-sm text-red-600">
                      {form.formState.errors.email.message}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {linkSent && (
                    <div className="text-start text-sm">
                      <Link
                        href="#"
                        className=" text-sm underline-offset-4 hover:underline "
                      >
                        Did not receive the e-mail ??
                      </Link>
                    </div>
                  )}
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={!form.formState.isValid}
                  >
                    {linkSent ? "Send again" : "Send link"}
                  </Button>
                </div>
                <div className=" text-start text-m gap-5">
                  <p className="text-sm flex gap-1 center">
                    Not a member ?
                    <a
                      href="/register"
                      className="text-sm underline-offset-4 underline "
                    >
                      Create an account
                    </a>
                  </p>
                </div>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

type ResetPasswordFormProps = React.ComponentProps<"div"> & {
  form: UseFormReturn<ResetPasswordFormValues>;
  handleResetPassword: (data: ResetPasswordFormValues) => void;
  linkSent: boolean;
};
