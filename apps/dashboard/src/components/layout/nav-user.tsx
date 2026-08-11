"use client";

import { Activity, LogOut, Moon, Settings2, Sun, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

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
import { useUserContext } from "@/context/useUserContext";
import LocalStorage from "@/lib/LocalStorage";
import { showGenericError } from "@/lib/Notifications";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OG";
  if (parts.length === 1) return (parts[0]?.[0] ?? "O").toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

export function NavUser() {
  const pathname = usePathname();
  const router = useRouter();
  const { userRef, logoutUser } = useUserContext();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <span className="ds-avatar" aria-hidden="true">OG</span>;

  const name = userRef.current?.name ?? "SuperBoard user";
  const email = userRef.current?.email ?? "";
  const isDark = resolvedTheme === "dark";

  const handleLogout = async () => {
    try {
      await logoutUser(LocalStorage.getAuthenticationToken());
      router.replace("/login");
    } catch {
      showGenericError();
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="ds-account-trigger"
          aria-label={`Open ${name} account menu`}
        >
          <Avatar className="ds-avatar">
            <AvatarFallback className="bg-transparent text-inherit">
              {getInitials(name)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="ds-account-popover relative! top-auto! right-auto! w-60 border-[var(--color-border)] bg-[var(--color-card)] shadow-none!"
      >
        <DropdownMenuLabel className="ds-account-profile font-normal">
          <Avatar className="ds-avatar">
            <AvatarFallback className="bg-transparent text-inherit">
              {getInitials(name)}
            </AvatarFallback>
          </Avatar>
          <span className="ds-account-copy">
            <strong>{name}</strong>
            <span>{email}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="ds-divider ds-account-divider" />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild className="ds-picker-item">
            <Link
              href="/account"
              aria-current={pathname === "/account" ? "page" : undefined}
            >
              <UserRound />
              Account
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="ds-picker-item">
            <Link
              href="/infrastructure"
              aria-current={pathname.startsWith("/infrastructure") ? "page" : undefined}
            >
              <Activity />
              Infrastructure
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="ds-picker-item">
            <Link
              href="/project-settings"
              aria-current={
                pathname.startsWith("/project-settings") ? "page" : undefined
              }
            >
              <Settings2 />
              Project Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="ds-picker-item"
            onSelect={() => setTheme(isDark ? "light" : "dark")}
          >
            {isDark ? <Sun /> : <Moon />}
            {isDark ? "Light mode" : "Dark mode"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="ds-divider ds-account-divider" />
        <DropdownMenuItem
          className="ds-picker-item ds-account-logout"
          onSelect={() => void handleLogout()}
        >
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
