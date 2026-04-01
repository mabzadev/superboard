"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUserContext } from "@/context/useUserContext";
import PageSkeleton from "@/components/common/PageSkeleton";

import LocalStorage from "./LocalStorage";

export default function ProtectedRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { fetchCurrentUser, userRef } = useUserContext();
  const [hasCheckedAuth, setHasCheckedAuth] = useState(false);

  // Extract tokens from URL (if present), then check authentication
  useEffect(() => {
    const token = searchParams.get("token");
    const refreshToken = searchParams.get("refresh_token");

    if (token && refreshToken) {
      LocalStorage.setAuthenticationToken(token);
      LocalStorage.setRefreshToken(refreshToken);

      // Remove tokens from URL to prevent leaking via history/referer
      const url = new URL(window.location.href);
      url.searchParams.delete("token");
      url.searchParams.delete("refresh_token");
      router.replace(url.pathname + url.search, { scroll: false });
    }

    const authToken = LocalStorage.getAuthenticationToken();

    if (!authToken) {
      setHasCheckedAuth(true);
      const currentPath = window.location.pathname + window.location.search;
      router.replace(`/login?backTo=${encodeURIComponent(currentPath)}`);
      return;
    }

    const checkAuth = async () => {
      try {
        await fetchCurrentUser();
        setHasCheckedAuth(true);
      } catch {
        const currentPath = window.location.pathname + window.location.search;
        router.replace(`/login?backTo=${encodeURIComponent(currentPath)}`);
      }
    };
    checkAuth();
  }, [router, searchParams, fetchCurrentUser]);

  // Don't render children until auth is verified
  if (!hasCheckedAuth || !userRef.current) {
    return <PageSkeleton />;
  }

  return <>{children}</>;
}
