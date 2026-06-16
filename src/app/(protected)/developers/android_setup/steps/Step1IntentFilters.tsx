"use client";

import {
  RenderCodeBlock,
  SectionHeader,
} from "@/components/developers/SetupShared";
import { AlertCircle, ExternalLink, FileCode2 } from "lucide-react";

interface Step1IntentFiltersProps {
  packageNameCode: {
    highlightLines: number[];
    language: string;
    filename: string;
    code: string;
  }[];
  hasCustom?: boolean;
}

const Step1IntentFilters = ({
  packageNameCode,
  hasCustom,
}: Step1IntentFiltersProps) => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={FileCode2}
        title="Add intent filters"
        subtitle="Enable your app to open deep links by adding intent filters to AndroidManifest.xml."
      />

      {hasCustom && (
        <div className="flex gap-2 rounded-md border border-sidebar-border bg-muted/40 px-3 py-2 text-xs leading-relaxed">
          <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <span>
            <span className="font-medium">Already shipped?</span> Add these to
            your app and release an update. Old builds won&apos;t open links on
            the custom or migrated domains.
          </span>
        </div>
      )}

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
