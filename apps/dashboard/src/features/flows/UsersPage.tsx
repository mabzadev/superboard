"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Search, Users } from "lucide-react";

import {
  flowsApi,
  type FlowEnvironment,
  type FlowUser,
} from "@/api/flows/flowsService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { showErrorNotification } from "@/lib/Notifications";
import { useFlows } from "./FlowsContext";
import { FlowsEmptyState, FlowsPage } from "./FlowsPage";
import { useFlowI18n } from "./i18n";

const ALL = "__all__";

export function FlowsUsersPage() {
  const { t, locale, tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const [items, setItems] = useState<FlowUser[]>([]);
  const [environments, setEnvironments] = useState<FlowEnvironment[]>([]);
  const [environmentId, setEnvironmentId] = useState(ALL);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!projectRef) return;
    setLoading(true);
    try {
      const [users, nextEnvironments] = await Promise.all([
        flowsApi.listUsers(
          projectRef,
          environmentId === ALL ? undefined : environmentId
        ),
        flowsApi.listEnvironments(projectRef),
      ]);
      setItems(users);
      setEnvironments(nextEnvironments);
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
    } finally {
      setLoading(false);
    }
  }, [environmentId, projectRef, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = items.filter(
    (item) =>
      !search.trim() ||
      [item.user_id_hash, item.locale, item.country, item.platform].some(
        (value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(search.trim().toLowerCase())
      )
  );

  return (
    <FlowsPage title={t("users")} description={t("usersDescription")}>
      <div className="flex flex-col gap-3 rounded-[var(--radius)] border bg-card p-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tr(
              "Search users by hash, locale, country or platform"
            )}
            className="pl-9"
          />
        </div>
        <Select value={environmentId} onValueChange={setEnvironmentId}>
          <SelectTrigger className="w-full md:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tr("All environments")}</SelectItem>
            {environments.map((environment) => (
              <SelectItem value={environment.id} key={environment.id}>
                {environment.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-hidden rounded-[var(--radius)] border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr("User hash")}</TableHead>
              <TableHead>{t("platform")}</TableHead>
              <TableHead>{t("locale")}</TableHead>
              <TableHead>{t("country")}</TableHead>
              <TableHead>{t("progress")}</TableHead>
              <TableHead>{t("lastSeen")}</TableHead>
              <TableHead>
                <span className="sr-only">{tr("Actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((user) => (
              <TableRow key={`${user.environment_id}:${user.user_id_hash}`}>
                <TableCell className="font-mono text-xs">
                  {user.user_id_hash}
                </TableCell>
                <TableCell className="capitalize">
                  {user.platform ?? "—"}
                </TableCell>
                <TableCell>{user.locale ?? "—"}</TableCell>
                <TableCell>{user.country ?? "—"}</TableCell>
                <TableCell>{user.workflows_in_progress}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(user.last_seen_at, locale)}
                </TableCell>
                <TableCell>
                  <Button asChild size="icon" variant="ghost">
                    <Link
                      href={`/flows/users/${encodeURIComponent(user.user_id_hash)}`}
                    >
                      <ExternalLink />
                      <span className="sr-only">{t("open")}</span>
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="p-0">
                  <FlowsEmptyState
                    icon={Users}
                    title={t("noData")}
                    description={tr(
                      "Users appear only after the SDK identifies them."
                    )}
                  />
                </TableCell>
              </TableRow>
            )}
            {loading && items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-32 text-center text-muted-foreground"
                >
                  {t("loading")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </FlowsPage>
  );
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
