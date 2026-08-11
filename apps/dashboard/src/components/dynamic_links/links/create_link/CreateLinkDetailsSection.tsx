"use client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { Input } from "@/components/ui/input";
import { handleCopyText } from "@/lib/copyTextHelper";
import { cn, deepClone } from "@/lib/utils";
import { AlertCircle, Check, Copy, Trash2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChevronDown } from "lucide-react";
import Image from "next/image";

import QcLinkIcon from "@/assets/icons/ads_platform/superboard.svg";
import GoogleIcon from "@/assets/icons/ads_platform/google.svg";
import GoogleIconWhite from "@/assets/icons/ads_platform/google_dark_mode.svg";
import FacebookIcon from "@/assets/icons/ads_platform/facebook.svg";
import FacebookIconWhite from "@/assets/icons/ads_platform/facebook_dark_mode.svg";
import LinkedInIcon from "@/assets/icons/ads_platform/linkedIn.svg";
import LinkedInIconWhite from "@/assets/icons/ads_platform/linkedIn_dark_mode.svg";
import TikTokIcon from "@/assets/icons/ads_platform/tiktok.svg";
import TikTokIconWhite from "@/assets/icons/ads_platform/tiktok_dark_mode.svg";
import {
  GOOGLE,
  LINKEDIN,
  META,
  QUICK_LINK,
  TIKTOK,
} from "@/constants/OptionsConstants";
import { useTheme } from "next-themes";

import React, { useRef, useState } from "react";

const CreateLinkDetailsSection = React.memo(function CreateLinkDetailsSection({
  path,
  setPath,
  name,
  setName,
  tags,
  setTagList,
  domain,
  pathAvailable,
  linkType,
  setLinkType,
  disabledActions,
  showErrors,
}: {
  path: string;
  setPath: (value: string) => void;
  setName: (value: string) => void;
  setTagList: React.Dispatch<React.SetStateAction<string[]>>;
  name: string;
  tags: string[];
  domain: string;
  pathAvailable: boolean;
  linkType: string;
  setLinkType: (value: string) => void;
  disabledActions?: boolean;
  showErrors?: boolean;
}) {
  const { resolvedTheme } = useTheme();

  const linkTypes = [
    {
      label: "Quick Link",
      value: QUICK_LINK,
      icon: QcLinkIcon,
      iconDark: QcLinkIcon,
      desc: "General-purpose link for social media, sharing, or any campaign",
    },
    {
      label: "Google Ads",
      value: GOOGLE,
      icon: GoogleIcon,
      iconDark: GoogleIconWhite,
      desc: "Optimized for Google search and display campaigns",
    },
    {
      label: "Meta Ads",
      value: META,
      icon: FacebookIcon,
      iconDark: FacebookIconWhite,
      desc: "Tailored for Facebook and Instagram ad campaigns",
    },
    {
      label: "LinkedIn",
      value: LINKEDIN,
      icon: LinkedInIcon,
      iconDark: LinkedInIconWhite,
      desc: "Designed for professional and B2B marketing",
    },
    {
      label: "TikTok Ads",
      value: TIKTOK,
      icon: TikTokIcon,
      iconDark: TikTokIconWhite,
      desc: "Built for short-form video ad campaigns",
    },
  ];

  const selectedType =
    linkTypes.find((t) => t.value === linkType) ?? linkTypes[0]!;

  const [tagName, setTagName] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const handleCopy = () => {
    handleCopyText(domain + path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddTag = (tag: string) => {
    if (tagName === "") {
      return;
    }
    setTagList((prev: string[]) => {
      return [...prev, tag];
    });
    setTagName("");
  };

  const handleRemoveTag = (index: number) => {
    const list = deepClone(tags);
    list.splice(index, 1);
    setTagList(list);
  };

  return (
    <div className="flex flex-1 flex-col ">
      <div className="flex flex-1 flex-col gap-2 overflow-auto">
        <div className="flex flex-col gap-6 px-6 md:gap-6 md:py-6 max-w-[800px]">
          {/* Required fields */}
          <div className="flex flex-col gap-5">
            {/* URL */}
            <div
              className="flex flex-col gap-2"
              role="group"
              aria-labelledby="url-label"
            >
              <div className="flex items-center justify-between">
                <label
                  id="url-label"
                  htmlFor="link-path"
                  className="text-sm font-medium"
                >
                  URL
                </label>
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground"
                >
                  Required
                </Badge>
              </div>
              <div
                className={cn(
                  "flex items-center rounded-md border bg-muted/30 px-4 py-3 transition-all cursor-text",
                  path.length >= 3 && !pathAvailable
                    ? "border-destructive/50 ring-[3px] ring-destructive/10"
                    : path.length >= 3 && pathAvailable
                      ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
                      : showErrors && path.length < 3
                        ? "border-destructive/50 ring-[3px] ring-destructive/10"
                        : "border-sidebar-border"
                )}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest("button")) {
                    document.getElementById("link-path")?.focus();
                  }
                }}
              >
                <span className="text-sm text-muted-foreground select-none">
                  {domain}
                </span>
                <span className="relative inline-flex mx-0.5">
                  <span className="text-sm font-medium invisible whitespace-pre px-0.5">
                    {path || "your-path"}
                  </span>
                  <input
                    id="link-path"
                    className="absolute inset-0 text-sm font-medium bg-transparent outline-none border-b border-dashed border-muted-foreground/40 focus:border-primary px-0.5 transition-colors w-full"
                    placeholder="your-path"
                    value={path}
                    readOnly={disabledActions}
                    aria-invalid={
                      (path.length >= 3 && !pathAvailable) ||
                      (showErrors && path.length < 3)
                    }
                    aria-describedby="path-error path-description"
                    onChange={(e) => setPath(e.currentTarget.value)}
                  />
                </span>
                <div className="ml-auto pl-3 flex items-center gap-2">
                  {path.length >= 3 && pathAvailable && (
                    <div className="flex items-center justify-center h-5 w-5 rounded-full bg-valid-green-light">
                      <Check className="h-3 w-3 text-valid-green" />
                    </div>
                  )}
                  {!disabledActions && (
                    <Button
                      disabled={!pathAvailable}
                      size="sm"
                      variant={copied ? "default" : "secondary"}
                      className="h-7 px-3 text-xs font-medium"
                      onClick={handleCopy}
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
              {path.length >= 3 && !pathAvailable && (
                <Badge
                  id="path-error"
                  role="alert"
                  variant="destructive"
                  className="w-fit gap-1.5 py-1 px-2.5"
                >
                  <AlertCircle className="h-3 w-3" />
                  This path is already taken — try a different one
                </Badge>
              )}
              {showErrors && path.length < 3 && (
                <Badge
                  id="path-error"
                  role="alert"
                  variant="destructive"
                  className="w-fit gap-1.5 py-1 px-2.5"
                >
                  <AlertCircle className="h-3 w-3" />
                  URL path is required
                </Badge>
              )}
              <span
                id="path-description"
                className="text-xs text-muted-foreground"
              >
                Unique path for your dynamic link.
              </span>
            </div>

            {/* Name */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor="link-name" className="text-sm font-medium">
                  Name
                </label>
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground"
                >
                  Required
                </Badge>
              </div>
              <Input
                id="link-name"
                placeholder="Enter the link name ..."
                value={name}
                readOnly={disabledActions}
                onChange={(e) => setName(e.currentTarget.value)}
                aria-invalid={
                  (name.length > 0 && name.length < 3) ||
                  (showErrors && name.length === 0)
                }
                aria-describedby="name-error name-description"
                className={cn(
                  "transition-all",
                  name.length > 0 && name.length < 3
                    ? "border-destructive/50 ring-[3px] ring-destructive/10"
                    : name.length >= 3
                      ? "border-valid-green/30 ring-[2px] ring-valid-green/5"
                      : showErrors && name.length === 0
                        ? "border-destructive/50 ring-[3px] ring-destructive/10"
                        : "border-amber-300/50 ring-[2px] ring-amber-200/10"
                )}
              />
              {name.length > 0 && name.length < 3 && (
                <Badge
                  id="name-error"
                  role="alert"
                  variant="destructive"
                  className="w-fit gap-1.5 py-1 px-2.5"
                >
                  <AlertCircle className="h-3 w-3" />
                  Name must be at least 3 characters
                </Badge>
              )}
              {showErrors && name.length === 0 && (
                <Badge
                  id="name-error"
                  role="alert"
                  variant="destructive"
                  className="w-fit gap-1.5 py-1 px-2.5"
                >
                  <AlertCircle className="h-3 w-3" />
                  Name is required
                </Badge>
              )}
              <span
                id="name-description"
                className="text-xs text-muted-foreground"
              >
                Internal only — not visible to end users.
              </span>
            </div>
          </div>

          <Separator />

          {/* Link Type */}
          <div className="flex flex-col gap-2">
            <label id="link-type-label" className="text-sm font-medium">
              Type
            </label>
            <Popover open={typeOpen} onOpenChange={setTypeOpen}>
              <PopoverTrigger asChild disabled={disabledActions}>
                <button
                  aria-labelledby="link-type-label"
                  aria-haspopup="listbox"
                  aria-expanded={typeOpen}
                  className={cn(
                    "flex items-center gap-3 w-full rounded-lg border border-sidebar-border bg-secondary px-3 py-2.5 text-left transition-all",
                    "hover:bg-muted focus-visible:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-primary/10 focus-visible:outline-none"
                  )}
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-secondary shrink-0">
                    <Image
                      src={
                        resolvedTheme === "dark"
                          ? selectedType.iconDark
                          : selectedType.icon
                      }
                      alt={selectedType.label}
                      width={20}
                      height={20}
                      className="w-5 h-5"
                    />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium">
                      {selectedType.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {selectedType.desc}
                    </span>
                  </div>
                  <Separator orientation="vertical" className="ml-auto h-6" />
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] p-1"
              >
                {linkTypes.map((item) => (
                  <button
                    key={item.value}
                    onClick={() => {
                      setLinkType(item.value);
                      setTypeOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-3 w-full rounded-md px-2.5 py-2 text-left transition-colors",
                      linkType === item.value
                        ? "bg-accent"
                        : "hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-center justify-center w-7 h-7 rounded-md bg-secondary shrink-0">
                      <Image
                        src={
                          resolvedTheme === "dark" ? item.iconDark : item.icon
                        }
                        alt={item.label}
                        width={18}
                        height={18}
                        className="w-[18px] h-[18px]"
                      />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm">{item.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.desc}
                      </span>
                    </div>
                    {linkType === item.value && (
                      <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                    )}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <span className="text-xs text-muted-foreground">
              Determines how the link integrates with ad platforms for tracking.
            </span>
          </div>

          <Separator />

          {/* Tags */}
          <div className="flex flex-col gap-2">
            <label htmlFor="link-tags" className="text-sm font-medium">
              Tags
            </label>
            <div
              className="flex flex-wrap items-center gap-2 w-full rounded-lg border border-sidebar-border bg-background px-2.5 py-2 min-h-[42px] cursor-text transition-all focus-within:border-primary/40 focus-within:ring-[3px] focus-within:ring-primary/10"
              onClick={() => tagInputRef.current?.focus()}
            >
              {tags.map((tag, index) => (
                <div
                  key={tag}
                  className="flex items-center gap-1.5 max-w-[200px] rounded-md bg-secondary border border-sidebar-border pl-2.5 pr-1 py-1 animate-in fade-in-0 zoom-in-95 duration-150"
                >
                  <span className="text-sm truncate">{tag}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!disabledActions) handleRemoveTag(index);
                    }}
                    className="shrink-0 rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <input
                id="link-tags"
                ref={tagInputRef}
                className="flex-1 min-w-[120px] h-7 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                placeholder={
                  tags.length === 0
                    ? "Type a tag and press Enter ..."
                    : "Add another ..."
                }
                value={tagName}
                readOnly={disabledActions}
                onChange={(e) => {
                  if (!disabledActions) setTagName(e.currentTarget.value);
                }}
                onKeyDown={(e) => {
                  if (
                    (e.key === "Enter" || e.key === ",") &&
                    tagName.trim().length > 0 &&
                    !disabledActions
                  ) {
                    e.preventDefault();
                    handleAddTag(tagName.trim());
                  }
                  if (
                    e.key === "Backspace" &&
                    tagName === "" &&
                    tags.length > 0 &&
                    !disabledActions
                  ) {
                    handleRemoveTag(tags.length - 1);
                  }
                }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              Organize and filter your links.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

export default CreateLinkDetailsSection;
