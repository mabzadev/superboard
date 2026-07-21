"use client";

import { useUserContext } from "@/context/useUserContext";
import LocalStorage from "@/lib/LocalStorage";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ClientRedirect() {
  const router = useRouter();
  const { isHydrated } = useUserContext();

  useEffect(() => {
    if (!isHydrated) return; // wait until context is ready
    const authToken = LocalStorage.getAuthenticationToken();

    if (!authToken) {
      router.replace("/login");
    } else {
      router.replace("/dashboard");
    }
  }, [router, isHydrated]);

  return null;
}
