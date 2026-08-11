"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  GitBranch,
  PackageOpen,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import {
  getPlatformLibraries,
  type PlatformLibraryCatalog,
} from "@/api/platform/platformService";
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
import { showSuccessNotification } from "@/lib/Notifications";

export default function LibrariesPageContent() {
  const [catalog, setCatalog] = useState<PlatformLibraryCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCatalog(await getPlatformLibraries());
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load the library catalogue"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    showSuccessNotification(`${label} copied`);
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Libraries</h1>
          <p className="text-sm text-muted-foreground">
            Git-owned SDK versions, immutable release references and reusable
            FlutterFlow custom code.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Catalogue unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {catalog && (
        <>
          <Alert>
            <GitBranch />
            <AlertTitle>Git is the release authority</AlertTitle>
            <AlertDescription>
              Source versions are changed by pull request. Production
              applications use only immutable release references; this
              back-office never rewrites package source or creates an unreviewed
              tag.
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 lg:grid-cols-2">
            {catalog.libraries.map((library) => {
              const pending = library.releaseStatus === "pending-release";
              const status: {
                label: string;
                variant: "default" | "destructive" | "outline" | "secondary";
              } =
                library.lifecycle === "archived"
                  ? { label: "Archived", variant: "secondary" }
                  : library.lifecycle === "internal"
                    ? { label: "Internal", variant: "outline" }
                    : pending
                      ? { label: "Release pending", variant: "destructive" }
                      : { label: "Released", variant: "default" };
              return (
                <Card key={library.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <PackageOpen className="size-5" />
                          {library.displayName}
                        </CardTitle>
                        <CardDescription>
                          {library.packageName} · {library.ecosystem}
                        </CardDescription>
                      </div>
                      <Badge variant={status.variant}>
                        {status.label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                      <Version
                        label="Source"
                        value={library.sourceVersion}
                        icon={
                          pending ? (
                            <TriangleAlert className="size-4 text-amber-500" />
                          ) : (
                            <CheckCircle2 className="size-4 text-emerald-500" />
                          )
                        }
                      />
                      <Version
                        label="Latest release"
                        value={library.latestReleaseVersion}
                        icon={
                          <CheckCircle2 className="size-4 text-emerald-500" />
                        }
                      />
                      <Version
                        label="Lifecycle"
                        value={library.lifecycle}
                        icon={
                          library.lifecycle === "active" ? (
                            <CheckCircle2 className="size-4 text-emerald-500" />
                          ) : (
                            <TriangleAlert className="size-4 text-amber-500" />
                          )
                        }
                      />
                    </div>
                    {library.candidatePackageName &&
                      library.candidateInstall && (
                        <div className="space-y-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-xs">
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">Migration candidate</Badge>
                            <code>{library.candidatePackageName}</code>
                          </div>
                          <p className="text-muted-foreground">
                            Planned for source version {library.sourceVersion};
                            the immutable release below remains the production
                            baseline until promotion.
                          </p>
                        </div>
                      )}
                    {library.notes && (
                      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                        {library.notes}
                      </p>
                    )}
                    {library.distribution && (
                      <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">Public metadata</Badge>
                          <Badge variant="outline">
                            Authentication required
                          </Badge>
                          <Badge variant="outline">
                            Anonymous install unavailable
                          </Badge>
                        </div>
                        <p className="text-muted-foreground">
                          The package record is public, but the registry rejects
                          unauthenticated downloads. Configure{" "}
                          <code>
                            {
                              library.distribution.authentication
                                .tokenEnvironmentVariable
                            }
                          </code>
                          {library.distribution.authentication
                            .usernameEnvironmentVariable && (
                            <>
                              {" "}
                              and{" "}
                              <code>
                                {
                                  library.distribution.authentication
                                    .usernameEnvironmentVariable
                                }
                              </code>
                            </>
                          )}{" "}
                          before using the dependency command.
                        </p>
                        <p className="break-all font-mono text-muted-foreground">
                          {library.distribution.registry}
                        </p>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-3 text-sm">
                      <a
                        className="inline-flex items-center gap-1 text-primary"
                        href={`${catalog.repository}/tree/${encodeURIComponent(catalog.developmentBranch)}/${library.sourcePath}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open source on {catalog.developmentBranch}
                        <ExternalLink className="size-3" />
                      </a>
                      <a
                        className="inline-flex items-center gap-1 text-primary"
                        href={`${catalog.repository}/blob/${encodeURIComponent(catalog.developmentBranch)}/${library.versionSource}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Version authority
                        <ExternalLink className="size-3" />
                      </a>
                      <a
                        className="inline-flex items-center gap-1 text-primary"
                        href={`${catalog.repository}/blob/${encodeURIComponent(catalog.developmentBranch)}/${library.licensePath}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {library.license} license
                        <ExternalLink className="size-3" />
                      </a>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        Immutable ref
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                          {library.releaseRef}
                        </code>
                        <Button
                          size="icon"
                          variant="outline"
                          aria-label={`Copy ${library.displayName} release ref`}
                          onClick={() =>
                            void copy(library.releaseRef, "Release ref")
                          }
                        >
                          <Copy className="size-4" />
                        </Button>
                      </div>
                    </div>
                    <details>
                      <summary className="cursor-pointer text-sm font-medium">
                        {library.lifecycle !== "active"
                          ? "Historical dependency"
                          : library.distribution
                          ? "Authenticated dependency command"
                          : "Installation"}
                      </summary>
                      {library.distribution && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          This command alone is insufficient; configure the
                          authenticated registry shown above first.
                        </p>
                      )}
                      <div className="mt-2 flex items-start gap-2">
                        <pre className="min-w-0 flex-1 overflow-auto rounded bg-muted p-3 text-xs">
                          {library.install}
                        </pre>
                        <Button
                          size="icon"
                          variant="outline"
                          aria-label={`Copy ${library.displayName} installation`}
                          onClick={() =>
                            void copy(
                              library.install,
                              library.distribution
                                ? "Dependency command"
                                : "Installation"
                            )
                          }
                        >
                          <Copy className="size-4" />
                        </Button>
                      </div>
                    </details>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <FlutterFlowLibraryCard catalog={catalog} />

          <Card>
            <CardHeader>
              <CardTitle>FlutterFlow custom code</CardTitle>
              <CardDescription>
                The canonical reusable surface belongs to superboard-platform;
                application projects keep only thin UI adapters.{" "}
                {catalog.customCode.widgets.length} widgets ·{" "}
                {surfaceCount(catalog.customCode.actions)} actions ·{" "}
                {surfaceCount(catalog.customCode.streams)} event streams ·{" "}
                {surfaceCount(catalog.customCode.sourceFiles)} Git source files.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <h2 className="mb-2 text-sm font-semibold">Widgets</h2>
                <div className="flex flex-wrap gap-2">
                  {catalog.customCode.widgets.map((name) => (
                    <Badge key={name} variant="secondary">
                      {name}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {Object.entries(catalog.customCode.actions).map(
                  ([group, actions]) => (
                    <SurfaceGroup key={group} group={group} values={actions} />
                  )
                )}
              </div>
              <div>
                <h2 className="mb-2 text-sm font-semibold">Event streams</h2>
                <div className="grid gap-4 lg:grid-cols-2">
                  {Object.entries(catalog.customCode.streams).map(
                    ([group, streams]) => (
                      <SurfaceGroup
                        key={group}
                        group={group}
                        values={streams}
                      />
                    )
                  )}
                </div>
              </div>
              <div>
                <h2 className="mb-2 text-sm font-semibold">Git source files</h2>
                <div className="grid gap-4 lg:grid-cols-2">
                  {Object.entries(catalog.customCode.sourceFiles).map(
                    ([group, paths]) => (
                      <div key={group} className="rounded-md border p-4">
                        <h3 className="mb-2 text-sm font-semibold capitalize">
                          {group.replace(/([A-Z])/g, " $1")}
                        </h3>
                        <ul className="space-y-1 text-xs">
                          {paths.map((path) => (
                            <li key={path}>
                              <a
                                className="inline-flex items-center gap-1 font-mono text-primary"
                                href={`${catalog.repository}/blob/${encodeURIComponent(catalog.developmentBranch)}/${path}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {path}
                                <ExternalLink className="size-3 shrink-0" />
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  )}
                </div>
              </div>
              <div>
                <h2 className="mb-2 text-sm font-semibold">
                  Reference-only UI adapters
                </h2>
                <p className="mb-3 text-xs text-muted-foreground">
                  These adapters belong to the acceptance application. They may
                  compose public library calls but must not copy an HTTP,
                  authentication or business protocol.
                </p>
                <div className="grid gap-4 lg:grid-cols-2">
                  {Object.entries(catalog.customCode.referenceAdapters).map(
                    ([group, adapters]) => (
                      <SurfaceGroup
                        key={group}
                        group={group}
                        values={adapters}
                      />
                    )
                  )}
                </div>
              </div>
              <a
                className="inline-flex items-center gap-1 text-sm text-primary"
                href={`${catalog.repository}/actions/workflows/prepare-sdk-release.yml`}
                target="_blank"
                rel="noreferrer"
              >
                Open controlled SDK release workflow
                <ExternalLink className="size-3" />
              </a>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function FlutterFlowLibraryCard({
  catalog,
}: {
  catalog: PlatformLibraryCatalog;
}) {
  const library = catalog.flutterFlowLibrary;
  const dependencies = library.dependencies.map((dependency) => {
    const published = catalog.libraries.find(
      ({ id }) => id === dependency.catalogId
    );
    return {
      ...dependency,
      ready:
        published?.releaseStatus === "released" &&
        published.latestReleaseVersion === dependency.sourceVersion &&
        published.releaseRef === dependency.requiredRef,
    };
  });
  const pending = dependencies.filter(({ ready }) => !ready).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>FlutterFlow library project · {library.displayName}</CardTitle>
            <CardDescription>
              Git-managed reusable adapters deployed to FlutterFlow only after
              every SDK dependency has an immutable release tag.
            </CardDescription>
          </div>
          <Badge variant={pending === 0 ? "default" : "destructive"}>
            {pending === 0
              ? "Ready to sync"
              : `${pending} immutable ${pending === 1 ? "tag" : "tags"} pending`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Version
            label="Library values"
            value={String(library.libraryValues.length)}
            icon={<CheckCircle2 className="size-4 text-emerald-500" />}
          />
          <Version
            label="Custom actions"
            value={String(surfaceCount(library.actions))}
            icon={<CheckCircle2 className="size-4 text-emerald-500" />}
          />
          <Version
            label="Token App State"
            value="Forbidden"
            icon={<CheckCircle2 className="size-4 text-emerald-500" />}
          />
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold">Required releases</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {dependencies.map((dependency) => (
              <div
                className="flex items-start justify-between gap-3 rounded-md border p-3"
                key={dependency.catalogId}
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm">{dependency.packageName}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {dependency.requiredRef}
                  </p>
                </div>
                <Badge variant={dependency.ready ? "default" : "outline"}>
                  {dependency.ready ? "Published" : "Pending"}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border p-4 text-sm">
          <p className="font-medium">Remote project configuration</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Project ID: GitHub variable {library.remoteProject.projectIdVariable}
            {" · "}API credential: environment secret {library.remoteProject.apiKeySecret}
            {" · "}Environment: {library.remoteProject.githubEnvironment}
          </p>
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          <a
            className="inline-flex items-center gap-1 text-primary"
            href={`${catalog.repository}/blob/${encodeURIComponent(catalog.developmentBranch)}/${library.source.path}`}
            target="_blank"
            rel="noreferrer"
          >
            Open Git-owned DSL
            <ExternalLink className="size-3" />
          </a>
          <a
            className="inline-flex items-center gap-1 text-primary"
            href={`${catalog.repository}/actions/workflows/${library.source.workflow.split("/").at(-1)}`}
            target="_blank"
            rel="noreferrer"
          >
            Open controlled update workflow
            <ExternalLink className="size-3" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function SurfaceGroup({ group, values }: { group: string; values: string[] }) {
  return (
    <div className="rounded-md border p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold capitalize">
          {group.replace(/([A-Z])/g, " $1")}
        </h3>
        {group === "compatibilityAliases" && (
          <Badge variant="outline">Compatibility only</Badge>
        )}
      </div>
      <ul className="space-y-1 font-mono text-xs text-muted-foreground">
        {values.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
}

function surfaceCount(groups: Record<string, string[]>) {
  return Object.values(groups).reduce(
    (total, values) => total + values.length,
    0
  );
}

function Version({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2 font-mono font-semibold">
        {icon}
        {value}
      </div>
    </div>
  );
}
