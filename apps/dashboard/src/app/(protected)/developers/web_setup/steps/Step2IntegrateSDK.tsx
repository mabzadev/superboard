"use client";

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

interface Step2IntegrateSDKProps {
  integrateWebSdkCode: CodeBlockData[];
}

const Step2IntegrateSDK = ({ integrateWebSdkCode }: Step2IntegrateSDKProps) => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={Code2}
        title="Integrate the SDK"
        subtitle="Add the initialization code to your web app."
      />

      <div className="flex flex-col gap-3">
        <label className="text-sm font-medium">Integration method</label>
        <RenderCodeBlock data={integrateWebSdkCode} />
        <span className="text-xs text-muted-foreground">
          In the main entry point of your project, initialize the SDK to listen
          for link data, generate links, and set user attributes as needed.
        </span>
        <a
          target="_blank"
          href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/sdk/web/quick-start`}
          className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
        >
          Show me more details about the SDK and its methods
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
};

export default Step2IntegrateSDK;
