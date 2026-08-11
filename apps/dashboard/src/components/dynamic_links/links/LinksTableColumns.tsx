import { AccessorKeyColumnDef } from "@tanstack/react-table";

import { Button } from "../../ui/button";
import { cn, parseSecondsInDaysHoursMinutesSeconds } from "@/lib/utils";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";

import { formatShortDate } from "@/lib/dateUtils";
import {
  GOOGLE,
  LINKEDIN,
  META,
  QUICK_LINK,
  TIKTOK,
} from "@/constants/OptionsConstants";
import MetaIcon from "@/assets/icons/ads_platform/meta.svg";
import GoogleIcon from "@/assets/icons/ads_platform/google.svg";
import TikTokIcon from "@/assets/icons/ads_platform/tiktok.svg";
import LinkedInIcon from "@/assets/icons/ads_platform/linkedIn.svg";
import GoogleIconWhite from "@/assets/icons/ads_platform/google_dark_mode.svg";
import LinkedInIconWhite from "@/assets/icons/ads_platform/linkedIn_dark_mode.svg";
import TikTokIconWhite from "@/assets/icons/ads_platform/tiktok_dark_mode.svg";
import MetaIconcWhite from "@/assets/icons/ads_platform/meta_dark_mode.svg";

import SuperBoard from "@/assets/icons/ads_platform/superboard.svg";
import React from "react";
import Image from "next/image";
import type { SortType } from "@/types";
import type { LinkData } from "./linkAnalytics";
import { Badge } from "@/components/ui/badge";
import { numberFormatter } from "@/utils/numberFormatter";
import { formatCurrencyFromCents } from "@/utils/formatCurrency";
import { useTheme } from "next-themes";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import { TooltipTrigger } from "@radix-ui/react-tooltip";

const headerButtonClass = "font-medium text-foreground";

export const getLinksTableColumns = (
  sort: SortType,
  setSort: React.Dispatch<React.SetStateAction<SortType>>,
  _handleEditLink: (value: LinkData) => void
): AccessorKeyColumnDef<LinkData>[] => [
  {
    accessorKey: "ads_platform",
    size: 50,
    maxSize: 50,
    header: () => <div className="w-[50px]"></div>,
    cell: ({ row }) => {
      const platform = row.original.ads_platform;
      return <ThemedPlatformIconCell platform={platform || QUICK_LINK} />;
    },
  },
  {
    accessorKey: "title",
    header: () => (
      <Button
        className={cn(headerButtonClass)}
        variant="ghost"
        onClick={() =>
          setSort((prev: SortType) => ({
            sortKey: "name",
            ascending: !prev.ascending,
          }))
        }
      >
        Title
        {checkSortDirection("name", sort)}
      </Button>
    ),
    cell: ({ row }) => <span>{row.original.name}</span>,
  },
  {
    accessorKey: "tags",
    header: () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={headerButtonClass}
            variant="ghost"
            onClick={() =>
              setSort((prev: SortType) => ({
                sortKey: "tags",
                ascending: !prev.ascending,
              }))
            }
          >
            Tags
            {checkSortDirection("tags", sort)}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Tags that were assigned when the link was created.</p>
        </TooltipContent>
      </Tooltip>
    ),
    cell: ({ row }) => {
      const tags = row.original.tags ?? [];

      if (tags.length === 0) return null;

      const displayTags = tags.length > 3 ? [tags[0], tags[1], "..."] : tags;

      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex pl-3 gap-2 cursor-pointer">
              {displayTags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="border-sidebar-border overflow-hidden text-ellipsis"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </TooltipTrigger>
          {tags.length > 2 && (
            <TooltipContent side="top">
              <p className="text-sm">{tags.join(", ")}</p>
            </TooltipContent>
          )}
        </Tooltip>
      );
    },
  },
  {
    accessorKey: "views",
    header: () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={headerButtonClass}
            variant="ghost"
            onClick={() =>
              setSort((prev: SortType) => ({
                sortKey: "views",
                ascending: !prev.ascending,
              }))
            }
          >
            Views {checkSortDirection("views", sort)}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>The number of times the link was opened in a web browser.</p>
        </TooltipContent>
      </Tooltip>
    ),
    cell: ({ row }) => (
      <div className="flex py-2 px-3">
        <p>
          {row.original.total_views
            ? numberFormatter.format(row.original.total_views)
            : "-"}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "opens",
    header: () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={headerButtonClass}
            variant="ghost"
            onClick={() =>
              setSort((prev: SortType) => ({
                sortKey: "opens",
                ascending: !prev.ascending,
              }))
            }
          >
            Opens {checkSortDirection("opens", sort)}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            This represents the number of app opens that occurred from a
            SuperBoard link.
          </p>
        </TooltipContent>
      </Tooltip>
    ),
    cell: ({ row }) => (
      <div className="flex py-2 px-3">
        <p>
          {row.original.total_opens
            ? numberFormatter.format(row.original.total_opens)
            : "-"}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "installs",
    header: () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={headerButtonClass}
            variant="ghost"
            onClick={() =>
              setSort((prev: SortType) => ({
                sortKey: "installs",
                ascending: !prev.ascending,
              }))
            }
          >
            Installs {checkSortDirection("installs", sort)}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>The number of app installations generated by the link.</p>
        </TooltipContent>
      </Tooltip>
    ),
    cell: ({ row }) => (
      <div className="flex py-2 px-3">
        <p>
          {row.original.total_installs
            ? numberFormatter.format(row.original.total_installs)
            : "-"}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "reinstalls",
    header: () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={headerButtonClass}
            variant="ghost"
            onClick={() =>
              setSort((prev: SortType) => ({
                sortKey: "reinstalls",
                ascending: !prev.ascending,
              }))
            }
          >
            Reinstalls {checkSortDirection("reinstalls", sort)}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            The number of app reinstalls generated by the link. A reinstall
            occurs when the app is deleted and reinstalled on the same device.
          </p>
        </TooltipContent>
      </Tooltip>
    ),
    cell: ({ row }) => (
      <div className="flex py-2 px-3">
        <p>
          {row.original.total_reinstalls
            ? numberFormatter.format(row.original.total_reinstalls)
            : "-"}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "reactivations",
    header: () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={headerButtonClass}
            variant="ghost"
            onClick={() =>
              setSort((prev: SortType) => ({
                sortKey: "reactivations",
                ascending: !prev.ascending,
              }))
            }
          >
            Reactivations {checkSortDirection("reactivations", sort)}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            The number of users who revisited the app after more than 7 days of
            inactivity due to a click on a link.
          </p>
        </TooltipContent>
      </Tooltip>
    ),
    cell: ({ row }) => (
      <div className="flex py-2 px-3">
        <p>
          {row.original.total_reactivations
            ? numberFormatter.format(row.original.total_reactivations)
            : "-"}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "time_spent",
    header: () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={headerButtonClass}
            variant="ghost"
            onClick={() =>
              setSort((prev: SortType) => ({
                sortKey: "time_spent",
                ascending: !prev.ascending,
              }))
            }
          >
            Time spent {checkSortDirection("time_spent", sort)}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            Sum of the entire time spent in the app by all the users for this
            link.
          </p>
        </TooltipContent>
      </Tooltip>
    ),
    cell: ({ row }) => (
      <div className="flex py-2 px-3">
        <p>
          {parseSecondsInDaysHoursMinutesSeconds(
            row.original.total_time_spent
          ) || "-"}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "app_opens",
    header: () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={headerButtonClass}
            variant="ghost"
            onClick={() =>
              setSort((prev: SortType) => ({
                sortKey: "app_opens",
                ascending: !prev.ascending,
              }))
            }
          >
            App opens {checkSortDirection("app_opens", sort)}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Application open events attributed to this link.</p>
        </TooltipContent>
      </Tooltip>
    ),
    cell: ({ row }) => (
      <div className="flex py-2 px-3">
        <p>
          {row.original.total_app_opens
            ? numberFormatter.format(row.original.total_app_opens)
            : "-"}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "user_referred",
    header: () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={headerButtonClass}
            variant="ghost"
            onClick={() =>
              setSort((prev: SortType) => ({
                sortKey: "user_referred",
                ascending: !prev.ascending,
              }))
            }
          >
            Users referred {checkSortDirection("user_referred", sort)}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Customers referred or converted through this link.</p>
        </TooltipContent>
      </Tooltip>
    ),
    cell: ({ row }) => (
      <div className="flex py-2 px-3">
        <p>
          {row.original.total_user_referred
            ? numberFormatter.format(row.original.total_user_referred)
            : "-"}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "revenue",
    header: () => (
      <div className="flex">
        <Button
          className={headerButtonClass}
          variant="ghost"
          onClick={() =>
            setSort((prev: SortType) => ({
              sortKey: "revenue",
              ascending: !prev.ascending,
            }))
          }
        >
          Revenue {checkSortDirection("revenue", sort)}
        </Button>
      </div>
    ),
    cell: ({ row }: { row: { original: LinkData } }) => (
      <div className="flex py-2 px-3">
        {row.original.total_revenue ? (
          <p>{formatCurrencyFromCents(row.original.total_revenue)}</p>
        ) : (
          <p>—</p>
        )}
      </div>
    ),
  },
  {
    accessorKey: "date",
    header: () => (
      <div className="flex">
        <Button
          className={headerButtonClass}
          variant="ghost"
          onClick={() =>
            setSort((prev: SortType) => ({
              sortKey: "updated_at",
              ascending: !prev.ascending,
            }))
          }
        >
          Date {checkSortDirection("updated_at", sort)}
        </Button>
      </div>
    ),

    cell: ({ row }) => (
      <div className="flex py-2 px-3">
        <p>{formatShortDate(row.original.updated_at)}</p>
      </div>
    ),
  },
];

export const checkSortDirection = (sortKey: string, selectedSort: SortType) => {
  if (sortKey !== selectedSort.sortKey) {
    return <ChevronsUpDown className="h-4 w-4" />;
  }
  if (selectedSort.ascending) {
    return <ChevronUp className="h-4 w-4" />;
  } else {
    return <ChevronDown className="h-4 w-4" />;
  }
};

const getPlatformIconSrc = (
  platform: string,
  resolvedTheme: string | undefined
) => {
  switch (platform) {
    case GOOGLE:
      return resolvedTheme === "dark" ? GoogleIconWhite : GoogleIcon;

    case META:
      return resolvedTheme === "dark" ? MetaIconcWhite : MetaIcon;

    case LINKEDIN:
      return resolvedTheme === "dark" ? LinkedInIconWhite : LinkedInIcon;

    case TIKTOK:
      return resolvedTheme === "dark" ? TikTokIconWhite : TikTokIcon;

    case QUICK_LINK:
      return SuperBoard;
    default:
      return null;
  }
};

const PlatformIconCell = ({
  platform,
  iconSrc,
}: {
  platform: string;
  iconSrc: string | null;
}) => {
  return (
    <div className="flex justify-center items-center w-[50px] h-[40px]">
      {iconSrc && (
        <Image src={iconSrc} alt={`${platform} icon`} width={24} height={24} />
      )}
    </div>
  );
};

export const MemoizedPlatformIconCell = React.memo(PlatformIconCell);

export const ThemedPlatformIconCell = React.memo(
  ({ platform }: { platform: string }) => {
    const { resolvedTheme } = useTheme();
    const iconSrc = getPlatformIconSrc(platform, resolvedTheme);
    return <PlatformIconCell platform={platform} iconSrc={iconSrc} />;
  }
);
