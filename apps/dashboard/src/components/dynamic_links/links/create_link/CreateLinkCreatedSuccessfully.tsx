import Image, { type StaticImageData } from "next/image";
import { useState } from "react";
import type { Link } from "@/types";
import QcLinkIcon from "@/assets/icons/ads_platform/grovs.svg";
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
  QUICK_LINK,
  LINKEDIN,
  META,
  TIKTOK,
} from "@/constants/OptionsConstants";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { handleCopyText } from "@/lib/copyTextHelper";
import { useTheme } from "next-themes";
import { Check, CircleCheck, Copy, ExternalLink, X } from "lucide-react";

const PLATFORM_INFO: Record<
  string,
  {
    label: string;
    successLabel: string;
    icon: StaticImageData;
    iconDark: StaticImageData;
    field: string;
    hint: string;
    guideUrl?: string;
    guideName?: string;
  }
> = {
  [QUICK_LINK]: {
    label: "Quick Link",
    successLabel: "link",
    icon: QcLinkIcon,
    iconDark: QcLinkIcon,
    field: "",
    hint: "Share this link anywhere — social media, email, QR codes, or messaging apps.",
  },
  [GOOGLE]: {
    label: "Google Ads",
    successLabel: "Google Ads link",
    icon: GoogleIcon,
    iconDark: GoogleIconWhite,
    field: "Final URL",
    hint: "Paste this link into the Final URL field in your Google Ads campaign setup.",
    guideUrl: "https://support.google.com/google-ads/answer/6324971?hl=en",
    guideName: "View Google Ads setup guide",
  },
  [META]: {
    label: "Meta Ads",
    successLabel: "Meta Ads link",
    icon: FacebookIcon,
    iconDark: FacebookIconWhite,
    field: "Website URL",
    hint: "Paste this link into the Website URL field when creating your Facebook or Instagram ad.",
    guideUrl: "https://www.facebook.com/business/ads",
    guideName: "View Meta Ads setup guide",
  },
  [LINKEDIN]: {
    label: "LinkedIn Ads",
    successLabel: "LinkedIn Ads link",
    icon: LinkedInIcon,
    iconDark: LinkedInIconWhite,
    field: "Destination URL",
    hint: "Paste this link into the Destination URL field in your LinkedIn campaign.",
    guideUrl:
      "https://business.linkedin.com/marketing-solutions/how-to-advertise-on-linkedin",
    guideName: "View LinkedIn Ads setup guide",
  },
  [TIKTOK]: {
    label: "TikTok Ads",
    successLabel: "TikTok Ads link",
    icon: TikTokIcon,
    iconDark: TikTokIconWhite,
    field: "Website Link",
    hint: "Paste this link into the Website Link field when setting up your TikTok ad.",
    guideUrl: "https://ads.tiktok.com/help/article/ad-set-up",
    guideName: "View TikTok Ads setup guide",
  },
};

const CreateLinkCreatedSuccessfully = ({
  createdLink,
  onClose,
}: {
  createdLink: Link | null;
  onClose: () => void;
}) => {
  const { resolvedTheme } = useTheme();
  const [copied, setCopied] = useState(false);

  const platform =
    (createdLink?.ads_platform
      ? PLATFORM_INFO[createdLink.ads_platform]
      : undefined) ?? PLATFORM_INFO[QUICK_LINK]!;
  const isAdPlatform = createdLink?.ads_platform !== QUICK_LINK;

  const handleCopy = () => {
    handleCopyText(createdLink?.access_path ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col w-full">
      {/* Success hero with gradient */}
      <div
        className="relative px-6 pt-10 pb-6 flex flex-col items-center text-center"
        style={{
          background:
            resolvedTheme === "dark"
              ? "linear-gradient(180deg, rgba(60, 90, 140, 0.15) 0%, rgba(140, 100, 70, 0.10) 100%)"
              : "linear-gradient(180deg, rgba(190, 218, 252, 0.25) 0%, rgba(255, 233, 216, 0.25) 100%)",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute top-4 right-4 rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center justify-center h-12 w-12 rounded-2xl bg-valid-green/10 mb-4">
          <CircleCheck className="h-6 w-6 text-valid-green" />
        </div>

        <h2 className="text-xl font-semibold tracking-tight mb-1">
          {createdLink?.name}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Your {platform.successLabel} has been created and is ready to use.
        </p>

        {/* Link URL */}
        <div className="flex items-center w-full rounded-md border border-sidebar-border bg-background/60 dark:bg-background/40 backdrop-blur-sm px-4 py-3 gap-3 mt-5">
          <p className="flex-1 min-w-0 text-sm select-all truncate">
            <span className="text-muted-foreground">
              {createdLink?.access_path?.split("/").slice(0, 3).join("/")}/
            </span>
            <span className="font-semibold text-foreground">
              {createdLink?.access_path?.split("/").slice(3).join("/")}
            </span>
          </p>
          <button
            onClick={handleCopy}
            className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
          >
            {copied ? (
              <Check className="h-4 w-4 text-valid-green" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <Separator />

      {/* Platform-specific guidance */}
      <div className="px-6 py-5">
        {isAdPlatform ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <Image
                src={
                  resolvedTheme === "dark" ? platform.iconDark : platform.icon
                }
                alt={platform.label}
                width={18}
                height={18}
                className="w-[18px] h-[18px]"
              />
              <span className="text-sm font-medium">Next step</span>
            </div>
            <span className="text-xs text-muted-foreground leading-relaxed">
              Paste this link into the{" "}
              <code className="px-1.5 py-0.5 rounded bg-secondary border border-sidebar-border font-mono text-foreground text-[11px]">
                {platform.field}
              </code>{" "}
              field in your {platform.label} campaign.
            </span>
            {platform.guideUrl && (
              <a
                href={platform.guideUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline underline-offset-2 w-fit"
              >
                {platform.guideName} &rarr;
              </a>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <Image
                src={
                  resolvedTheme === "dark" ? platform.iconDark : platform.icon
                }
                alt={platform.label}
                width={18}
                height={18}
                className="w-[18px] h-[18px]"
              />
              <span className="text-sm font-medium">Quick link</span>
            </div>
            <span className="text-xs text-muted-foreground leading-relaxed">
              {platform.hint}
            </span>
          </div>
        )}
      </div>

      <Separator />

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4">
        <Button variant="outline" asChild>
          <a
            href={createdLink?.access_path}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-4 w-4" />
            Open link
          </a>
        </Button>
        <Button onClick={handleCopy}>
          <Copy className="h-4 w-4" />
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
};

export default CreateLinkCreatedSuccessfully;
