import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useUserContext } from "@/context/useUserContext";
import { showGenericError } from "@/lib/Notifications";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

const Account2FADialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { enable2FA, getOTPQrcode, handleSetUser, user } = useUserContext();
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [qrCodeSvg, setQrCodeSvg] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const isDisabling = user?.otp_required_for_login;
  const code = digits.join("");

  const resetDigits = useCallback(() => {
    setDigits(["", "", "", "", "", ""]);
    inputRefs.current[0]?.focus();
  }, []);

  const handleGetQrCode = useCallback(async () => {
    try {
      const response = await getOTPQrcode();
      setQrCodeSvg(response.data);
    } catch {}
  }, [getOTPQrcode]);

  const handleEnable2FA = useCallback(
    async (enable: boolean, otpCode: string) => {
      try {
        const response = await enable2FA(enable, otpCode);
        resetDigits();
        handleSetUser(response.data.user);
        onOpenChange(false);
      } catch {
        resetDigits();
        showGenericError();
      }
    },
    [enable2FA, resetDigits, handleSetUser, onOpenChange]
  );

  const handleSubmit = useCallback(() => {
    handleEnable2FA(!isDisabling, code);
  }, [handleEnable2FA, isDisabling, code]);

  const handleDigitChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    // Handle paste of full code
    if (value.length > 1) {
      const pasted = value.slice(0, 6).split("");
      const newDigits = [...digits];
      pasted.forEach((d, i) => {
        if (index + i < 6) newDigits[index + i] = d;
      });
      setDigits(newDigits);
      const nextIndex = Math.min(index + pasted.length, 5);
      inputRefs.current[nextIndex]?.focus();
      return;
    }

    const newDigits = [...digits];
    newDigits[index] = value;
    setDigits(newDigits);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  useEffect(() => {
    if (!open) {
      resetDigits();
      setQrCodeSvg(null);
      return;
    }
    handleGetQrCode();
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  }, [open, resetDigits, handleGetQrCode]);

  useEffect(() => {
    if (code.length === 6) {
      handleSubmit();
    }
  }, [code, handleSubmit]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="2fa-dialog"
        className="flex flex-col w-full max-w-[420px] gap-0 p-0 overflow-hidden"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Two-Factor Authentication</DialogTitle>
          <DialogDescription>
            {isDisabling ? "Disable" : "Enable"} two-factor authentication
          </DialogDescription>
        </DialogHeader>

        {/* Header */}
        <div className="px-6 pt-6 pb-5">
          <h3 className="text-lg font-semibold tracking-tight">
            {isDisabling ? "Disable 2FA" : "Enable Two-Factor Authentication"}
          </h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {isDisabling
              ? "Enter your 6-digit code to confirm disabling two-factor authentication."
              : "Strengthen your account security by requiring a verification code at every sign-in."}
          </p>
        </div>

        {/* QR Code (enable flow only) */}
        {!isDisabling && (
          <div className="px-6 py-5 border-b border-sidebar-border">
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-xl border border-sidebar-border bg-white p-3">
                {qrCodeSvg ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    className="w-[160px] h-[160px]"
                    src={`data:image/svg+xml;base64,${btoa(qrCodeSvg)}`}
                    alt="2FA QR Code"
                  />
                ) : (
                  <div className="w-[160px] h-[160px] animate-pulse bg-muted rounded-lg" />
                )}
              </div>
              <div className="flex flex-col items-center gap-1 text-center">
                <span className="text-xs font-medium">
                  Scan with your authenticator app
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Google Authenticator, Microsoft Authenticator, Authy, or
                  similar.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* OTP Input */}
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Enter 6-digit verification code
            </span>
            <div className="flex gap-2 justify-between">
              {digits.map((digit, index) => (
                <React.Fragment key={`digit-${index}`}>
                  {index === 3 && (
                    <div className="flex items-center px-0.5">
                      <div className="w-2 h-px bg-sidebar-border" />
                    </div>
                  )}
                  <Input
                    ref={(el) => {
                      inputRefs.current[index] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={index === 0 ? 6 : 1}
                    value={digit}
                    onChange={(e) => handleDigitChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    className="w-11 h-12 text-center text-lg font-semibold tabular-nums px-0 focus-visible:ring-primary"
                  />
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="px-6 pb-6">
          <Button
            className="w-full"
            size="lg"
            variant={isDisabling ? "destructive" : "default"}
            onClick={handleSubmit}
            disabled={code.length < 6}
          >
            {isDisabling
              ? "Disable Two-Factor Authentication"
              : "Enable Two-Factor Authentication"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default Account2FADialog;
