"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { RefreshCw, Search } from "lucide-react";
import type {
  SupportCursorPage,
  SupportCursorQuery,
} from "@/api/support/nativeClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { moduleErrorMessage } from "@/components/modules/ModulePage";

export function useSupportCollection<T>(
  projectRef: string | undefined,
  loader: (
    projectRef: string,
    query: SupportCursorQuery
  ) => Promise<SupportCursorPage<T>>,
  options: { searchable?: boolean; limit?: number } = {}
) {
  const [items, setItems] = useState<T[]>([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (append = false) => {
      if (!projectRef) {
        setItems([]);
        setNextCursor(null);
        setError(null);
        return;
      }
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const result = await loader(projectRef, {
          q: options.searchable === false ? undefined : appliedQuery,
          cursor: append ? nextCursor : undefined,
          limit: options.limit ?? 50,
        });
        setItems((current) =>
          append ? [...current, ...result.data] : result.data
        );
        setNextCursor(result.pagination.next_cursor);
        setError(null);
      } catch (cause) {
        setError(moduleErrorMessage(cause));
        if (!append) setItems([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [
      appliedQuery,
      loader,
      nextCursor,
      options.limit,
      options.searchable,
      projectRef,
    ]
  );

  useEffect(() => {
    void load(false);
    // `nextCursor` changes after every response and must not trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectRef, appliedQuery, loader, options.limit, options.searchable]);

  const search = () => setAppliedQuery(query.trim());
  const reset = () => {
    setQuery("");
    setAppliedQuery("");
  };

  return {
    items,
    query,
    setQuery,
    search,
    reset,
    reload: () => load(false),
    loadMore: () => load(true),
    hasMore: Boolean(nextCursor),
    loading,
    loadingMore,
    error,
  };
}

export function SupportSearchToolbar({
  query,
  setQuery,
  onSearch,
  onRefresh,
  loading,
  action,
}: {
  query: string;
  setQuery: (value: string) => void;
  onSearch: () => void;
  onRefresh: () => void;
  loading?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[240px] flex-1">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          aria-label="Search"
          className="pl-9"
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSearch();
          }}
        />
      </div>
      <Button variant="outline" onClick={onSearch}>
        Search
      </Button>
      <Button
        aria-label="Refresh"
        variant="outline"
        disabled={loading}
        onClick={onRefresh}
      >
        <RefreshCw className={loading ? "animate-spin" : ""} />
      </Button>
      {action}
    </div>
  );
}

export function SupportError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>Unable to load Support data</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function SupportLoading() {
  return (
    <div aria-label="Loading" className="space-y-3">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

export function SupportEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function SupportLoadMore({
  visible,
  loading,
  onClick,
}: {
  visible: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  if (!visible) return null;
  return (
    <div className="flex justify-center">
      <Button variant="outline" disabled={loading} onClick={onClick}>
        {loading ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}

export function SupportStatus({ value }: { value?: string | null }) {
  const normalized = value || "configuration_required";
  const label =
    normalized === "configuration_required"
      ? "Not configured"
      : normalized === "live_validated"
        ? "Live"
        : normalized.replaceAll("_", " ");
  const variant =
    normalized === "degraded"
      ? "destructive"
      : normalized === "disabled"
        ? "secondary"
        : "outline";
  return (
    <Badge className="capitalize" variant={variant}>
      {label}
    </Badge>
  );
}

export function SupportMetric({
  label,
  value,
  description,
}: {
  label: string;
  value: ReactNode;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {description ? (
        <CardContent className="text-xs text-muted-foreground">
          {description}
        </CardContent>
      ) : null}
    </Card>
  );
}

export function AccessNotice({ children }: { children: ReactNode }) {
  return (
    <Alert>
      <AlertTitle>Restricted action</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
