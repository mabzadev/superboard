"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Listens for legacy migration deep-links on `/settings` and forwards them to
 * the canonical migration card on `/link_behaviour/domain`.
 *
 * Triggers when either:
 * - `?tab=migration` is present in the query string, OR
 * - the URL fragment contains the substring `migration` (case-insensitive).
 *
 * The `tab` param is dropped from the redirect target so the effect cannot
 * loop after `router.replace`. `instance_id` and `env_type` are preserved so
 * downstream pages keep the project context the user clicked into.
 *
 * Note: Next.js `useSearchParams` does not expose the URL fragment, so we
 * read `window.location.hash` directly for the hash case.
 */
const MigrationDeepLinkRedirect = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get("tab");
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const hashRequestsMigration = hash.toLowerCase().includes("migration");

    if (tab !== "migration" && !hashRequestsMigration) return;

    const preservedKeys = ["instance_id", "env_type"] as const;
    const preserved = new URLSearchParams();
    preservedKeys.forEach((key) => {
      const value = searchParams.get(key);
      if (value) preserved.set(key, value);
    });

    const query = preserved.toString();
    const target = `/link_behaviour/domain${
      query ? `?${query}` : ""
    }#migration`;

    router.replace(target);
  }, [router, searchParams]);

  return null;
};

export default MigrationDeepLinkRedirect;
