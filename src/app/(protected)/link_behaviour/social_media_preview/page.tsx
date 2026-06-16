"use client";
import AppHeader from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DEFAULT_PLACEHOLDER_LINK,
  FILE,
  LINK,
} from "@/constants/OptionsConstants";
import { useProjectSelection } from "@/context/useProjectSelection";
import { showGenericError } from "@/lib/Notifications";
import { cn } from "@/lib/utils";
import { AlertCircle, Pencil, Save, Undo2, Upload } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import isURL from "validator/lib/isURL";
import facebookIcon from "@/assets/icons/ads_platform/facebook.svg";
import facebookIconWhite from "@/assets/icons/ads_platform/facebook_dark_mode.svg";
import xIcon from "@/assets/icons/ads_platform/xIcon.svg";
import xIconWhite from "@/assets/icons/ads_platform/xIcon_dark_mode.svg";
import linkedinIcon from "@/assets/icons/ads_platform/linkedIn.svg";
import linkedinIconWhite from "@/assets/icons/ads_platform/linkedIn_dark_mode.svg";
import { useTheme } from "next-themes";
import {
  useDomainConfigQuery,
  useDomainDefaultsQuery,
  useCustomDomainQuery,
} from "@/hooks/queries/useConfigurationQueries";
import { useSetSubdomainMutation } from "@/hooks/mutations/useConfigurationMutations";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const socialMediaSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  imageType: z.enum([FILE, LINK]),
  imageFile: z.instanceof(File).optional(),
  imageLink: z.string().optional(),
});

type SocialMediaFormValues = z.infer<typeof socialMediaSchema>;

const SocialMediaPreviewPage = () => {
  const { selectedProject } = useProjectSelection();
  const projectId = selectedProject?.id;

  const { data: projectDomain } = useDomainConfigQuery(projectId);
  const { data: domainDefaults } = useDomainDefaultsQuery(projectId);
  // When a custom subdomain is active it becomes the link base URL for previews.
  const { data: customDomain } = useCustomDomainQuery(projectId);
  const customActiveHostname =
    customDomain?.status === "active" ? customDomain.hostname : null;

  const setSubdomainMutation = useSetSubdomainMutation(projectId);

  const form = useForm<SocialMediaFormValues>({
    resolver: zodResolver(socialMediaSchema),
    defaultValues: {
      title: "",
      subtitle: "",
      imageType: FILE,
      imageFile: undefined,
      imageLink: "",
    },
    mode: "onChange",
  });

  const watchedImageType = form.watch("imageType");
  const watchedTitle = form.watch("title");
  const watchedSubtitle = form.watch("subtitle");
  const watchedImageLink = form.watch("imageLink");
  const watchedImageFile = form.watch("imageFile");

  const [imagePreview, setImagePreview] = useState<string | null>("");
  const [previewPlatform, setPreviewPlatform] = useState("facebook");
  const [isDragging, setIsDragging] = useState(false);

  const inputFileRef = useRef<HTMLInputElement>(null);

  const { resolvedTheme } = useTheme();

  // Compute changes based on form values vs server data
  const changes = (() => {
    if (!projectDomain) return false;

    const title = watchedTitle;
    const subtitle = watchedSubtitle;
    const imageType = watchedImageType;
    const imageLink = watchedImageLink || "";
    const imageFile = watchedImageFile;

    let titleChanged = false;
    let subtitleChanged = false;
    let linkChanged = false;

    if (projectDomain.generic_title != null) {
      if (title !== projectDomain.generic_title) {
        titleChanged = true;
      }
    } else if (title.trim() !== "") {
      titleChanged = true;
    }

    if (projectDomain.generic_subtitle != null) {
      if (subtitle !== projectDomain.generic_subtitle) {
        subtitleChanged = true;
      }
    } else if (subtitle.trim() !== "") {
      subtitleChanged = true;
    }

    if (projectDomain.generic_image_url != null) {
      if (
        imageLink &&
        isURL(imageLink) &&
        imageLink !== projectDomain.generic_image_url
      ) {
        linkChanged = true;
      }
    } else if (imageLink && isURL(imageLink)) {
      linkChanged = true;
    }

    if (imageType === LINK) {
      return titleChanged || subtitleChanged || linkChanged;
    } else {
      if (
        title !== (projectDomain.generic_title ?? "") ||
        subtitle !== (projectDomain.generic_subtitle ?? "") ||
        imageFile
      ) {
        return true;
      }
      return false;
    }
  })();

  const handleSetSubdomain = async () => {
    const { title, subtitle, imageType, imageLink, imageFile } =
      form.getValues();

    if (!projectDomain) return;

    const formData = new FormData();
    formData.append("subdomain", projectDomain.subdomain);
    formData.append("generic_title", title);
    formData.append("generic_subtitle", subtitle);

    if (projectDomain.google_tracking_id) {
      formData.append("google_tracking_id", projectDomain.google_tracking_id);
    }

    if (imageType === LINK) {
      if (imageLink && isURL(imageLink)) {
        formData.append("generic_image_url", imageLink);
      } else if (projectDomain.generic_image_url) {
        formData.append("generic_image_url", projectDomain.generic_image_url);
      }
    } else {
      if (imageFile) {
        formData.append("generic_image", imageFile);
      } else if (projectDomain.generic_image_url) {
        formData.append("generic_image_url", projectDomain.generic_image_url);
      }
    }

    try {
      await setSubdomainMutation.mutateAsync(formData);

      form.setValue("imageType", FILE);
      form.setValue("imageLink", "");
      form.setValue("imageFile", undefined);
      if (inputFileRef.current) {
        inputFileRef.current.value = "";
      }
    } catch {
      showGenericError();
    }
  };

  const handleDiscard = () => {
    if (!projectDomain) return;
    form.reset({
      title: projectDomain.generic_title || "",
      subtitle: projectDomain.generic_subtitle || "",
      imageType: watchedImageType,
      imageFile: undefined,
      imageLink: "",
    });
    setImagePreview(projectDomain.generic_image_url ?? null);
    if (inputFileRef.current) {
      inputFileRef.current.value = "";
    }
  };

  const createPreview = (
    imageInput: File | null | undefined
  ): string | undefined => {
    if (!imageInput) {
      return;
    }
    const preview = URL.createObjectURL(imageInput);
    return preview;
  };

  const handleSetImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    form.setValue("imageFile", file, { shouldDirty: true });
    const preview = createPreview(file);
    setImagePreview(preview ?? null);
  };

  // Data fetching is handled automatically by useDomainConfigQuery

  const displaySubTitle = () => {
    if (watchedSubtitle) {
      return watchedSubtitle;
    } else if (projectDomain?.generic_subtitle) {
      return projectDomain.generic_subtitle;
    } else {
      return domainDefaults?.generic_subtitle ?? "";
    }
  };

  const displayTitle = () => {
    if (watchedTitle) {
      return watchedTitle;
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

  const domainUrl =
    customActiveHostname ??
    `${projectDomain?.subdomain}.${projectDomain?.domain}`;

  const platforms = [
    {
      value: "facebook",
      label: "Facebook",
      icon: facebookIcon,
      iconDark: facebookIconWhite,
    },
    { value: "x", label: "X", icon: xIcon, iconDark: xIconWhite },
    {
      value: "linkedin",
      label: "LinkedIn",
      icon: linkedinIcon,
      iconDark: linkedinIconWhite,
    },
  ];

  // Data fetching on project change is handled by useDomainConfigQuery

  // Ref for watchedImageType — we need its current value when resetting the form on
  // projectDomain change, but we don't want imageType changes to trigger this effect.
  const watchedImageTypeRef = useRef(watchedImageType);
  watchedImageTypeRef.current = watchedImageType;

  useEffect(() => {
    if (!projectDomain) {
      return;
    }
    form.reset({
      title: projectDomain.generic_title || "",
      subtitle: projectDomain.generic_subtitle || "",
      imageType: watchedImageTypeRef.current,
      imageFile: undefined,
      imageLink: "",
    });
    setImagePreview(projectDomain.generic_image_url ?? null);
  }, [projectDomain, form]);

  // Refs for values used inside the image-type-switch effect that should not trigger re-runs
  const watchedImageLinkRef = useRef(watchedImageLink);
  watchedImageLinkRef.current = watchedImageLink;
  const watchedImageFileRef = useRef(watchedImageFile);
  watchedImageFileRef.current = watchedImageFile;
  const projectDomainRef = useRef(projectDomain);
  projectDomainRef.current = projectDomain;

  useEffect(() => {
    // Clear the other mode's data when switching between LINK and FILE
    if (watchedImageType === LINK) {
      form.setValue("imageFile", undefined);
      if (inputFileRef.current) inputFileRef.current.value = "";
      setImagePreview(
        watchedImageLinkRef.current && isURL(watchedImageLinkRef.current)
          ? watchedImageLinkRef.current
          : projectDomainRef.current?.generic_image_url || ""
      );
    } else {
      form.setValue("imageLink", "");
      setImagePreview(
        watchedImageFileRef.current
          ? (createPreview(watchedImageFileRef.current) ?? null)
          : (projectDomainRef.current?.generic_image_url ?? null)
      );
    }
  }, [watchedImageType, form]);

  useEffect(() => {
    if (watchedImageType === LINK && watchedImageLink) {
      setImagePreview(watchedImageLink);
    }
  }, [watchedImageLink, watchedImageType]);

  useEffect(() => {
    if (watchedImageType === FILE && watchedImageFile) {
      setImagePreview(createPreview(watchedImageFile) ?? null);
    }
  }, [watchedImageFile, watchedImageType]);

  const renderPreview = () => {
    const isLinkedIn = previewPlatform === "linkedin";
    const isX = previewPlatform === "x";

    return (
      <div
        className={cn(
          "flex flex-col w-full overflow-hidden border border-sidebar-border shadow-sm",
          isX ? "rounded-2xl" : "rounded-lg"
        )}
      >
        <div className="relative w-full aspect-[1.91/1] bg-muted">
          <Image
            className="object-cover"
            src={displayImage()}
            alt="Social media preview"
            fill
          />
        </div>
        <div
          className={cn(
            "flex flex-col gap-0.5 px-3 py-2.5",
            previewPlatform === "facebook" ? "bg-muted" : "bg-background"
          )}
        >
          {!isX && (
            <span className="text-[11px] text-muted-foreground uppercase tracking-wide line-clamp-1">
              {domainUrl}
            </span>
          )}
          <span className="text-sm font-semibold leading-snug line-clamp-2">
            {displayTitle()}
          </span>
          {!isLinkedIn && (
            <span className="text-xs text-muted-foreground line-clamp-2">
              {displaySubTitle()}
            </span>
          )}
          {isX && (
            <span className="text-[11px] text-muted-foreground line-clamp-1">
              {domainUrl}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col relative overflow-hidden h-dvh">
      <div className="border-b border-sidebar-border">
        <AppHeader />
      </div>
      <div className="flex flex-1 overflow-hidden">
        {/* Left column: form */}
        <div className="flex flex-col overflow-hidden min-w-0 w-full min-[1100px]:flex-1">
          <div className="flex-1 overflow-auto">
            {/* Sticky save bar */}
            <div
              className={cn(
                "sticky top-0 z-10 transition-all duration-300 overflow-hidden bg-sidebar/80 backdrop-blur-md px-6 flex items-center justify-between",
                changes
                  ? "max-h-16 opacity-100 border-b border-sidebar-border py-3"
                  : "max-h-0 opacity-0 border-b-0 py-0"
              )}
            >
              <span className="text-xs text-muted-foreground">
                Unsaved changes
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="pl-3 pr-4"
                  onClick={handleDiscard}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Discard
                </Button>
                <Button
                  size="sm"
                  className="pl-3 pr-4"
                  onClick={handleSetSubdomain}
                >
                  <Save className="h-3.5 w-3.5" />
                  Save Changes
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-0 px-6 py-4 max-w-[600px]">
              <div className="flex flex-col gap-0.5 mb-6">
                <h2 className="text-sm font-semibold">Social Media Preview</h2>
                <p className="text-xs text-muted-foreground">
                  Customize how your links appear when shared on social
                  platforms.
                </p>
              </div>

              <div className="flex flex-col gap-5">
                {/* Title */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">Title</label>
                  <Input
                    placeholder="Enter a title for social sharing..."
                    {...form.register("title")}
                  />
                  <span className="text-xs text-muted-foreground">
                    Shown as the headline when shared.
                  </span>
                </div>

                {/* Description */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">Description</label>
                  <textarea
                    placeholder="Enter a description..."
                    {...form.register("subtitle")}
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                  />
                  <span className="text-xs text-muted-foreground">
                    Short summary shown below the title.
                  </span>
                </div>

                <Separator />

                {/* Image */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">Image</label>
                  <Tabs value={watchedImageType} className="w-full">
                    <TabsList className="w-full">
                      <TabsTrigger
                        value={LINK}
                        className="flex-1"
                        onClick={() => form.setValue("imageType", LINK)}
                      >
                        From URL
                      </TabsTrigger>
                      <TabsTrigger
                        value={FILE}
                        className="flex-1"
                        onClick={() => form.setValue("imageType", FILE)}
                      >
                        Upload file
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  {watchedImageType === FILE ? (
                    <button
                      type="button"
                      onClick={() => inputFileRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDragging(true);
                      }}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDragging(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDragging(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDragging(false);
                        const file = e.dataTransfer.files?.[0];
                        if (file && file.type.startsWith("image/")) {
                          form.setValue("imageFile", file, {
                            shouldDirty: true,
                          });
                          setImagePreview(URL.createObjectURL(file));
                        }
                      }}
                      className={cn(
                        "relative group flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-secondary/50 px-4 h-[200px] transition-colors overflow-hidden",
                        isDragging
                          ? "border-primary bg-primary/5"
                          : "border-sidebar-border hover:border-primary/30 hover:bg-secondary"
                      )}
                    >
                      {imagePreview &&
                      watchedImageType === FILE &&
                      !isDragging ? (
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
                              {isDragging
                                ? "Drop image here"
                                : "Click or drag to upload"}
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
                        onChange={(e) => handleSetImage(e)}
                      />
                    </button>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <Input
                        className={cn(
                          "transition-all",
                          (watchedImageLink?.length ?? 0) > 0 &&
                            !isURL(watchedImageLink || "")
                            ? "border-destructive/50 ring-[3px] ring-destructive/10"
                            : ""
                        )}
                        placeholder="https://example.com/image.png"
                        {...form.register("imageLink")}
                      />
                      {(watchedImageLink?.length ?? 0) > 0 &&
                        !isURL(watchedImageLink || "") && (
                          <Badge
                            variant="destructive"
                            className="w-fit gap-1.5 py-1 px-2.5"
                          >
                            <AlertCircle className="h-3 w-3" />
                            Enter a valid URL
                          </Badge>
                        )}
                    </div>
                  )}

                  <span className="text-xs text-muted-foreground">
                    Thumbnail displayed when the link is shared.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right column: preview */}
        <div className="hidden min-[1100px]:flex w-[680px] shrink-0 flex-col border-l border-sidebar-border bg-sidebar overflow-auto">
          <div className="flex flex-col items-center justify-center gap-4 p-8 flex-1">
            <div className="flex flex-col gap-4 w-full max-w-[400px]">
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
              {renderPreview()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SocialMediaPreviewPage;
