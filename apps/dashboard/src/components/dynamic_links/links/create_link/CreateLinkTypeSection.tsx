"use client";
import React from "react";
import LinkTypeElement from "./LinkTypeElement";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const CreateLinkTypeSection = ({
  linkType,
  setLinkType,
  disabledActions,
}: {
  linkType: string;
  setLinkType: React.Dispatch<React.SetStateAction<string>>;
  disabledActions?: boolean;
}) => {
  const { resolvedTheme } = useTheme();

  const linkTypeList = [
    {
      title: "Google Ads",
      subtitle: "Optimized for search and display campaigns.",
      linkType: GOOGLE,
      icon: resolvedTheme === "dark" ? GoogleIconWhite : GoogleIcon,
    },
    {
      title: "Meta Ads",
      subtitle: "Tailored for Facebook and Instagram ad campaigns.",
      linkType: META,
      icon: resolvedTheme === "dark" ? FacebookIconWhite : FacebookIcon,
    },
    {
      title: "LinkedIn",
      subtitle: "Perfect for professional and B2B marketing.",
      linkType: LINKEDIN,
      icon: resolvedTheme === "dark" ? LinkedInIconWhite : LinkedInIcon,
    },
    {
      title: "TikTok Ads",
      subtitle: "Built for engaging, short-form video campaigns.",
      linkType: TIKTOK,
      icon: resolvedTheme === "dark" ? TikTokIconWhite : TikTokIcon,
    },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <div className=" flex flex-1 flex-col gap-2 overflow-auto">
        <div className="flex flex-col gap-6 px-6 md:gap-6 md:py-6 max-w-[800px]">
          <Card>
            <CardHeader>
              <CardTitle>General Purpose Link</CardTitle>
              <CardDescription>
                These links provide a simple way to connect any campaign or
                channel, ensuring reliable tracking, smooth user routing, and
                actionable insights to improve engagement.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LinkTypeElement
                title="Quick Link"
                subtitle="Ideal for social media, user sharing, or general-purpose dynamic links."
                icon={QcLinkIcon}
                linkType={QUICK_LINK}
                selected={linkType === QUICK_LINK}
                onClick={() => !disabledActions && setLinkType(QUICK_LINK)}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Link for Ad Platform</CardTitle>
              <CardDescription>
                These links are designed to integrate seamlessly with ad
                campaigns, offering precise tracking and optimization to drive
                measurable results.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-1">
                {linkTypeList.map((item) => (
                  <LinkTypeElement
                    key={item.title}
                    title={item.title}
                    subtitle={item.subtitle}
                    icon={item.icon}
                    selected={linkType === item.linkType}
                    linkType={item.linkType}
                    onClick={() =>
                      !disabledActions && setLinkType(item.linkType)
                    }
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default CreateLinkTypeSection;
