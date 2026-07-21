"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  APP_DELEGATE,
  SCENE_DELEGATE,
  REACT_NATIVE,
} from "@/constants/OptionsConstants";
import {
  RenderCodeBlock,
  SectionHeader,
} from "@/components/developers/SetupShared";
import { Code2, ExternalLink } from "lucide-react";

interface CodeBlockData {
  highlightLines: number[];
  language: string;
  filename: string;
  code: string;
}

interface Step5InitializeSDKProps {
  appDelegateCode: CodeBlockData[];
  sceneDelegateCode: CodeBlockData[];
  reactNativeCode: CodeBlockData[];
}

const Step5InitializeSDK = ({
  appDelegateCode,
  sceneDelegateCode,
  reactNativeCode,
}: Step5InitializeSDKProps) => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={Code2}
        title="Initialize the SDK"
        subtitle="Add the initialization code to your app."
      />

      <Tabs defaultValue={APP_DELEGATE} className="gap-4">
        <TabsList>
          <TabsTrigger value={APP_DELEGATE}>App Delegate</TabsTrigger>
          <TabsTrigger value={SCENE_DELEGATE}>Scene Delegate</TabsTrigger>
          <TabsTrigger value={REACT_NATIVE}>React Native</TabsTrigger>
        </TabsList>

        <TabsContent
          value={APP_DELEGATE}
          forceMount
          className="gap-5 flex flex-col data-[state=inactive]:hidden"
        >
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium">App Delegate</label>
            <RenderCodeBlock data={appDelegateCode} />
            <a
              target="_blank"
              href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/sdk/ios/quick-start`}
              className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
            >
              Show me more details about the SDK and its methods
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </TabsContent>

        <TabsContent
          value={SCENE_DELEGATE}
          forceMount
          className="gap-5 flex flex-col data-[state=inactive]:hidden"
        >
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium">Scene Delegate</label>
            <RenderCodeBlock data={sceneDelegateCode} />
            <a
              target="_blank"
              href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/sdk/ios/quick-start`}
              className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
            >
              Show me more details about the SDK and its methods
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </TabsContent>

        <TabsContent
          value={REACT_NATIVE}
          forceMount
          className="gap-5 flex flex-col data-[state=inactive]:hidden"
        >
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium">React Native</label>
            <RenderCodeBlock data={reactNativeCode} />
            <a
              target="_blank"
              href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/sdk/ios/quick-start`}
              className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
            >
              Show me more details about the SDK and its methods
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Step5InitializeSDK;
