"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RenderCodeBlock,
  SectionHeader,
} from "@/components/developers/SetupShared";
import { FileUpload } from "@/components/common/file-upload";
import { handleCopyText } from "@/lib/copyTextHelper";
import { Copy, Download, ExternalLink, Store } from "lucide-react";

interface Step4RevenueProps {
  appstoreWebhookURL: string;
  webhookAuthKey: string;
  webhookAuthKeyFile: File | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onWebhookFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDownloadGoogleConfigScript: () => void;
  googleScriptCode: {
    highlightLines: number[];
    language: string;
    filename: string;
    code: string;
  }[];
  showValidationErrors: boolean;
  serverError?: string | null;
}

const Step4Revenue = ({
  appstoreWebhookURL,
  webhookAuthKey,
  webhookAuthKeyFile,
  fileInputRef,
  onWebhookFileChange,
  onDownloadGoogleConfigScript,
  googleScriptCode,
  showValidationErrors,
  serverError,
}: Step4RevenueProps) => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={Store}
        title="Google Play Real-Time Notifications"
        subtitle="Enable real-time purchase and subscription tracking from Google Play."
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
        <label className="text-sm font-medium">Automatic setup script</label>
        <Button
          variant="outline"
          size="sm"
          className="pl-3 pr-4 w-fit"
          onClick={onDownloadGoogleConfigScript}
        >
          <Download className="h-3.5 w-3.5" />
          Download Script
        </Button>
        <span className="text-xs text-muted-foreground">
          This script automates your Google Cloud Platform setup. It creates the
          needed GCP resources and generates a service account key file to
          upload below. Run it in Google Cloud Shell:
        </span>
        <RenderCodeBlock data={googleScriptCode} />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Notifications endpoint</label>
        <div className="flex gap-2">
          <Input
            value={appstoreWebhookURL}
            readOnly
            className="font-mono text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            className="pl-3 pr-4 shrink-0 h-9"
            onClick={() => handleCopyText(appstoreWebhookURL)}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          Add this URL in Google Play Console or forward events from your
          server.
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">
          Google Play API Authentication Key
        </label>
        <FileUpload
          fileInputRef={fileInputRef}
          selectedFile={webhookAuthKeyFile}
          uploadedFilename={webhookAuthKey}
          onChange={onWebhookFileChange}
          showError={showValidationErrors}
          errorMessage="Google Play API key file is required"
          accept=".json"
          serverError={serverError}
        />
        <span className="text-xs text-muted-foreground">
          Upload the JSON key file for your Google Cloud Service Account. Must
          have access to the Android Publisher API.
        </span>
        <a
          target="_blank"
          href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/sdk/android/revenue`}
          className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
        >
          Learn more about Android revenue tracking
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
};

export default Step4Revenue;
