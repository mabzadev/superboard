"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/developers/SetupShared";
import { shaSchema } from "@/schemas/shared";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Check,
  ExternalLink,
  Plus,
  Smartphone,
  Trash2,
} from "lucide-react";

interface Step0RegisterAppProps {
  packageName: string;
  setPackageName: (value: string) => void;
  shaList: string[];
  setShaList: React.Dispatch<React.SetStateAction<string[]>>;
  showValidationErrors: boolean;
  onRemoveSha: (index: number) => void;
}

const Step0RegisterApp = ({
  packageName,
  setPackageName,
  shaList,
  setShaList,
  showValidationErrors,
  onRemoveSha,
}: Step0RegisterAppProps) => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={Smartphone}
        title="Register the app"
        subtitle="Add your package name and SHA-256 fingerprints to enable deep linking."
      />

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Package Name</label>
        <div className="flex w-full relative">
          <Input
            className={cn(
              "pr-10 transition-all",
              packageName.length > 0
                ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
                : showValidationErrors
                  ? "border-destructive/50 ring-[3px] ring-destructive/10"
                  : ""
            )}
            placeholder="com.example.myapp"
            value={packageName}
            onChange={(e) => setPackageName(e.currentTarget.value)}
          />
          {packageName.length > 0 && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center h-5 w-5 rounded-full bg-valid-green-light">
              <Check className="h-3 w-3 text-valid-green" />
            </div>
          )}
        </div>
        {showValidationErrors && packageName.length === 0 && (
          <Badge variant="destructive" className="w-fit gap-1.5 py-1 px-2.5">
            <AlertCircle className="h-3 w-3" />
            Package name is required
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          Found in your app&apos;s build.gradle or AndroidManifest.xml.
        </span>
        <a
          href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/android/package-name`}
          target="_blank"
          className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
        >
          How to find your package name
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">SHA-256 Fingerprints</label>
        <div className="flex flex-col gap-2">
          {(shaList.length === 0 ? [""] : shaList).map((item, index) => (
            <div className="flex gap-2 items-center" key={`sha-${index}`}>
              <div className="flex w-full relative">
                <Input
                  className={cn(
                    "pr-10 transition-all font-mono text-xs",
                    item.length > 0 && shaSchema.safeParse(item).success
                      ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
                      : item.length > 0 ||
                          (showValidationErrors &&
                            !shaList.some(
                              (s) => shaSchema.safeParse(s).success
                            ))
                        ? "border-destructive/50 ring-[3px] ring-destructive/10"
                        : ""
                  )}
                  placeholder="Enter SHA-256 fingerprint"
                  value={item}
                  onChange={(e) => {
                    const newList = [...shaList];
                    if (shaList.length === 0) {
                      newList.push(e.currentTarget.value);
                    } else {
                      newList[index] = e.currentTarget.value;
                    }
                    setShaList(newList);
                  }}
                />
                {shaSchema.safeParse(item).success && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center h-5 w-5 rounded-full bg-valid-green-light">
                    <Check className="h-3 w-3 text-valid-green" />
                  </div>
                )}
              </div>
              {shaList.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemoveSha(index)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </div>
        {showValidationErrors &&
          !shaList.some((s) => shaSchema.safeParse(s).success) && (
            <Badge variant="destructive" className="w-fit gap-1.5 py-1 px-2.5">
              <AlertCircle className="h-3 w-3" />
              At least one valid SHA-256 fingerprint is required
            </Badge>
          )}
        <Button
          variant="outline"
          size="sm"
          className="pl-3 pr-4 w-fit"
          onClick={() =>
            setShaList((prev) => [...(prev.length === 0 ? [""] : prev), ""])
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Add another fingerprint
        </Button>
        <span className="text-xs text-muted-foreground">
          Copy from &quot;App signing certificate&quot; under &quot;Release
          Management&quot; in Google Play Console. Include keys from all
          environments.
        </span>
        <a
          href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/android/sha256-fingerprint`}
          target="_blank"
          className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
        >
          How to get your SHA-256
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
};

export default Step0RegisterApp;
