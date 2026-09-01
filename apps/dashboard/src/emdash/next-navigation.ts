"use client";

import { useSyncExternalStore } from "react";

type NavigateOptions = { scroll?: boolean };

const subscribe = (listener: () => void) => {
  globalThis.addEventListener?.("popstate", listener);
  return () => globalThis.removeEventListener?.("popstate", listener);
};

const pathname = () => globalThis.location?.pathname ?? "/";
const search = () => globalThis.location?.search ?? "";

export function usePathname() {
  return useSyncExternalStore(subscribe, pathname, pathname);
}

export function useSearchParams() {
  const value = useSyncExternalStore(subscribe, search, search);
  return new URLSearchParams(value);
}

export function useParams(): Record<string, string> {
  return {};
}

export function useRouter() {
  return {
    back: () => globalThis.history?.back(),
    forward: () => globalThis.history?.forward(),
    prefetch: async () => undefined,
    push: (href: string, _options?: NavigateOptions) => navigate(href, false),
    refresh: () => globalThis.location?.reload(),
    replace: (href: string, _options?: NavigateOptions) => navigate(href, true),
  };
}

export function redirect(href: string): never {
  navigate(href, true);
  throw new Error(`REDIRECT:${href}`);
}

export function notFound(): never {
  throw new Error("NOT_FOUND");
}

function navigate(href: string, replace: boolean) {
  if (!globalThis.location || !globalThis.history) return;
  const url = new URL(href, globalThis.location.href);
  if (
    url.origin !== globalThis.location.origin ||
    url.pathname !== globalThis.location.pathname
  ) {
    if (replace) globalThis.location.replace(url);
    else globalThis.location.assign(url);
    return;
  }
  globalThis.history[replace ? "replaceState" : "pushState"]({}, "", url);
  globalThis.dispatchEvent(new PopStateEvent("popstate"));
}
