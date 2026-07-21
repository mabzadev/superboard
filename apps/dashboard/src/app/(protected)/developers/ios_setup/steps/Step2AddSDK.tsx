"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SPM, COCOAPODS, NPM, YARN } from "@/constants/OptionsConstants";
import { SectionHeader } from "@/components/developers/SetupShared";
import { handleCopyText } from "@/lib/copyTextHelper";
import { Copy, ExternalLink, Package } from "lucide-react";

const Step2AddSDK = () => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={Package}
        title="Add the SDK"
        subtitle="Install the opengrow SDK using your preferred package manager."
      />

      <Tabs defaultValue={SPM} className="gap-4">
        <TabsList>
          <TabsTrigger value={SPM}>SPM</TabsTrigger>
          <TabsTrigger value={COCOAPODS}>Cocoapods</TabsTrigger>
          <TabsTrigger value={NPM}>NPM</TabsTrigger>
          <TabsTrigger value={YARN}>YARN</TabsTrigger>
        </TabsList>
        <TabsContent value={SPM}>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                value={"https://github.com/mbzadev"}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="pl-3 pr-4 shrink-0 h-9"
                onClick={() => handleCopyText("https://github.com/mbzadev")}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              To integrate a new SPM package on iOS, go to Xcode, select
              &apos;File&apos; → &apos;Swift Packages&apos; → &apos;Add Package
              Dependency...&apos;, then paste the package&apos;s URL.
            </span>
            <a
              href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/ios/spm`}
              target="_blank"
              className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
            >
              Show me how to integrate a SPM package on iOS
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </TabsContent>
        <TabsContent value={COCOAPODS}>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                value={"pod 'OpenGrow'"}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="pl-3 pr-4 shrink-0 h-9"
                onClick={() => handleCopyText("pod 'OpenGrow'")}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              To integrate a new CocoaPods package, add the package name and
              version to your Podfile, then run pod install in your terminal.
            </span>
            <a
              href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/ios/cocoapods`}
              target="_blank"
              className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
            >
              Show me how to integrate the library using Cocoapods
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </TabsContent>
        <TabsContent value={NPM}>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                value={"npm install @mbzadev/opengrow-react-native"}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="pl-3 pr-4 shrink-0 h-9"
                onClick={() =>
                  handleCopyText("npm install @mbzadev/opengrow-react-native")
                }
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              Integrating npm packages into a React Native app is a
              straightforward process that allows you to extend your app&apos;s
              functionality using our SDK.
            </span>
            <a
              href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/react-native/npm`}
              target="_blank"
              className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
            >
              Show me how to integrate the library using NPM
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </TabsContent>
        <TabsContent value={YARN}>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                value={"yarn add @mbzadev/opengrow-react-native"}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="pl-3 pr-4 shrink-0 h-9"
                onClick={() =>
                  handleCopyText("yarn add @mbzadev/opengrow-react-native")
                }
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              Integrating yarn packages into a React Native app is a
              straightforward process that allows you to extend your app&apos;s
              functionality using our SDK.
            </span>
            <a
              href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/react-native/yarn`}
              target="_blank"
              className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
            >
              Show me how to integrate the library using YARN
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Step2AddSDK;
