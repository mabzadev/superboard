"use client";

import type { ChangeEvent, RefObject } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/developers/SetupShared";
import { handleCopyText } from "@/lib/copyTextHelper";
import { Copy, ExternalLink, Store } from "lucide-react";
import { FileUpload } from "@/components/common/file-upload";

interface Step4RevenueProps {
  appstoreURLProduction: string;
  appstoreURLSandbox: string;
  appleAppId: string;
  setAppleAppId: (value: string) => void;
  appStoreKeyId: string;
  setAppStoreKeyId: (value: string) => void;
  appStoreIssuerId: string;
  setAppStoreIssuerId: (value: string) => void;
  apiKeyFilename: string;
  apiKeyFile: File | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onApiKeyFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  showValidationErrors: boolean;
  serverError?: string | null;
}

const Step4Revenue = ({
  appstoreURLProduction,
  appstoreURLSandbox,
  appleAppId,
  setAppleAppId,
  appStoreKeyId,
  setAppStoreKeyId,
  appStoreIssuerId,
  setAppStoreIssuerId,
  apiKeyFilename,
  apiKeyFile,
  fileInputRef,
  onApiKeyFileChange,
  showValidationErrors,
  serverError,
}: Step4RevenueProps) => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={Store}
        title="App Store Server Notifications"
        subtitle="Enable real-time purchase and subscription tracking from the App Store."
        badge={
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground"
          >
            Optional
          </Badge>
        }
      />

      <div className="rounded-lg border p-4 space-y-4">
        <div>
          <div className="text-sm font-medium">App Store Connect API</div>
          <p className="text-xs text-muted-foreground">
            The private key is encrypted before storage and is never returned
            to the browser or embedded in the mobile SDK.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Apple App ID</label>
            <Input
              value={appleAppId}
              onChange={(event) => setAppleAppId(event.target.value)}
              placeholder="1234567890"
              inputMode="numeric"
              aria-invalid={showValidationErrors && !appleAppId.trim()}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Key ID</label>
            <Input
              value={appStoreKeyId}
              onChange={(event) => setAppStoreKeyId(event.target.value)}
              placeholder="ABC123DEFG"
              aria-invalid={showValidationErrors && !appStoreKeyId.trim()}
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Issuer ID</label>
          <Input
            value={appStoreIssuerId}
            onChange={(event) => setAppStoreIssuerId(event.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            aria-invalid={showValidationErrors && !appStoreIssuerId.trim()}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Private key (.p8)</label>
          <FileUpload
            fileInputRef={fileInputRef}
            selectedFile={apiKeyFile}
            uploadedFilename={apiKeyFilename}
            onChange={onApiKeyFileChange}
            showError={
              showValidationErrors && !apiKeyFile && !apiKeyFilename
            }
            errorMessage="App Store Connect .p8 key is required"
            accept=".p8"
            serverError={serverError}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Production Server URL</label>
        <div className="flex gap-2">
          <Input
            value={appstoreURLProduction}
            readOnly
            className="font-mono text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            className="pl-3 pr-4 shrink-0 h-9"
            onClick={() => handleCopyText(appstoreURLProduction)}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Sandbox Server URL</label>
        <div className="flex gap-2">
          <Input
            value={appstoreURLSandbox}
            readOnly
            className="font-mono text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            className="pl-3 pr-4 shrink-0 h-9"
            onClick={() => handleCopyText(appstoreURLSandbox)}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          To accurately report revenue from in-app purchases, we need to receive
          real-time notifications from the App Store. This requires adding our
          server URL in App Store Connect under the Production / Sandbox Server
          Notifications section. You can either enter the URL directly in App
          Store Connect or forward these events from your own server to ours.
        </span>
        <a
          target="_blank"
          href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/sdk/ios/revenue`}
          className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
        >
          Learn more about iOS revenue tracking
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
};

export default Step4Revenue;
