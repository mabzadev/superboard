"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DateRange } from "react-day-picker";
import type { SortType } from "@/types";

interface UseTableParamsOptions {
  defaultSortKey?: string;
  defaultPageSize?: number;
  defaultDateRange?: { from: Date; to: Date };
}

export function useTableParams(options?: UseTableParamsOptions) {
  const {
    defaultSortKey = "updated_at",
    defaultPageSize = 25,
    defaultDateRange,
  } = options ?? {};

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Helper to update multiple params at once
  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, val] of Object.entries(updates)) {
        if (val === null || val === "") {
          params.delete(key);
        } else {
          params.set(key, val);
        }
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  // --- Page ---
  const page = useMemo(() => {
    const raw = searchParams.get("page");
    return raw ? Math.max(1, parseInt(raw, 10) || 1) : 1;
  }, [searchParams]);

  const setPage = useCallback(
    (p: number) => updateParams({ page: p === 1 ? null : String(p) }),
    [updateParams]
  );

  // --- Rows per page ---
  const rowsPerPage = useMemo(() => {
    const raw = searchParams.get("perPage");
    return raw ? parseInt(raw, 10) || defaultPageSize : defaultPageSize;
  }, [searchParams, defaultPageSize]);

  const setRowsPerPage = useCallback(
    (n: number) =>
      updateParams({
        perPage: n === defaultPageSize ? null : String(n),
        page: null, // reset page
      }),
    [updateParams, defaultPageSize]
  );

  // --- Sort ---
  const sort: SortType = useMemo(() => {
    const raw = searchParams.get("sort");
    if (raw) {
      const [sortKey, dir] = raw.split(":");
      return { sortKey: sortKey ?? defaultSortKey, ascending: dir === "asc" };
    }
    return { sortKey: defaultSortKey, ascending: false };
  }, [searchParams, defaultSortKey]);

  const setSort = useCallback(
    (action: SetStateAction<SortType>) => {
      const s = typeof action === "function" ? action(sort) : action;
      const isDefault = s.sortKey === defaultSortKey && s.ascending === false;
      updateParams({
        sort: isDefault ? null : `${s.sortKey}:${s.ascending ? "asc" : "desc"}`,
        page: null, // reset page
      });
    },
    [updateParams, defaultSortKey, sort]
  );

  // --- Search term (debounced URL write) ---
  const [searchTerm, setSearchTermLocal] = useState(() => {
    return searchParams.get("q") ?? "";
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSearchTerm = useCallback(
    (term: string) => {
      setSearchTermLocal(term);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        updateParams({ q: term || null, page: null });
      }, 300);
    },
    [updateParams]
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Sync from URL on back/forward navigation
  useEffect(() => {
    const urlTerm = searchParams.get("q") ?? "";
    setSearchTermLocal(urlTerm);
  }, [searchParams]);

  // --- Date range ---
  const getDefaultDates = useCallback(() => {
    if (defaultDateRange) return defaultDateRange;
    const now = new Date();
    const from = new Date();
    from.setDate(now.getDate() - 30);
    return { from, to: now };
  }, [defaultDateRange]);

  const dateRange: DateRange | undefined = useMemo(() => {
    const fromStr = searchParams.get("from");
    const toStr = searchParams.get("to");
    if (fromStr && toStr) {
      return {
        from: new Date(fromStr),
        to: new Date(toStr),
      };
    }
    return getDefaultDates();
  }, [searchParams, getDefaultDates]);

  const setDateRange = useCallback(
    (range: DateRange | undefined) => {
      if (!range?.from || !range?.to) {
        updateParams({ from: null, to: null, page: null });
        return;
      }
      updateParams({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        page: null,
      });
    },
    [updateParams]
  );

  // --- Platform ---
  const platform = useMemo(
    () => searchParams.get("platform") ?? "",
    [searchParams]
  );

  const setPlatform = useCallback(
    (p: string) => updateParams({ platform: p || null, page: null }),
    [updateParams]
  );

  // --- Total pages / total rows (server-driven, not URL) ---
  const [totalPages, setTotalPages] = useState(0);
  const [totalRows, setTotalRows] = useState(0);

  return {
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    sort,
    setSort,
    searchTerm,
    setSearchTerm,
    dateRange,
    setDateRange,
    platform,
    setPlatform,
    totalPages,
    setTotalPages,
    totalRows,
    setTotalRows,
  };
}
