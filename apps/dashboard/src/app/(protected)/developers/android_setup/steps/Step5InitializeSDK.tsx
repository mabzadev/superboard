"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ANDROID, REACT_NATIVE } from "@/constants/OptionsConstants";
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
  sdkAndroidCode: CodeBlockData[];
  sdkLauncherActivityCode: CodeBlockData[];
  sdkHandleDeepLinksCode: CodeBlockData[];
  reactNativeCode: CodeBlockData[];
  sdkReactNativeAppCode: CodeBlockData[];
}

const Step5InitializeSDK = ({
  sdkAndroidCode,
  sdkLauncherActivityCode,
  sdkHandleDeepLinksCode,
  reactNativeCode,
  sdkReactNativeAppCode,
}: Step5InitializeSDKProps) => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={Code2}
        title="Initialize the SDK"
        subtitle="Add the initialization code to your app."
      />

      <Tabs defaultValue={ANDROID} className="gap-4">
        <TabsList>
          <TabsTrigger value={ANDROID}>Android</TabsTrigger>
          <TabsTrigger value={REACT_NATIVE}>React Native</TabsTrigger>
        </TabsList>

        <TabsContent
          value={ANDROID}
          className="gap-5 flex flex-col data-[state=inactive]:hidden"
          forceMount
        >
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium">Application</label>
            <RenderCodeBlock data={sdkAndroidCode} />
            <span className="text-xs text-muted-foreground">
              Initialize the SDK in your Application class onCreate() method.
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium">Launcher Activity</label>
            <RenderCodeBlock data={sdkLauncherActivityCode} />
            <span className="text-xs text-muted-foreground">
              Add deep link handling code to your launcher activity.
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium">Handle Deep Links</label>
            <RenderCodeBlock data={sdkHandleDeepLinksCode} />
            <span className="text-xs text-muted-foreground">
              Register a listener or collect the flow to receive links and
              payloads.
            </span>
            <a
              target="_blank"
              href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/sdk/android/quick-start`}
              className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
            >
              Full SDK documentation
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </TabsContent>

        <TabsContent
          value={REACT_NATIVE}
          className="gap-5 flex flex-col data-[state=inactive]:hidden"
          forceMount
        >
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium">Application</label>
            <RenderCodeBlock data={reactNativeCode} />
            <span className="text-xs text-muted-foreground">
              Initialize the SDK in your Application class onCreate() method.
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium">Launcher Activity</label>
            <RenderCodeBlock data={sdkLauncherActivityCode} />
            <span className="text-xs text-muted-foreground">
              Add deep link handling code to your launcher activity.
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium">Handle Deep Links</label>
            <RenderCodeBlock data={sdkReactNativeAppCode} />
            <span className="text-xs text-muted-foreground">
              Listen for events from the callback on the JS side.
            </span>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Step5InitializeSDK;
