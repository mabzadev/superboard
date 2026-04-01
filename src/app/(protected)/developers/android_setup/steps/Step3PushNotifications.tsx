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
  firebaseProjectId: string;
  setFirebaseProjectId: (value: string) => void;
  pushNotificationCertificateFile: File | null;
  fileInputNotificationRef: React.RefObject<HTMLInputElement | null>;
  onCertificateFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  showValidationErrors: boolean;
  serverError?: string | null;
}

const Step3PushNotifications = ({
  certificate,
  firebaseProjectId,
  setFirebaseProjectId,
  pushNotificationCertificateFile,
  fileInputNotificationRef,
  onCertificateFileChange,
  showValidationErrors,
  serverError,
}: Step3PushNotificationsProps) => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={Bell}
        title="Push Notifications"
        subtitle="Optional — upload your Firebase credentials to enable push notifications."
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
        <label className="text-sm font-medium">
          Firebase Service Account JSON Key
        </label>
        <FileUpload
          fileInputRef={fileInputNotificationRef}
          selectedFile={pushNotificationCertificateFile}
          uploadedFilename={certificate}
          onChange={onCertificateFileChange}
          showError={showValidationErrors}
          errorMessage="Firebase service account key is required"
          accept=".json"
          serverError={serverError}
        />
        <span className="text-xs text-muted-foreground">
          Generate from Firebase: Project Settings → Service Accounts → Generate
          new private key.
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Firebase Project ID</label>
        <Input
          className={cn(
            showValidationErrors && firebaseProjectId === ""
              ? "border-destructive/50 ring-[3px] ring-destructive/10"
              : ""
          )}
          value={firebaseProjectId}
          onChange={(e) => setFirebaseProjectId(e.currentTarget.value)}
          placeholder="your-firebase-project-id"
        />
        {showValidationErrors && firebaseProjectId === "" && (
          <Badge variant="destructive" className="w-fit gap-1.5 py-1 px-2.5">
            <AlertCircle className="h-3 w-3" />
            Firebase Project ID is required
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          Found in Firebase Console → Project Settings → General → Project ID.
        </span>
        <a
          target="_blank"
          href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/sdk/android/messages`}
          className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
        >
          Learn more about Android push notifications
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
};

export default Step3PushNotifications;
