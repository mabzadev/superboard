"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/developers/SetupShared";
import { handleCopyText } from "@/lib/copyTextHelper";
import { Copy, ExternalLink, Store } from "lucide-react";

interface Step4RevenueProps {
  appstoreURLProduction: string;
  appstoreURLSandbox: string;
}

const Step4Revenue = ({
  appstoreURLProduction,
  appstoreURLSandbox,
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
