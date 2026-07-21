"use client";

import {
  RenderCodeBlock,
  SectionHeader,
} from "@/components/developers/SetupShared";
import { ExternalLink, FileCode2 } from "lucide-react";

interface Step1IntentFiltersProps {
  packageNameCode: {
    highlightLines: number[];
    language: string;
    filename: string;
    code: string;
  }[];
}

const Step1IntentFilters = ({ packageNameCode }: Step1IntentFiltersProps) => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={FileCode2}
        title="Add intent filters"
        subtitle="Enable your app to open deep links by adding intent filters to AndroidManifest.xml."
      />

      <RenderCodeBlock data={packageNameCode} />

      <span className="text-xs text-muted-foreground">
        Add this intent filter to your launcher activity in{" "}
        <span className="font-medium text-foreground">AndroidManifest.xml</span>
        .
      </span>
      <a
        href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/android/intent-filter`}
        target="_blank"
        className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
      >
        How to add intent filters on Android
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
};

export default Step1IntentFilters;
