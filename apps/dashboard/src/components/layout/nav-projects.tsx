"use client";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { navItemType, RenderMenuItem } from "./nav-main";
import { usePathname } from "next/navigation";

export function NavProjects({ items }: { items: navItemType[] }) {
  const pathname = usePathname();
  return (
    <SidebarGroup role="navigation" aria-label="Projects">
      <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
        Configuration
      </SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <RenderMenuItem key={item.title} item={item} currentPath={pathname} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
