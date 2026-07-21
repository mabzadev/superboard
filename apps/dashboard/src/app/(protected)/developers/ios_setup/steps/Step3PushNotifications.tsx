"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/developers/SetupShared";
import { FileUpload } from "@/components/common/file-upload";
import { cn } from "@/lib/utils";
import { AlertCircle, Bell, ExternalLink } from "lucide-react";

interface Step3PushNotificationsProps {
  certificate: string | null;
  certificatePassword: string;
  setCertificatePassword: (value: string) => void;
  pushNotificationCertificateFile: File | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onCertificateFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  showValidationErrors: boolean;
  serverError?: string | null;
}

const Step3PushNotifications = ({
  certificate,
  certificatePassword,
  setCertificatePassword,
  pushNotificationCertificateFile,
  fileInputRef,
  onCertificateFileChange,
  showValidationErrors,
  serverError,
}: Step3PushNotificationsProps) => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={Bell}
        title="Push Notifications"
        subtitle="Optional — upload your APNs certificate to enable push notifications."
        badge={
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground"
          >
            Optional
          </Badge>
        }
      />

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Upload certificate</label>
        <FileUpload
          fileInputRef={fileInputRef}
          selectedFile={pushNotificationCertificateFile}
          uploadedFilename={certificate}
          onChange={onCertificateFileChange}
          showError={showValidationErrors}
          errorMessage="APNs certificate is required"
          accept=".p8"
          serverError={serverError}
        />
        <span className="text-xs text-muted-foreground">
          Used to authenticate and enable push notifications for your iOS app
          through Apple Push Notification Service (APNs). You can generate this
          certificate in the Apple Developer Console under Certificates,
          Identifiers & Profiles → Keys → (+) New → Apple Push Notifications
          service (APNs) → Environment: (Sandbox & Production).
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">P8 APN Key ID</label>
        <Input
          className={cn(
            showValidationErrors && certificatePassword === ""
              ? "border-destructive/50 ring-[3px] ring-destructive/10"
              : ""
          )}
          value={certificatePassword}
          onChange={(e) => setCertificatePassword(e.currentTarget.value)}
          type="text"
          placeholder="Enter the P8 APN Key ID"
        />
        {showValidationErrors && certificatePassword === "" && (
          <Badge variant="destructive" className="w-fit gap-1.5 py-1 px-2.5">
            <AlertCircle className="h-3 w-3" />
            P8 APN Key ID is required
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          The Key ID of the key uploaded above. You can find it in the Apple
          Developer Console under Certificates, Identifiers & Profiles → Keys.
        </span>
        <a
          target="_blank"
          href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/sdk/ios/messages`}
          className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
        >
          Learn more about iOS push notifications
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
};

export default Step3PushNotifications;
