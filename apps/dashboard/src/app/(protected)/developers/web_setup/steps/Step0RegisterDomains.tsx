"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/developers/SetupShared";
import { cn } from "@/lib/utils";
import { isDomainValid } from "@/lib/domainValidation";
import {
  AlertCircle,
  Check,
  ExternalLink,
  Globe,
  Plus,
  Trash2,
} from "lucide-react";

interface Step0RegisterDomainsProps {
  domainList: string[];
  setDomainList: React.Dispatch<React.SetStateAction<string[]>>;
  showErrors: boolean;
  setShowErrors: (value: boolean) => void;
  onRemoveDomain: (index: number) => void;
}

const Step0RegisterDomains = ({
  domainList,
  setDomainList,
  showErrors,
  setShowErrors,
  onRemoveDomain,
}: Step0RegisterDomainsProps) => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={Globe}
        title="Register Domains"
        subtitle="Register all domains that will use the SDK, including production, test, and development domains."
      />

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Domain list</label>
        <div className="flex flex-col gap-2">
          {(domainList.length === 0 ? [""] : domainList).map((item, index) => {
            const hasError = item.length > 0 && !isDomainValid(item);
            const isEmpty = item.length === 0 && showErrors;
            const isValid = item.length > 0 && isDomainValid(item);
            return (
              <div className="flex flex-col gap-1.5" key={`domain-${index}`}>
                <div className="flex gap-2 items-center">
                  <div className="flex w-full relative">
                    <Input
                      className={cn(
                        "pr-10 transition-all font-mono text-xs",
                        hasError || isEmpty
                          ? "border-destructive/50 ring-[3px] ring-destructive/10"
                          : isValid
                            ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
                            : ""
                      )}
                      placeholder="https://example.com"
                      value={item}
                      onChange={(e) => {
                        const newList = [...domainList];
                        if (domainList.length === 0) {
                          newList.push(e.currentTarget.value);
                        } else {
                          newList[index] = e.currentTarget.value;
                        }
                        setDomainList(newList);
                        setShowErrors(false);
                      }}
                    />
                    {isValid && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center h-5 w-5 rounded-full bg-valid-green-light">
                        <Check className="h-3 w-3 text-valid-green" />
                      </div>
                    )}
                  </div>
                  {domainList.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Remove domain"
                      onClick={() => onRemoveDomain(index)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
                {(hasError || isEmpty) && showErrors && (
                  <Badge
                    variant="destructive"
                    className="w-fit gap-1.5 py-1 px-2.5"
                  >
                    <AlertCircle className="h-3 w-3" />
                    {isEmpty
                      ? "A domain URL is required"
                      : "URL must start with http:// or https://"}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="pl-3 pr-4 w-fit"
          onClick={() =>
            setDomainList((prev) => [...(prev.length === 0 ? [""] : prev), ""])
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Add another domain
        </Button>
        <span className="text-xs text-muted-foreground">
          Register all domains that will use the SDK, including all production,
          test, and development domains. This ensures the SDK functions
          correctly across different environments.
        </span>
        <a
          href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/web/register-domains`}
          target="_blank"
          className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
        >
          Show me more details about the domains
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
};

export default Step0RegisterDomains;
