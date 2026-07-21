"use client";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/developers/SetupShared";
import { bundleIdSchema } from "@/schemas/shared";
import { cn } from "@/lib/utils";
import { AlertCircle, Check, ExternalLink, Smartphone } from "lucide-react";

interface Step0RegisterAppProps {
  bundleId: string;
  setBundleId: (value: string) => void;
  appleAppPrefix: string;
  setAppleAppPrefix: (value: string) => void;
  showValidationErrors: boolean;
}

const Step0RegisterApp = ({
  bundleId,
  setBundleId,
  appleAppPrefix,
  setAppleAppPrefix,
  showValidationErrors,
}: Step0RegisterAppProps) => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={Smartphone}
        title="Register the app"
        subtitle="Add your bundle ID and Apple App Prefix to enable deep linking."
      />

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Bundle ID</label>
        <div className="flex w-full relative">
          <Input
            className={cn(
              "pr-10 transition-all",
              bundleIdSchema.safeParse(bundleId).success
                ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
                : showValidationErrors &&
                    !bundleIdSchema.safeParse(bundleId).success
                  ? "border-destructive/50 ring-[3px] ring-destructive/10"
                  : ""
            )}
            placeholder="Enter bundle ID"
            value={bundleId}
            onChange={(e) => setBundleId(e.currentTarget.value)}
          />
          {bundleIdSchema.safeParse(bundleId).success && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center h-5 w-5 rounded-full bg-valid-green-light">
              <Check className="h-3 w-3 text-valid-green" />
            </div>
          )}
        </div>
        {showValidationErrors &&
          !bundleIdSchema.safeParse(bundleId).success && (
            <Badge variant="destructive" className="w-fit gap-1.5 py-1 px-2.5">
              <AlertCircle className="h-3 w-3" />
              {bundleId.length === 0
                ? "Bundle ID is required"
                : "Enter a valid bundle ID (e.g. com.example.app)"}
            </Badge>
          )}
        <span className="text-xs text-muted-foreground">
          The bundle identifier (bundle ID) of an iOS app can be found in the
          Xcode project settings or in the &apos;Info.plist&apos; file, and it
          uniquely identifies the app in the Apple ecosystem.
        </span>
        <a
          href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/ios/bundle-identifier`}
          target="_blank"
          className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
        >
          Show me how to get the bundle id
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Apple App Prefix</label>
        <div className="flex w-full relative">
          <Input
            className={cn(
              "pr-10 transition-all",
              appleAppPrefix.length > 2
                ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
                : showValidationErrors && appleAppPrefix.length <= 2
                  ? "border-destructive/50 ring-[3px] ring-destructive/10"
                  : ""
            )}
            placeholder="Enter Apple App Prefix"
            value={appleAppPrefix}
            onChange={(e) => setAppleAppPrefix(e.currentTarget.value)}
          />
          {appleAppPrefix.length > 2 && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center h-5 w-5 rounded-full bg-valid-green-light">
              <Check className="h-3 w-3 text-valid-green" />
            </div>
          )}
        </div>
        {showValidationErrors && appleAppPrefix.length <= 2 && (
          <Badge variant="destructive" className="w-fit gap-1.5 py-1 px-2.5">
            <AlertCircle className="h-3 w-3" />
            Apple App Prefix is required
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          To find the Apple App Prefix, log in to your Apple Developer account,
          go to Certificates, Identifiers & Profiles, click on your App ID, and
          the prefix (Team ID) will be listed there.
        </span>
        <a
          href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/ios/apple-app-prefix`}
          target="_blank"
          className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
        >
          Show me how to get the Apple App Prefix
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
};

export default Step0RegisterApp;
