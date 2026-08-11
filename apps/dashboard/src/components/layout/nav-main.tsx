"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { DashboardSection } from "@/config/navigation";

export function NavMain({ items }: { items: readonly DashboardSection[] }) {
  const pathname = usePathname();

  return (
    <nav className="ds-sidebar-nav" aria-label="Product sections">
      <SidebarMenu>
        {items.map((item) => {
          const active =
            pathname === `/${item.slug}` ||
            pathname.startsWith(`/${item.slug}/`);
          return (
            <SidebarMenuItem key={item.slug}>
              <SidebarMenuButton
                asChild
                isActive={active}
                tooltip={item.label}
                className="ds-sidebar-link"
              >
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={item.label}
                >
                  <item.icon />
                  <span className="ds-sidebar-link-label">{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </nav>
  );
}
