"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GRADLE, NPM, YARN } from "@/constants/OptionsConstants";
import { SectionHeader } from "@/components/developers/SetupShared";
import { handleCopyText } from "@/lib/copyTextHelper";
import { Copy, ExternalLink, Package } from "lucide-react";

interface Step2AddSDKProps {
  releaseTagName: string | undefined;
}

const Step2AddSDK = ({ releaseTagName }: Step2AddSDKProps) => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={Package}
        title="Add the SDK"
        subtitle="Install the opengrow SDK using your preferred package manager."
      />

      <Tabs defaultValue={GRADLE} className="gap-4">
        <TabsList>
          <TabsTrigger value={GRADLE}>Gradle</TabsTrigger>
          <TabsTrigger value={NPM}>NPM</TabsTrigger>
          <TabsTrigger value={YARN}>Yarn</TabsTrigger>
        </TabsList>
        <TabsContent value={GRADLE}>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                value={`implementation(io.opengrow:OpenGrow:${releaseTagName})`}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="pl-3 pr-4 shrink-0 h-9"
                onClick={() =>
                  handleCopyText(
                    `implementation(io.opengrow:OpenGrow:${releaseTagName})`
                  )
                }
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              Add this dependency to your module&apos;s build.gradle file, then
              sync Gradle.
            </span>
            <a
              target="_blank"
              href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/android/gradle`}
              className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
            >
              How to add a package with Gradle
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </TabsContent>
        <TabsContent value={NPM}>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                value="npm install @mbzadev/opengrow-react-native"
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
              For React Native apps, also add{" "}
              <span className="font-mono">
                implementation(io.opengrow:OpenGrow:
                {releaseTagName})
              </span>{" "}
              in your Android app gradle file.
            </span>
            <a
              target="_blank"
              href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/react-native/npm`}
              className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
            >
              How to integrate using NPM
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </TabsContent>
        <TabsContent value={YARN}>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                value="yarn add @mbzadev/opengrow-react-native"
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
              For React Native apps, also add{" "}
              <span className="font-mono">
                implementation(io.opengrow:OpenGrow:
                {releaseTagName})
              </span>{" "}
              in your Android app gradle file.
            </span>
            <a
              target="_blank"
              href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/react-native/yarn`}
              className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
            >
              How to integrate using Yarn
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Step2AddSDK;
