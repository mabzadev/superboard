"use client";

import { ChevronRight, type LucideIcon } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const RenderMenuItem = ({
  item,
  currentPath,
}: {
  item: navItemType;
  currentPath: string;
}) => {
  const { state, setOpen } = useSidebar();
  const router = useRouter();

  const searchParams = useSearchParams();
  const query = searchParams.toString();

  const returnUrlWithParams = (url: string) => {
    const urlWithParams = `${url}${query ? `?${query}` : ""}`;
    return urlWithParams;
  };

  const isActive = (url: string) => {
    return url === currentPath;
  };

  const isParentActive = (parentUrl: string, subItems?: { url: string }[]) => {
    if (parentUrl !== "#" && currentPath.startsWith(parentUrl)) {
      return true;
    }
    return subItems?.some((sub) => currentPath.startsWith(sub.url)) ?? false;
  };

  if (item.itemType === "collapsible") {
    const openByDefault = isParentActive(item.url, item.items);
    return (
      <Collapsible
        key={item.title}
        asChild
        defaultOpen={openByDefault}
        className="group/collapsible"
      >
        <SidebarMenuItem>
          <CollapsibleTrigger
            asChild
            onClick={() => {
              if (state === "collapsed") {
                setOpen(true);
              }
              // Navigate to first sub-item if not already on a child route
              const firstSubUrl = item.items?.[0]?.url;
              if (firstSubUrl && !isParentActive(item.url, item.items)) {
                router.push(returnUrlWithParams(firstSubUrl));
              }
            }}
          >
            <SidebarMenuButton
              tooltip={item.title}
              isActive={isActive(item.url)}
            >
              {item.icon && <item.icon />}
              <span>{item.title}</span>
              <ChevronRight className="ml-auto size-3.5 text-muted-foreground/40 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {item.items?.map((subItem) => (
                <SidebarMenuSubItem key={subItem.title}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={isActive(subItem.url)}
                  >
                    <Link href={returnUrlWithParams(subItem.url)}>
                      <span>{subItem.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    );
  } else {
    return (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton
          asChild
          isActive={isActive(item.url)}
          tooltip={item.title}
        >
          <Link href={returnUrlWithParams(item.url)}>
            {item.icon && <item.icon />}
            <span>{item.title}</span>
            {item.badge && (
              <span className="ml-auto text-[9px] font-semibold uppercase tracking-wider leading-none rounded bg-blue-500/10 text-foreground dark:bg-blue-400/10 dark:text-foreground px-1.5 py-0.5">
                {item.badge}
              </span>
            )}
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }
};

export interface navItemType {
  title: string;
  url: string;
  icon?: LucideIcon;
  isActive?: boolean;
  itemType: string;
  badge?: string;
  items?: {
    title: string;
    url: string;
    icon?: LucideIcon;
  }[];
}
export function NavMain({ items }: { items: navItemType[] }) {
  const pathname = usePathname();

  return (
    <SidebarGroup role="navigation" aria-label="Platform">
      <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
        Platform
      </SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <RenderMenuItem key={item.title} item={item} currentPath={pathname} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
