"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/developers/SetupShared";
import { handleCopyText } from "@/lib/copyTextHelper";
import { Copy, ExternalLink, Link } from "lucide-react";

interface Step1URLSchemeProps {
  urlScheme: string;
  associatedDomainProd: string;
  associatedDomainTest: string;
}

const Step1URLScheme = ({
  urlScheme,
  associatedDomainProd,
  associatedDomainTest,
}: Step1URLSchemeProps) => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={Link}
        title="Configure URL Scheme"
        subtitle="Set up URL scheme and associated domains for deep linking."
      />

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">URL Scheme</label>
        <div className="flex gap-2">
          <Input value={urlScheme} readOnly className="font-mono text-xs" />
          <Button
            variant="outline"
            size="sm"
            className="pl-3 pr-4 shrink-0 h-9"
            onClick={() => handleCopyText(urlScheme)}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          Add the URL Scheme to your app. To add a new URL scheme in an iOS app,
          update the &apos;Info.plist&apos; file with the desired scheme under
          &apos;URL types&apos;.
        </span>
        <a
          href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/ios/url-scheme`}
          target="_blank"
          className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
        >
          Show me how to add a new URL Scheme on iOS
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Associated Domains</label>
        <div className="flex gap-2">
          <div className="flex w-full relative">
            <Input
              value={associatedDomainProd}
              readOnly
              className="font-mono text-xs pr-24"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-valid-green/10 text-valid-green">
              Production
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="pl-3 pr-4 shrink-0 h-9"
            onClick={() => handleCopyText(associatedDomainProd)}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
        </div>
        <div className="flex gap-2">
          <div className="flex w-full relative">
            <Input
              value={associatedDomainTest}
              readOnly
              className="font-mono text-xs pr-14"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
              Test
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="pl-3 pr-4 shrink-0 h-9"
            onClick={() => handleCopyText(associatedDomainTest)}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          To add a new associated domain to your iOS app, enable the Associated
          Domains capability in Xcode, and add the domain above to the list.
        </span>
        <a
          href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/ios/associated-domain`}
          target="_blank"
          className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
        >
          Show me how to add an associated domain
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
};

export default Step1URLScheme;
