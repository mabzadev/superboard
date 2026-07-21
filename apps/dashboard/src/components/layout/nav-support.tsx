"use client";

import { MessageCircleQuestionMark } from "lucide-react";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import { useChatwoot } from "@/context/useChatwoot";

export function NavSupport() {
  const { toggleChat } = useChatwoot();
  return (
    <SidebarGroup role="navigation" aria-label="Support">
      <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
        Support
      </SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={() => toggleChat()}
            asChild
            tooltip={"Live Chat"}
          >
            <div className={"cursor-pointer"}>
              <div className="relative">
                <MessageCircleQuestionMark className="size-4" />
                <div className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-sidebar" />
              </div>
              <span>Live Chat</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
