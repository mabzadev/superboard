"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  BarChart3,
  FlaskConical,
  MapPin,
  Pencil,
  Plus,
  Rocket,
  Trash2,
} from "lucide-react";
import {
  archivePaywall,
  archivePaywallExperience,
  archivePaywallVersion,
  createPaywall,
  createPaywallExperience,
  createPaywallVersion,
  getPaywallExperiences,
  getPaywallPlacements,
  getPaywallStatistics,
  getPaywallVersions,
  getPaywalls,
  deletePaywallPlacement,
  publishPaywallVersion,
  savePaywallPlacement,
  updatePaywallExperience,
  updatePaywall,
  type Paywall,
  type PaywallExperience,
  type PaywallPlacement,
  type PaywallStatistics,
  type PaywallVersion,
} from "@/api/paywalls/paywallsService";
import { useProjectSelection } from "@/context/useProjectSelection";
import { ApiError } from "@/lib/ApiError";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ExperienceEditor,
  ExperienceStatisticsFilters,
  createExperienceDocument,
  fromPaywallDefinition,
  toPaywallDefinition,
  type ExperienceDocument,
} from "@/components/experience-editor";
import { ModulePage, EmptyProject, moduleErrorMessage } from "./ModulePage";

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : moduleErrorMessage(error);

const displayName = (paywall: Paywall) =>
  paywall.display_name ?? paywall.name ?? paywall.identifier;

export function PaywallsPage() {
  const { selectedProject } = useProjectSelection();
  const [items, setItems] = useState<Paywall[]>([]);
  const [selected, setSelected] = useState<Paywall>();
  const [versions, setVersions] = useState<PaywallVersion[]>([]);
  const [placements, setPlacements] = useState<PaywallPlacement[]>([]);
  const [experiences, setExperiences] = useState<PaywallExperience[]>([]);
  const [document, setDocument] = useState<ExperienceDocument>(
    createExperienceDocument
  );
  const [documentValid, setDocumentValid] = useState(true);
  const [editorKey, setEditorKey] = useState("new");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [changelog, setChangelog] = useState("");
  const [metadata, setMetadata] = useState({
    identifier: "",
    display_name: "",
    description: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      setError(null);
      const [paywalls, projectPlacements, projectExperiences] =
        await Promise.all([
          getPaywalls(selectedProject.id),
          getPaywallPlacements(selectedProject.id),
          getPaywallExperiences(selectedProject.id),
        ]);
      setItems(paywalls);
      setPlacements(projectPlacements);
      setExperiences(projectExperiences);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [selectedProject]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (item: Paywall) => {
    if (!selectedProject) return;
    setSelected(item);
    setMetadata({
      identifier: item.identifier,
      display_name: displayName(item),
      description: item.description ?? "",
    });
    try {
      const result = await getPaywallVersions(selectedProject.id, item.id);
      setVersions(result);
      const latest = result[0];
      setDocument(
        fromPaywallDefinition(
          latest?.definition as unknown as Record<string, unknown>
        )
      );
      setEditorKey(`${item.id}:${latest?.id ?? "new"}`);
      setChangelog("");
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    }
  };

  const saveMetadata = async () => {
    if (
      !selectedProject ||
      !selected ||
      !metadata.identifier ||
      !metadata.display_name ||
      busy
    )
      return;
    setBusy(true);
    try {
      const updated = await updatePaywall(selectedProject.id, selected.id, {
        identifier: metadata.identifier,
        display_name: metadata.display_name,
        description: metadata.description || null,
      });
      setSelected((current) =>
        current ? { ...current, ...updated } : current
      );
      showSuccessNotification("Paywall details updated");
      await load();
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const removePaywall = async () => {
    if (!selectedProject || !selected || busy) return;
    setBusy(true);
    try {
      await archivePaywall(selectedProject.id, selected.id);
      setSelected(undefined);
      setVersions([]);
      setDocument(createExperienceDocument());
      setEditorKey("new");
      showSuccessNotification("Paywall archived");
      await load();
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const archiveVersion = async (versionId: string) => {
    if (!selectedProject || !selected || busy) return;
    setBusy(true);
    try {
      await archivePaywallVersion(selectedProject.id, selected.id, versionId);
      showSuccessNotification("Paywall version archived");
      await open(selected);
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!selectedProject || !identifier || !name || busy) return;
    setBusy(true);
    try {
      const result = await createPaywall(selectedProject.id, {
        identifier,
        display_name: name,
      });
      setName("");
      setIdentifier("");
      showSuccessNotification("Paywall created");
      await load();
      await open(result);
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!selectedProject || !selected || !documentValid || busy) return;
    setBusy(true);
    try {
      const version = await createPaywallVersion(
        selectedProject.id,
        selected.id,
        toPaywallDefinition(document),
        changelog || undefined
      );
      showSuccessNotification(`Draft v${version.version} saved`);
      await open(selected);
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const publish = async (versionId: string) => {
    if (!selectedProject || !selected || busy) return;
    setBusy(true);
    try {
      await publishPaywallVersion(selectedProject.id, selected.id, versionId);
      showSuccessNotification("Paywall version published");
      await Promise.all([load(), open(selected)]);
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModulePage
      title="Paywalls"
      description="Design, target, test and publish purchase experiences."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Paywalls</CardTitle>
              <CardDescription>
                Create a paywall, then save immutable versions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Identifier"
                value={identifier}
                onChange={(event) =>
                  setIdentifier(
                    event.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_-]/g, "_")
                  )
                }
              />
              <Input
                placeholder="Display name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Button
                className="w-full"
                disabled={busy || !identifier || !name}
                onClick={() => void create()}
              >
                <Plus />
                Create paywall
              </Button>
              <div className="space-y-2 border-t pt-4">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => void open(item)}
                    className={`w-full rounded-lg border p-3 text-left ${selected?.id === item.id ? "border-primary bg-primary/5" : ""}`}
                  >
                    <span className="block font-medium">
                      {displayName(item)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {item.identifier} ·{" "}
                      {item.published_version
                        ? `v${item.published_version} published`
                        : "not published"}
                    </span>
                  </button>
                ))}
                {!items.length && (
                  <p className="text-sm text-muted-foreground">
                    No paywalls yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  {selected
                    ? `Edit ${displayName(selected)}`
                    : "Visual paywall editor"}
                </CardTitle>
                <CardDescription>
                  Drag blocks, configure the theme and verify the mobile
                  preview.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selected && (
                  <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_2fr_auto_auto]">
                    <label className="space-y-1 text-xs">
                      Identifier
                      <Input
                        value={metadata.identifier}
                        onChange={(event) =>
                          setMetadata((value) => ({
                            ...value,
                            identifier: event.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9_-]/g, "_"),
                          }))
                        }
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      Display name
                      <Input
                        value={metadata.display_name}
                        onChange={(event) =>
                          setMetadata((value) => ({
                            ...value,
                            display_name: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      Description
                      <Input
                        value={metadata.description}
                        onChange={(event) =>
                          setMetadata((value) => ({
                            ...value,
                            description: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <Button
                      className="self-end"
                      disabled={
                        busy || !metadata.identifier || !metadata.display_name
                      }
                      onClick={() => void saveMetadata()}
                    >
                      Save details
                    </Button>
                    <Button
                      className="self-end"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void removePaywall()}
                    >
                      <Archive />
                      Archive
                    </Button>
                  </div>
                )}
                <ExperienceEditor
                  key={editorKey}
                  kind="paywall"
                  initialDocument={document}
                  onChange={(value, valid) => {
                    setDocument(value);
                    setDocumentValid(valid);
                  }}
                />
                <div className="flex flex-wrap items-end gap-2 border-t pt-4">
                  <label className="min-w-64 flex-1 space-y-1 text-xs">
                    Version notes
                    <Input
                      value={changelog}
                      onChange={(event) => setChangelog(event.target.value)}
                      placeholder="What changed?"
                    />
                  </label>
                  <Button
                    disabled={!selected || busy || !documentValid}
                    onClick={() => void saveDraft()}
                  >
                    <Plus />
                    Save immutable draft
                  </Button>
                </div>
                <VersionList
                  versions={versions}
                  busy={busy}
                  onLoad={(version) => {
                    setDocument(
                      fromPaywallDefinition(
                        version.definition as unknown as Record<string, unknown>
                      )
                    );
                    setEditorKey(`${selected?.id}:${version.id}:load`);
                  }}
                  onPublish={publish}
                  onArchive={archiveVersion}
                />
              </CardContent>
            </Card>

            {selected && (
              <PaywallDeliveryControls
                projectRef={selectedProject.id}
                paywall={selected}
                versions={versions}
                placements={placements.filter(
                  (item) => item.paywall_id === selected.id
                )}
                experiences={experiences.filter(
                  (item) => item.paywall_id === selected.id
                )}
                onChanged={load}
              />
            )}
          </div>
        </div>
      )}
    </ModulePage>
  );
}

function VersionList({
  versions,
  busy,
  onLoad,
  onPublish,
  onArchive,
}: {
  versions: PaywallVersion[];
  busy: boolean;
  onLoad: (version: PaywallVersion) => void;
  onPublish: (id: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
}) {
  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-sm font-medium">Version history</p>
      {versions.map((version) => (
        <div
          key={version.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
        >
          <button className="text-left" onClick={() => onLoad(version)}>
            <b>Version {version.version}</b>
            <p className="text-xs capitalize text-muted-foreground">
              {version.status}
              {version.changelog ? ` · ${version.changelog}` : ""}
            </p>
          </button>
          <div className="flex gap-1">
            <Button
              variant="outline"
              disabled={
                busy ||
                version.status === "published" ||
                version.status === "archived"
              }
              onClick={() => void onPublish(version.id)}
            >
              <Rocket />
              Publish
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Archive version ${version.version}`}
              disabled={busy || version.status === "archived"}
              onClick={() => void onArchive(version.id)}
            >
              <Archive />
            </Button>
          </div>
        </div>
      ))}
      {!versions.length && (
        <p className="text-sm text-muted-foreground">
          Save the first draft to start version history.
        </p>
      )}
    </div>
  );
}

function PaywallDeliveryControls({
  projectRef,
  paywall,
  versions,
  placements,
  experiences,
  onChanged,
}: {
  projectRef: string;
  paywall: Paywall;
  versions: PaywallVersion[];
  placements: PaywallPlacement[];
  experiences: PaywallExperience[];
  onChanged: () => Promise<void>;
}) {
  const published = versions.filter(({ status }) => status === "published");
  const [key, setKey] = useState("default");
  const [priority, setPriority] = useState(100);
  const [active, setActive] = useState(true);
  const [platforms, setPlatforms] = useState("ios,android");
  const [locales, setLocales] = useState("");
  const [countries, setCountries] = useState("");
  const [versionId, setVersionId] = useState("");
  const [experimentName, setExperimentName] = useState("50/50 conversion test");
  const [editingPlacementId, setEditingPlacementId] = useState<string>();
  const [experimentPlacementId, setExperimentPlacementId] = useState("");
  const [busy, setBusy] = useState(false);
  const savePlacement = async () => {
    if (!versionId) return;
    setBusy(true);
    try {
      await savePaywallPlacement(
        projectRef,
        {
          key,
          paywall_id: paywall.id,
          active_version_id: versionId,
          experience_id:
            placements.find(({ id }) => id === editingPlacementId)
              ?.experience_id ?? null,
          targeting: {
            platforms: csv(platforms),
            locales: csv(locales),
            countries: csv(countries),
            attributes: {},
          },
          priority,
          active,
        },
        editingPlacementId
      );
      setEditingPlacementId(undefined);
      showSuccessNotification(
        editingPlacementId ? "Placement updated" : "Placement saved"
      );
      await onChanged();
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const editPlacement = (placement: PaywallPlacement) => {
    setEditingPlacementId(placement.id);
    setKey(placement.key);
    setVersionId(placement.active_version_id ?? "");
    setPriority(placement.priority);
    setActive(Boolean(placement.active));
    setPlatforms(placement.targeting.platforms.join(","));
    setLocales(placement.targeting.locales.join(","));
    setCountries(placement.targeting.countries.join(","));
  };
  const removePlacement = async (id: string) => {
    setBusy(true);
    try {
      await deletePaywallPlacement(projectRef, id);
      if (editingPlacementId === id) setEditingPlacementId(undefined);
      showSuccessNotification("Placement deactivated");
      await onChanged();
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const createExperiment = async () => {
    const placement = placements.find(({ id }) => id === experimentPlacementId);
    if (published.length < 2 || !placement) return;
    setBusy(true);
    try {
      const experience = await createPaywallExperience(projectRef, {
        paywall_id: paywall.id,
        name: experimentName,
        status: "draft",
        traffic_percent: 100,
        variants: published.slice(0, 2).map((version, index) => ({
          id: crypto.randomUUID(),
          key: index ? "variant_b" : "control",
          version_id: version.id,
          weight: 5000,
          active: true,
        })),
      });
      await savePaywallPlacement(
        projectRef,
        {
          key: placement.key,
          paywall_id: placement.paywall_id,
          active_version_id: placement.active_version_id ?? null,
          experience_id: experience.id,
          targeting: placement.targeting,
          priority: placement.priority,
          active: placement.active,
        },
        placement.id
      );
      showSuccessNotification("A/B experience created as draft");
      await onChanged();
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const removeExperience = async (id: string) => {
    setBusy(true);
    try {
      await archivePaywallExperience(projectRef, id);
      showSuccessNotification("Experiment archived");
      await onChanged();
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const setExperimentStatus = async (
    experience: PaywallExperience,
    status: PaywallExperience["status"]
  ) => {
    setBusy(true);
    try {
      await updatePaywallExperience(projectRef, experience.id, {
        ...experience,
        status,
      });
      showSuccessNotification(`Experiment ${status}`);
      await onChanged();
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin />
          Delivery, targeting and A/B
        </CardTitle>
        <CardDescription>
          Choose exactly where a published version resolves in the SDK.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label className="space-y-1 text-xs">
            Placement key
            <Input
              value={key}
              onChange={(event) =>
                setKey(
                  event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_")
                )
              }
            />
          </label>
          <label className="space-y-1 text-xs">
            Published version
            <select
              className="block h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={versionId}
              onChange={(event) => setVersionId(event.target.value)}
            >
              <option value="">Select…</option>
              {published.map((version) => (
                <option key={version.id} value={version.id}>
                  Version {version.version}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            Priority
            <Input
              type="number"
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value))}
            />
          </label>
          <label className="space-y-1 text-xs">
            Platforms
            <Input
              value={platforms}
              onChange={(event) => setPlatforms(event.target.value)}
              placeholder="ios,android,web"
            />
          </label>
          <label className="space-y-1 text-xs">
            Locales
            <Input
              value={locales}
              onChange={(event) => setLocales(event.target.value)}
              placeholder="en-US,fr-FR"
            />
          </label>
          <label className="space-y-1 text-xs">
            Countries
            <Input
              value={countries}
              onChange={(event) => setCountries(event.target.value)}
              placeholder="US,FR"
            />
          </label>
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={active} onCheckedChange={setActive} />
            Active
          </label>
          <Button
            disabled={busy || !key || !versionId}
            onClick={() => void savePlacement()}
          >
            Save placement
          </Button>
        </div>
        {placements.map((placement) => (
          <div
            key={placement.id}
            className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"
          >
            <span>
              <b>{placement.key}</b>
              <span className="ml-2 text-muted-foreground">
                priority {placement.priority} ·{" "}
                {placement.active ? "active" : "inactive"}
              </span>
            </span>
            <span className="flex gap-1">
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Edit placement ${placement.key}`}
                onClick={() => editPlacement(placement)}
              >
                <Pencil />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Deactivate placement ${placement.key}`}
                disabled={busy || !placement.active}
                onClick={() => void removePlacement(placement.id)}
              >
                <Trash2 />
              </Button>
            </span>
          </div>
        ))}
        <div className="grid gap-3 border-t pt-4 md:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-1 text-xs">
            Experiment name
            <Input
              value={experimentName}
              onChange={(event) => setExperimentName(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            Placement
            <select
              className="block h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={experimentPlacementId}
              onChange={(event) => setExperimentPlacementId(event.target.value)}
            >
              <option value="">Select a placement…</option>
              {placements
                .filter(({ active: placementActive }) => placementActive)
                .map((placement) => (
                  <option key={placement.id} value={placement.id}>
                    {placement.key}
                  </option>
                ))}
            </select>
          </label>
          <Button
            className="self-end"
            variant="outline"
            disabled={busy || published.length < 2 || !experimentPlacementId}
            onClick={() => void createExperiment()}
          >
            <FlaskConical />
            Create 50/50 test
          </Button>
        </div>
        {published.length < 2 && (
          <p className="text-xs text-muted-foreground">
            Publish two versions to create an A/B experiment.
          </p>
        )}
        {experiences.map((experience) => (
          <div
            key={experience.id}
            className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"
          >
            <span>
              <b>{experience.name}</b>
              <span className="ml-2 capitalize text-muted-foreground">
                {experience.status} · {experience.variants.length} variants
              </span>
            </span>
            <span className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={
                  busy ||
                  experience.status === "archived" ||
                  experience.status === "completed"
                }
                onClick={() =>
                  void setExperimentStatus(
                    experience,
                    experience.status === "running" ? "paused" : "running"
                  )
                }
              >
                {experience.status === "running" ? "Pause" : "Start"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={
                  busy ||
                  experience.status === "archived" ||
                  experience.status === "completed"
                }
                onClick={() =>
                  void setExperimentStatus(experience, "completed")
                }
              >
                Complete
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Archive experiment ${experience.name}`}
                disabled={busy || experience.status === "archived"}
                onClick={() => void removeExperience(experience.id)}
              >
                <Archive />
              </Button>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function csv(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

export function PaywallStatisticsPage() {
  const { selectedProject } = useProjectSelection();
  const [data, setData] = useState<PaywallStatistics>();
  const [error, setError] = useState<string | null>(null);
  const defaultFilters = useMemo(
    () => ({
      from: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      interval: "day",
      platform: "",
      placement_id: "",
      version_id: "",
      experience_id: "",
      variant_id: "",
    }),
    []
  );
  const [filters, setFilters] = useState(defaultFilters);
  useEffect(() => {
    if (!selectedProject) return;
    setError(null);
    getPaywallStatistics(selectedProject.id, filters)
      .then(setData)
      .catch((cause) => setError(errorMessage(cause)));
  }, [selectedProject, filters]);
  const summaryOrder = [
    "impression",
    "view",
    "cta",
    "dismiss",
    "checkout",
    "purchase",
    "cancel",
    "error",
    "restore",
  ];
  const summary = summaryOrder.map(
    (label) => [label, Number(data?.totals[label] ?? 0)] as const
  );
  return (
    <ModulePage
      title="Paywall statistics"
      description="Conversion, revenue and event performance for the last 30 days."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <>
          <ExperienceStatisticsFilters value={filters} onChange={setFilters} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {summary.map(([label, value]) => (
              <Card key={label}>
                <CardHeader>
                  <CardDescription>
                    {label.replaceAll("_", " ")}
                  </CardDescription>
                  <CardTitle className="text-3xl">
                    {Number(value).toLocaleString()}
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
            <Card>
              <CardHeader>
                <CardDescription>conversion rate</CardDescription>
                <CardTitle className="text-3xl">
                  {(Number(data?.totals.conversion_rate ?? 0) * 100).toFixed(1)}
                  %
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>tracked revenue</CardDescription>
                <CardTitle className="text-3xl">
                  {Number(data?.totals.revenue_micros ?? 0).toLocaleString()} μ
                </CardTitle>
                <CardDescription>
                  {Object.entries(data?.totals.revenue_by_currency ?? {})
                    .map(
                      ([currency, micros]) => `${moneyValue(micros, currency)}`
                    )
                    .join(" · ") || "No purchases"}
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 />
                Time series
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Count</TableHead>
                    <TableHead>Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.series ?? []).map((row, index) => (
                    <TableRow
                      key={`${String(row.bucket)}:${String(row.event_type)}:${index}`}
                    >
                      <TableCell>{String(row.bucket)}</TableCell>
                      <TableCell className="capitalize">
                        {String(row.event_type).replaceAll("_", " ")}
                      </TableCell>
                      <TableCell>
                        {Number(row.count ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {row.currency
                          ? moneyValue(
                              Number(row.revenue_micros ?? 0),
                              String(row.currency)
                            )
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!data?.series.length && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-10 text-center text-muted-foreground"
                      >
                        No events match this period.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </ModulePage>
  );
}

function moneyValue(micros: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(micros / 1_000_000);
}
