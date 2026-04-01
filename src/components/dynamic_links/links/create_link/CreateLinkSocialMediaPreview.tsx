"use client";
import React, { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pencil, Upload } from "lucide-react";
import {
  DEFAULT_PLACEHOLDER_LINK,
  FILE,
  LINK,
} from "@/constants/OptionsConstants";
import Image from "next/image";
import facebookIcon from "@/assets/icons/ads_platform/facebook.svg";
import facebookIconDark from "@/assets/icons/ads_platform/facebook_dark_mode.svg";
import xIcon from "@/assets/icons/ads_platform/xIcon.svg";
import xIconDark from "@/assets/icons/ads_platform/xIcon_dark_mode.svg";
import linkedinIcon from "@/assets/icons/ads_platform/linkedIn.svg";
import linkedinIconDark from "@/assets/icons/ads_platform/linkedIn_dark_mode.svg";
import isURL from "validator/lib/isURL";
import {
  useDomainConfigQuery,
  useDomainDefaultsQuery,
} from "@/hooks/queries/useConfigurationQueries";
import { useProjectSelection } from "@/context/useProjectSelection";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";

const CreateLinkSocialMediaPreview = React.memo(
  function CreateLinkSocialMediaPreview({
    title,
    setTitle,
    subtitle,
    setSubtitle,
    imageType,
    setImageType,
    imageFile,
    imageLink,
    setImageFile,
    setImageLink,
    setImagePreview,
    imagePreview,
    disabledActions,
  }: {
    title: string;
    setTitle: React.Dispatch<React.SetStateAction<string>>;
    subtitle: string;
    setSubtitle: React.Dispatch<React.SetStateAction<string>>;
    imageType: string;
    setImageType: React.Dispatch<React.SetStateAction<string>>;
    imageFile: File | undefined;
    imageLink: string;
    setImageFile: (value: File | undefined) => void;
    setImageLink: React.Dispatch<React.SetStateAction<string>>;
    setImagePreview: (value: string | null) => void;
    imagePreview: string | null;
    disabledActions?: boolean;
  }) {
    const inputFileRef = useRef<HTMLInputElement>(null);
    const { resolvedTheme } = useTheme();
    const { selectedProject } = useProjectSelection();
    const domainQuery = useDomainConfigQuery(selectedProject?.id);
    const projectDomain = domainQuery.data;
    const { data: domainDefaults } = useDomainDefaultsQuery(
      selectedProject?.id
    );
    const [previewPlatform, setPreviewPlatform] = useState("facebook");

    const handleSetImage = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.currentTarget.files?.[0];
      setImageFile(file);
      const preview = createPreview(file);
      setImagePreview(preview ?? null);
    };

    const createPreview = (
      imageInput: File | undefined
    ): string | undefined => {
      if (!imageInput) {
        return;
      }
      const preview = URL.createObjectURL(imageInput);
      return preview;
    };

    const displaySubTitle = () => {
      if (subtitle) {
        return subtitle;
      } else if (projectDomain?.generic_subtitle) {
        return projectDomain.generic_subtitle;
      } else {
        return domainDefaults?.generic_subtitle ?? "";
      }
    };

    const displayTitle = () => {
      if (title) {
        return title;
      } else if (projectDomain?.generic_title) {
        return projectDomain.generic_title;
      } else {
        return domainDefaults?.generic_title ?? selectedProject?.name;
      }
    };

    const displayImage = () => {
      if (imagePreview) {
        return imagePreview;
      } else if (projectDomain?.generic_image_url) {
        return projectDomain.generic_image_url;
      } else {
        return domainDefaults?.generic_image_url ?? DEFAULT_PLACEHOLDER_LINK;
      }
    };

    // Refs for values used inside the image-type-switch effect that should not trigger re-runs
    const imageLinkRef = useRef(imageLink);
    imageLinkRef.current = imageLink;
    const imageFileRef = useRef(imageFile);
    imageFileRef.current = imageFile;

    useEffect(() => {
      // Clear the other mode's data when switching between LINK and FILE
      if (imageType === LINK) {
        setImageFile(undefined);
        if (inputFileRef.current) inputFileRef.current.value = "";
        setImagePreview(imageLinkRef.current || "");
      } else {
        setImageLink("");
        setImagePreview(
          imageFileRef.current
            ? (createPreview(imageFileRef.current) ?? null)
            : ""
        );
      }
    }, [imageType, setImageFile, setImageLink, setImagePreview]);

    useEffect(() => {
      if (imageType === LINK && imageLink) {
        setImagePreview(imageLink);
      }
    }, [imageLink, imageType, setImagePreview]);

    useEffect(() => {
      if (imageType === FILE && imageFile) {
        setImagePreview(createPreview(imageFile) ?? null);
      }
    }, [imageFile, imageType, setImagePreview]);

    const domainUrl = `http://${projectDomain?.subdomain}.${projectDomain?.domain}`;

    const platforms = [
      {
        value: "facebook",
        label: "Facebook",
        icon: facebookIcon,
        iconDark: facebookIconDark,
      },
      { value: "x", label: "X", icon: xIcon, iconDark: xIconDark },
      {
        value: "linkedin",
        label: "LinkedIn",
        icon: linkedinIcon,
        iconDark: linkedinIconDark,
      },
    ];

    const renderPreview = () => {
      switch (previewPlatform) {
        case "facebook":
          return (
            <div className="flex flex-col w-full overflow-hidden rounded-lg border border-sidebar-border">
              <div className="relative flex justify-center items-center bg-sidebar-border w-full aspect-[1.91/1]">
                <Image
                  className="object-cover"
                  src={displayImage()}
                  alt="preview"
                  fill
                />
              </div>
              <div className="flex flex-col bg-muted px-3 py-2.5 gap-0.5">
                <span className="text-[11px] text-muted-foreground uppercase tracking-wide line-clamp-1">
                  {domainUrl}
                </span>
                <label className="text-sm font-semibold line-clamp-1">
                  {displayTitle()}
                </label>
                <span className="text-xs text-muted-foreground line-clamp-2">
                  {displaySubTitle()}
                </span>
              </div>
            </div>
          );
        case "x":
          return (
            <div className="flex flex-col w-full overflow-hidden rounded-2xl border border-sidebar-border">
              <div className="relative flex justify-center items-center bg-sidebar-border w-full aspect-[1.91/1]">
                <Image
                  className="object-cover"
                  src={displayImage()}
                  alt="preview"
                  fill
                />
              </div>
              <div className="flex flex-col bg-background px-3 py-2.5 gap-0.5">
                <label className="text-sm font-semibold line-clamp-1">
                  {displayTitle()}
                </label>
                <span className="text-xs text-muted-foreground line-clamp-2">
                  {displaySubTitle()}
                </span>
                <span className="text-[11px] text-muted-foreground line-clamp-1">
                  {domainUrl}
                </span>
              </div>
            </div>
          );
        case "linkedin":
          return (
            <div className="flex flex-col w-full overflow-hidden rounded-lg border border-sidebar-border">
              <div className="relative flex justify-center items-center bg-sidebar-border w-full aspect-[1.91/1]">
                <Image
                  className="object-cover"
                  src={displayImage()}
                  alt="preview"
                  fill
                />
              </div>
              <div className="flex flex-col bg-background px-3 py-2.5 gap-0.5">
                <label className="text-sm font-semibold line-clamp-1">
                  {displayTitle()}
                </label>
                <span className="text-[11px] text-muted-foreground line-clamp-1">
                  {domainUrl}
                </span>
              </div>
            </div>
          );
        default:
          return null;
      }
    };

    return (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 overflow-hidden">
          {/* Left — Inputs */}
          <div className="flex flex-1 flex-col gap-2 overflow-auto">
            <div className="flex flex-col gap-5 px-6 py-6">
              {/* Title */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Title</label>
                <Input
                  placeholder="Enter a title for social sharing ..."
                  value={title}
                  readOnly={disabledActions}
                  onChange={(e) => setTitle(e.currentTarget.value)}
                />
                <span className="text-xs text-muted-foreground">
                  Shown as the headline when shared.
                </span>
              </div>

              {/* Description */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Description</label>
                <textarea
                  placeholder="Enter a description ..."
                  value={subtitle}
                  readOnly={disabledActions}
                  onChange={(e) => setSubtitle(e.currentTarget.value)}
                  rows={3}
                  className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                />
                <span className="text-xs text-muted-foreground">
                  Short summary shown below the title.
                </span>
              </div>

              {/* Image */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Image</label>
                <Tabs value={imageType} className="w-full">
                  <TabsList className="w-full">
                    <TabsTrigger
                      value={LINK}
                      className="flex-1"
                      onClick={() => !disabledActions && setImageType(LINK)}
                    >
                      From URL
                    </TabsTrigger>
                    <TabsTrigger
                      value={FILE}
                      className="flex-1"
                      onClick={() => !disabledActions && setImageType(FILE)}
                    >
                      Upload file
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                {imageType === LINK ? (
                  <Input
                    placeholder="https://example.com/image.png"
                    value={imageLink}
                    readOnly={disabledActions}
                    onChange={(e) => setImageLink(e.currentTarget.value)}
                    className={cn(
                      imageLink && !isURL(imageLink)
                        ? "border-destructive/50 ring-[3px] ring-destructive/10"
                        : ""
                    )}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      !disabledActions && inputFileRef.current?.click()
                    }
                    className={cn(
                      "relative group flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-sidebar-border bg-secondary/50 px-4 h-[200px] transition-colors overflow-hidden",
                      "hover:border-primary/30 hover:bg-secondary",
                      disabledActions && "pointer-events-none opacity-50"
                    )}
                  >
                    {imagePreview && imageType === FILE ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imagePreview}
                          alt="Upload preview"
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                        <div
                          className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer"
                          style={{
                            zIndex: 1,
                            backgroundColor: "rgba(0,0,0,0.4)",
                          }}
                        >
                          <div className="flex items-center justify-center h-10 w-10 rounded-full bg-white/20 backdrop-blur-sm">
                            <Pencil className="h-4 w-4 text-white" />
                          </div>
                          <span className="text-sm font-medium text-white">
                            Change image
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-background border border-sidebar-border">
                          <Upload className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-sm font-medium">
                            Click to upload
                          </span>
                          <span className="text-xs text-muted-foreground">
                            PNG, JPG or WebP
                          </span>
                        </div>
                      </>
                    )}
                    <input
                      ref={inputFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => !disabledActions && handleSetImage(e)}
                    />
                  </button>
                )}
                <span className="text-xs text-muted-foreground">
                  Thumbnail displayed when the link is shared.
                </span>
              </div>
            </div>
          </div>

          {/* Right — Preview */}
          <div className="w-[320px] shrink-0 flex flex-col border-l border-sidebar-border bg-sidebar overflow-auto">
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Preview</label>
                <div className="grid grid-cols-3 gap-1 rounded-lg border border-sidebar-border bg-secondary p-1">
                  {platforms.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => setPreviewPlatform(p.value)}
                      className={cn(
                        "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition-all",
                        previewPlatform === p.value
                          ? "bg-background shadow-sm font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Image
                        src={resolvedTheme === "dark" ? p.iconDark : p.icon}
                        alt={p.label}
                        width={14}
                        height={14}
                        className="w-3.5 h-3.5"
                      />
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              {renderPreview()}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

export default CreateLinkSocialMediaPreview;
