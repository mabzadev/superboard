"use client";
import Account2FADialog from "@/components/account/Account2FADialog";
import McpTokensSection from "@/components/account/McpTokensSection";

import { Button } from "@/components/ui/button";
import DeleteConfirm from "@/components/common/delete-confirm";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SSO_LOGIN } from "@/constants/OptionsConstants";
import { useUserContext } from "@/context/useUserContext";
import LocalStorage from "@/lib/LocalStorage";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { ApiError } from "@/lib/ApiError";
import { emailSchema } from "@/schemas/shared";
import { cn } from "@/lib/utils";
import { config } from "@/lib/config";
import { KeyRound, Shield, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const accountSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

type AccountFormValues = z.infer<typeof accountSchema>;

const AccountPage = () => {
  const { removeAccount, editUser, user, resetPassword } = useUserContext();

  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: { name: "" },
    mode: "onChange",
  });

  const [email, setEmail] = useState<string>("");
  const [show2FAModal, setShow2FAModal] = useState<boolean>(false);
  const [optRequired, setOtpRequired] = useState<boolean>(false);
  const router = useRouter();
  const ssoAccountType: string | null = LocalStorage.getLoginType();

  const handleRemoveAccount = async () => {
    setIsSubmitting(true);
    try {
      await removeAccount(user!.email);
      setIsSubmitting(false);
      router.replace("/login");
    } catch {
      setIsSubmitting(false);
    }
  };

  const handleEditUser = async (data: AccountFormValues) => {
    setIsSubmitting(true);
    const objData = {
      name: data.name,
    };
    try {
      await editUser(objData);
      setIsSubmitting(false);
      form.reset({ name: data.name });
      showSuccessNotification("Name updated");
    } catch (error) {
      setIsSubmitting(false);
      showErrorNotification(
        error instanceof ApiError
          ? error.message
          : "Something went wrong, please try again"
      );
    }
  };

  const handleResetPassword = async (email: string) => {
    if (emailSchema.safeParse(email).success) {
      setIsSubmitting(true);
      try {
        await resetPassword(email);
        setIsSubmitting(false);
        showSuccessNotification("Reset password email sent");
      } catch (error) {
        setIsSubmitting(false);
        showErrorNotification(
          error instanceof ApiError
            ? error.message
            : "Something went wrong, please try again"
        );
      }
    }
  };

  useEffect(() => {
    if (!user) {
      return;
    }
    form.reset({ name: user.name });
    setEmail(user.email);
    setOtpRequired(user.otp_required_for_login);
  }, [user, form]);

  return (
    <div className="flex min-h-full flex-col overflow-hidden">
      <Account2FADialog open={show2FAModal} onOpenChange={setShow2FAModal} />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col overflow-hidden min-w-0 w-full">
          <div className="flex-1 overflow-auto">
            <div className="max-w-[800px] px-6 py-8">
              {/* Account Details */}
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">Account Details</span>
                  <span className="text-xs text-muted-foreground">
                    Your personal information associated with this account.
                  </span>
                </div>

                <form
                  onSubmit={form.handleSubmit(handleEditUser)}
                  className="flex flex-col gap-3"
                >
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      Full name
                    </span>
                    <div className="relative max-w-[340px]">
                      <Input
                        {...form.register("name")}
                        className={cn(form.formState.isDirty && "pr-16")}
                      />
                      {form.formState.isDirty && (
                        <Button
                          size="sm"
                          variant="secondary"
                          type="submit"
                          disabled={isSubmitting}
                          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-2.5 text-xs"
                        >
                          Save
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      Email
                    </span>
                    <Input
                      readOnly
                      value={email}
                      className="max-w-[340px] text-muted-foreground bg-muted/30 cursor-default"
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {config.supportEmail ? (
                        <>
                          To change your email, contact{" "}
                          <a
                            href={`mailto:${config.supportEmail}`}
                            className="text-blue-600 dark:text-blue-400 underline underline-offset-4 hover:opacity-80 transition-opacity"
                          >
                            {config.supportEmail}
                          </a>
                        </>
                      ) : (
                        "Email changes are managed by a deployment owner."
                      )}
                    </span>
                  </div>
                </form>
              </div>

              {/* Security */}
              {ssoAccountType !== SSO_LOGIN && (
                <>
                  <Separator className="my-8" />

                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold">Security</span>
                      <span className="text-xs text-muted-foreground">
                        Manage your password and two-factor authentication.
                      </span>
                    </div>

                    <div className="rounded-xl border border-sidebar-border overflow-hidden divide-y divide-sidebar-border">
                      {/* 2FA row */}
                      <div className="flex items-center gap-4 px-5 py-4">
                        <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                          <span className="text-sm font-medium">
                            Two-Factor Authentication
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Add an extra layer of security with an authenticator
                            app.
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div
                            className={cn(
                              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium",
                              optRequired
                                ? "bg-valid-green/10 text-valid-green"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            <div
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                optRequired
                                  ? "bg-valid-green"
                                  : "bg-muted-foreground/40"
                              )}
                            />
                            {optRequired ? "Enabled" : "Off"}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className={cn(
                              optRequired &&
                                "text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                            )}
                            onClick={() => setShow2FAModal(true)}
                          >
                            {optRequired ? "Disable" : "Enable"}
                          </Button>
                        </div>
                      </div>

                      {/* Password row */}
                      <div className="flex items-center gap-4 px-5 py-4">
                        <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                          <span className="text-sm font-medium">Password</span>
                          <span className="text-xs text-muted-foreground">
                            Reset your password via email.
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          disabled={isSubmitting}
                          onClick={() => handleResetPassword(user!.email)}
                        >
                          Reset Password
                        </Button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Connected Apps (MCP) */}
              <Separator className="my-8" />
              <McpTokensSection />

              {/* Danger Zone */}
              <Separator className="my-8" />

              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-0.5 flex-1">
                  <span className="text-sm font-semibold text-destructive">
                    Danger Zone
                  </span>
                  <span className="text-xs text-muted-foreground leading-snug">
                    Permanently delete your account and all associated data.
                    This cannot be undone.
                  </span>
                </div>
                <DeleteConfirm
                  onConfirm={handleRemoveAccount}
                  title="Are you sure you want to remove current account?"
                  description="This action cannot be undone. This will permanently delete the account."
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Account
                  </Button>
                </DeleteConfirm>
              </div>

              <div className="h-12" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountPage;
