"use client";

import { BadgeCheck, ChevronsUpDown, LogOut, Moon, Sun } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useUserContext } from "@/context/useUserContext";
import LocalStorage from "@/lib/LocalStorage";
import { useRouter, useSearchParams } from "next/navigation";
import { showGenericError } from "@/lib/Notifications";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import Link from "next/link";

export function NavUser() {
  const { userRef } = useUserContext();
  const { isMobile } = useSidebar();
  const { logoutUser } = useUserContext();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  function getInitials(name: string): string {
    if (!name) return "";

    const parts = name.trim().split(/\s+/);

    if (parts.length === 1) {
      return (parts[0]?.[0] ?? "").toUpperCase();
    }

    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }

  const router = useRouter();
  const handleLogout = async () => {
    // setIsLoading(true);
    try {
      await logoutUser(LocalStorage.getAuthenticationToken());
      // setIsLoading(false);
      router.replace("/login");
    } catch {
      // setIsLoading(false);
      showGenericError();
    }
  };
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  const returnUrlWithParams = (url: string) => {
    const urlWithParams = `${url}${query ? `?${query}` : ""}`;
    return urlWithParams;
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const isDark = resolvedTheme === "dark";

  const toggleTheme = () => {
    setTheme(isDark ? "light" : "dark");
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-blue-500/10 text-foreground dark:bg-blue-400/10 text-xs font-semibold">
                  {getInitials(userRef.current?.name ?? "")}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold tracking-tight">
                  {userRef.current?.name}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {userRef.current?.email}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground/50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">
                    {getInitials(userRef.current?.name ?? "")}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {userRef.current?.name}
                  </span>
                  <span className="truncate text-xs">
                    {userRef.current?.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <Link href={returnUrlWithParams("/account")}>
                <DropdownMenuItem>
                  <BadgeCheck />
                  Account
                </DropdownMenuItem>
              </Link>
              <DropdownMenuItem onClick={() => toggleTheme()}>
                {resolvedTheme === "dark" ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
                Toggle theme
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
