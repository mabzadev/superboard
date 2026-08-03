"use client";

import * as React from "react";
import {
  ChartNoAxesCombined,
  Link2,
  Users,
  DollarSign,
  MessageSquareText,
  Settings2,
  PencilRuler,
  SquareTerminal,
  ShoppingBag,
  Star,
  Inbox,
  Target,
} from "lucide-react";

import { NavMain } from "@/components/layout/nav-main";
import { NavProjects } from "@/components/layout/nav-projects";
import { NavUser } from "@/components/layout/nav-user";
import { ProjectSwitcher } from "@/components/layout/team-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { IS_ENTERPRISE } from "@/lib/edition";

const data = {
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: ChartNoAxesCombined,
      itemType: "simple",
    },
    {
      title: "Dynamic Links",
      url: "#",
      icon: Link2,
      itemType: "collapsible",
      items: [
        {
          title: "Links",
          url: "/dynamic_links/links",
        },
        {
          title: "Campaigns",
          url: "/dynamic_links/campaigns",
        },
      ],
    },
    {
      title: "Audience",
      url: "#",
      icon: Users,
      itemType: "collapsible",
      items: [
        {
          title: "Visitors",
          url: "/audience/visitors",
        },
        {
          title: "Referrals",
          url: "/audience/referrals",
        },
      ],
    },
    ...(IS_ENTERPRISE
      ? [
          {
            title: "Revenue",
            url: "/revenue",
            icon: DollarSign,
            itemType: "simple",
            badge: "Beta",
          },
        ]
      : []),
    {
      title: "Purchases",
      url: "/purchases",
      icon: ShoppingBag,
      itemType: "simple",
      badge: "New",
    },
    {
      title: "Inbox",
      url: "/inbox",
      icon: Inbox,
      itemType: "simple",
      badge: "New",
    },
    {
      title: "Messaging",
      url: "/messaging",
      icon: MessageSquareText,
      itemType: "simple",
    },
    {
      title: "Store Reviews",
      url: "/store-reviews",
      icon: Star,
      itemType: "simple",
      badge: "New",
    },
    {
      title: "Growth",
      url: "/growth",
      icon: Target,
      itemType: "simple",
      badge: "New",
    },
  ],

  projects: [
    {
      title: "Links Behaviour",
      url: "/link_behaviour",
      icon: PencilRuler,
      itemType: "collapsible",
      items: [
        {
          title: "Redirect Rules",
          url: "/link_behaviour/redirect_rules",
        },
        {
          title: "Domain",
          url: "/link_behaviour/domain",
        },
        {
          title: "Social Media Preview",
          url: "/link_behaviour/social_media_preview",
        },
        {
          title: "Tracking",
          url: "/link_behaviour/tracking",
        },
      ],
    },
    {
      title: "Developers",
      url: "/developers",
      icon: SquareTerminal,
      itemType: "collapsible",
      items: [
        {
          title: "Access Key",
          url: "/developers/access_key",
        },
        {
          title: "Android Setup",
          url: "/developers/android_setup",
        },
        {
          title: "iOS Setup",
          url: "/developers/ios_setup",
        },
        {
          title: "Web Setup",
          url: "/developers/web_setup",
        },
      ],
    },
    {
      title: "Settings",
      url: "/settings",
      icon: Settings2,
      itemType: "simple",
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" aria-label="Main navigation" {...props}>
      <SidebarHeader className="h-[calc(4rem+1px)] border-b border-sidebar-border justify-center">
        <ProjectSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavProjects items={data.projects} />
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
