"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlaskConical,
  MapPin,
  Pencil,
  Plus,
  Rocket,
  Target,
  Trash2,
} from "lucide-react";
import {
  createOnboarding,
  createOnboardingExperience,
  createOnboardingTargetingRule,
  createOnboardingVersion,
  deleteOnboarding,
  deleteOnboardingPlacement,
  deleteOnboardingTargetingRule,
  getOnboardingExperiences,
  getOnboardingPlacements,
  getOnboardings,
  getOnboardingStatistics,
  getOnboardingTargetingRules,
  getOnboardingVersions,
  publishOnboarding,
  saveOnboardingPlacement,
  setOnboardingExperienceStatus,
  updateOnboarding,
  type Onboarding,
  type OnboardingExperience,
  type OnboardingPlacement,
  type OnboardingStatistics,
  type OnboardingTargetingRule,
  type OnboardingVersion,
} from "@/api/onboardings/onboardingsService";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ExperienceEditor,
  ExperienceStatisticsFilters,
  createExperienceDocument,
  fromOnboardingDefinition,
  toOnboardingDefinition,
  type ExperienceDocument,
} from "@/components/experience-editor";
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
import { useProjectSelection } from "@/context/useProjectSelection";
import { ApiError } from "@/lib/ApiError";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { EmptyProject, ModulePage, moduleErrorMessage } from "./ModulePage";

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : moduleErrorMessage(error);

export function OnboardingsPage() {
  const { selectedProject } = useProjectSelection();
  const [items, setItems] = useState<Onboarding[]>([]);
  const [selected, setSelected] = useState<Onboarding>();
  const [versions, setVersions] = useState<OnboardingVersion[]>([]);
  const [placements, setPlacements] = useState<OnboardingPlacement[]>([]);
  const [targetingRules, setTargetingRules] = useState<
    OnboardingTargetingRule[]
  >([]);
  const [experiences, setExperiences] = useState<OnboardingExperience[]>([]);
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [metadata, setMetadata] = useState({
    display_name: "",
    description: "",
  });
  const [document, setDocument] = useState<ExperienceDocument>(
    createExperienceDocument
  );
  const [documentValid, setDocumentValid] = useState(true);
  const [editorKey, setEditorKey] = useState("new");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const [onboardings, projectPlacements, rules, projectExperiences] =
        await Promise.all([
          getOnboardings(selectedProject.id),
          getOnboardingPlacements(selectedProject.id),
          getOnboardingTargetingRules(selectedProject.id),
          getOnboardingExperiences(selectedProject.id),
        ]);
      setItems(onboardings);
      setPlacements(projectPlacements);
      setTargetingRules(rules);
      setExperiences(projectExperiences);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [selectedProject]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (item: Onboarding) => {
    if (!selectedProject) return;
    setSelected(item);
    setMetadata({
      display_name: item.display_name,
      description: item.description ?? "",
    });
    try {
      const result = await getOnboardingVersions(selectedProject.id, item.id);
      setVersions(result);
      const latest = result[0];
      setDocument(fromOnboardingDefinition(latest?.configuration));
      setEditorKey(`${item.id}:${latest?.id ?? "new"}`);
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    }
  };

  const saveMetadata = async () => {
    if (!selectedProject || !selected || !metadata.display_name || busy) return;
    setBusy(true);
    try {
      await updateOnboarding(selectedProject.id, selected.id, {
        display_name: metadata.display_name,
        description: metadata.description || null,
      });
      setSelected((current) =>
        current ? { ...current, ...metadata } : current
      );
      showSuccessNotification("Onboarding details updated");
      await load();
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeOnboarding = async () => {
    if (!selectedProject || !selected || busy) return;
    setBusy(true);
    try {
      await deleteOnboarding(selectedProject.id, selected.id);
      setSelected(undefined);
      setVersions([]);
      setDocument(createExperienceDocument());
      setEditorKey("new");
      showSuccessNotification("Onboarding deleted");
      await load();
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
      const result = await createOnboarding(selectedProject.id, {
        identifier,
        display_name: name,
        configuration: toOnboardingDefinition(document),
      });
      setIdentifier("");
      setName("");
      showSuccessNotification("Onboarding and first draft created");
      await load();
      await open(result);
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!selectedProject || !selected || !documentValid || busy) return;
    setBusy(true);
    try {
      const version = await createOnboardingVersion(
        selectedProject.id,
        selected.id,
        { configuration: toOnboardingDefinition(document) }
      );
      showSuccessNotification(`Draft v${version.version} saved`);
      await open(selected);
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const publish = async (id: string) => {
    if (!selectedProject || !selected || busy) return;
    setBusy(true);
    try {
      await publishOnboarding(selectedProject.id, selected.id, id);
      showSuccessNotification("Onboarding version published");
      await Promise.all([load(), open(selected)]);
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModulePage
      title="Onboardings"
      description="Design multi-screen flows, target audiences and publish experiments."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Onboardings</CardTitle>
              <CardDescription>
                Create a flow with its first visual draft.
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
                disabled={busy || !identifier || !name || !documentValid}
                onClick={() => void create()}
              >
                <Plus />
                Create onboarding
              </Button>
              <div className="space-y-2 border-t pt-4">
                {items.map((item) => (
                  <button
                    key={item.id}
                    className={`w-full rounded-lg border p-3 text-left ${selected?.id === item.id ? "border-primary bg-primary/5" : ""}`}
                    onClick={() => void open(item)}
                  >
                    <b>{item.display_name}</b>
                    <p className="text-xs text-muted-foreground">
                      {item.identifier} ·{" "}
                      {item.active_version
                        ? `v${item.active_version} published`
                        : "not published"}
                    </p>
                  </button>
                ))}
                {!items.length && (
                  <p className="text-sm text-muted-foreground">
                    No onboardings yet.
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
                    ? `Edit ${selected.display_name}`
                    : "Visual onboarding editor"}
                </CardTitle>
                <CardDescription>
                  Reorder screens and blocks, configure transitions, theme and
                  mobile preview.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selected && (
                  <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_2fr_auto_auto]">
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
                      disabled={busy || !metadata.display_name}
                      onClick={() => void saveMetadata()}
                    >
                      Save details
                    </Button>
                    <Button
                      className="self-end"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void removeOnboarding()}
                    >
                      <Trash2 />
                      Delete
                    </Button>
                  </div>
                )}
                <ExperienceEditor
                  key={editorKey}
                  kind="onboarding"
                  initialDocument={document}
                  onChange={(value, valid) => {
                    setDocument(value);
                    setDocumentValid(valid);
                  }}
                />
                <Button
                  disabled={!selected || busy || !documentValid}
                  onClick={() => void save()}
                >
                  <Plus />
                  Save immutable draft
                </Button>
                <div className="space-y-2 border-t pt-4">
                  <p className="text-sm font-medium">Version history</p>
                  {versions.map((version) => (
                    <div
                      key={version.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <button
                        className="text-left"
                        onClick={() => {
                          setDocument(
                            fromOnboardingDefinition(version.configuration)
                          );
                          setEditorKey(`${selected?.id}:${version.id}:load`);
                        }}
                      >
                        <b>Version {version.version}</b>
                        <p className="text-xs capitalize text-muted-foreground">
                          {version.state}
                        </p>
                      </button>
                      <Button
                        variant="outline"
                        disabled={busy || version.state === "published"}
                        onClick={() => void publish(version.id)}
                      >
                        <Rocket />
                        Publish
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            {selected && (
              <OnboardingDeliveryControls
                projectRef={selectedProject.id}
                onboarding={selected}
                versions={versions}
                placements={placements.filter(
                  (item) => item.onboarding_id === selected.id
                )}
                rules={targetingRules}
                experiences={experiences}
                onChanged={load}
              />
            )}
          </div>
        </div>
      )}
    </ModulePage>
  );
}

function OnboardingDeliveryControls({
  projectRef,
  onboarding,
  versions,
  placements,
  rules,
  experiences,
  onChanged,
}: {
  projectRef: string;
  onboarding: Onboarding;
  versions: OnboardingVersion[];
  placements: OnboardingPlacement[];
  rules: OnboardingTargetingRule[];
  experiences: OnboardingExperience[];
  onChanged: () => Promise<void>;
}) {
  const published = versions.filter(({ state }) => state === "published");
  const [placementKey, setPlacementKey] = useState("app_launch");
  const [placementName, setPlacementName] = useState("App launch");
  const [versionId, setVersionId] = useState("");
  const [priority, setPriority] = useState(100);
  const [active, setActive] = useState(true);
  const [rulePlatform, setRulePlatform] = useState("ios");
  const [ruleLocale, setRuleLocale] = useState("");
  const [experimentName, setExperimentName] = useState(
    "First-run completion test"
  );
  const [editingPlacementId, setEditingPlacementId] = useState<string>();
  const [rulePlacementId, setRulePlacementId] = useState("");
  const [experimentPlacementId, setExperimentPlacementId] = useState("");
  const [busy, setBusy] = useState(false);
  const savePlacement = async () => {
    setBusy(true);
    try {
      await saveOnboardingPlacement(
        projectRef,
        {
          key: placementKey,
          name: placementName,
          onboarding_id: onboarding.id,
          active_version_id: versionId || null,
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
  const editPlacement = (placement: OnboardingPlacement) => {
    setEditingPlacementId(placement.id);
    setPlacementKey(placement.key);
    setPlacementName(placement.name);
    setVersionId(placement.active_version_id ?? "");
    setPriority(placement.priority);
    setActive(Boolean(placement.active));
  };
  const removePlacement = async (id: string) => {
    setBusy(true);
    try {
      await deleteOnboardingPlacement(projectRef, id);
      if (editingPlacementId === id) setEditingPlacementId(undefined);
      showSuccessNotification("Placement deleted");
      await onChanged();
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const createRule = async () => {
    const placement = placements.find(({ id }) => id === rulePlacementId);
    if (!placement) return;
    setBusy(true);
    try {
      await createOnboardingTargetingRule(projectRef, {
        placement_id: placement.id,
        name: `${rulePlatform}${ruleLocale ? ` ${ruleLocale}` : ""} audience`,
        priority: 100,
        conditions: {
          platform: rulePlatform,
          ...(ruleLocale ? { locale: ruleLocale } : {}),
        },
        active: true,
      });
      showSuccessNotification("Targeting rule created");
      await onChanged();
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const removeRule = async (id: string) => {
    setBusy(true);
    try {
      await deleteOnboardingTargetingRule(projectRef, id);
      showSuccessNotification("Targeting rule deleted");
      await onChanged();
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const createExperiment = async () => {
    const placement = placements.find(({ id }) => id === experimentPlacementId);
    if (!placement || published.length < 2) return;
    setBusy(true);
    try {
      await createOnboardingExperience(projectRef, {
        placement_id: placement.id,
        name: experimentName,
        status: "draft",
        traffic_percentage: 10000,
        variants: published.slice(0, 2).map((version, index) => ({
          id: crypto.randomUUID(),
          name: index ? "Variant B" : "Control",
          weight: 5000,
          version_id: version.id,
        })),
      });
      showSuccessNotification("A/B experience created as draft");
      await onChanged();
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const setExperimentStatus = async (
    experience: OnboardingExperience,
    status: OnboardingExperience["status"]
  ) => {
    setBusy(true);
    try {
      await setOnboardingExperienceStatus(projectRef, experience.id, status);
      showSuccessNotification(`Experiment ${status}`);
      await onChanged();
    } catch (cause) {
      showErrorNotification(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const onboardingPlacementIds = new Set(placements.map(({ id }) => id));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin />
          Delivery, targeting and A/B
        </CardTitle>
        <CardDescription>
          Resolve one published flow using placement priority, audience rules
          and stable variants.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label className="space-y-1 text-xs">
            Placement key
            <Input
              value={placementKey}
              onChange={(event) =>
                setPlacementKey(
                  event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_")
                )
              }
            />
          </label>
          <label className="space-y-1 text-xs">
            Name
            <Input
              value={placementName}
              onChange={(event) => setPlacementName(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            Published version
            <select
              className="block h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={versionId}
              onChange={(event) => setVersionId(event.target.value)}
            >
              <option value="">Use onboarding active version</option>
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
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={active} onCheckedChange={setActive} />
            Active
          </label>
          <Button
            disabled={busy || !placementKey || !placementName}
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
              <b>{placement.name}</b>
              <span className="ml-2 text-muted-foreground">
                {placement.key} · priority {placement.priority} ·{" "}
                {placement.active ? "active" : "inactive"}
              </span>
            </span>
            <span className="flex gap-1">
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Edit placement ${placement.name}`}
                onClick={() => editPlacement(placement)}
              >
                <Pencil />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete placement ${placement.name}`}
                disabled={busy}
                onClick={() => void removePlacement(placement.id)}
              >
                <Trash2 />
              </Button>
            </span>
          </div>
        ))}
        <div className="grid gap-3 border-t pt-4 md:grid-cols-4">
          <label className="space-y-1 text-xs">
            Placement
            <select
              className="block h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={rulePlacementId}
              onChange={(event) => setRulePlacementId(event.target.value)}
            >
              <option value="">Select…</option>
              {placements.map((placement) => (
                <option key={placement.id} value={placement.id}>
                  {placement.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            Platform
            <select
              className="block h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={rulePlatform}
              onChange={(event) => setRulePlatform(event.target.value)}
            >
              <option value="ios">iOS</option>
              <option value="android">Android</option>
              <option value="web">Web</option>
            </select>
          </label>
          <label className="space-y-1 text-xs">
            Locale (optional)
            <Input
              value={ruleLocale}
              onChange={(event) => setRuleLocale(event.target.value)}
              placeholder="fr-FR"
            />
          </label>
          <Button
            className="self-end"
            variant="outline"
            disabled={busy || !rulePlacementId}
            onClick={() => void createRule()}
          >
            <Target />
            Add audience rule
          </Button>
        </div>
        {rules
          .filter((rule) => onboardingPlacementIds.has(rule.placement_id))
          .map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <span>
                <b>{rule.name}</b>
                <span className="ml-2 text-muted-foreground">
                  priority {rule.priority}
                </span>
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete rule ${rule.name}`}
                disabled={busy}
                onClick={() => void removeRule(rule.id)}
              >
                <Trash2 />
              </Button>
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
              <option value="">Select…</option>
              {placements.map((placement) => (
                <option key={placement.id} value={placement.id}>
                  {placement.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            className="self-end"
            variant="outline"
            disabled={busy || !experimentPlacementId || published.length < 2}
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
        {experiences
          .filter((experience) =>
            onboardingPlacementIds.has(experience.placement_id)
          )
          .map((experience) => (
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
                  disabled={busy || experience.status === "completed"}
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
                  disabled={busy || experience.status === "completed"}
                  onClick={() =>
                    void setExperimentStatus(experience, "completed")
                  }
                >
                  Complete
                </Button>
              </span>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

export function OnboardingStatisticsPage() {
  const { selectedProject } = useProjectSelection();
  const [data, setData] = useState<OnboardingStatistics>();
  const [error, setError] = useState<string | null>(null);
  const defaultFilters = useMemo(
    () => ({
      from: new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10),
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
    if (selectedProject) {
      setError(null);
      getOnboardingStatistics(selectedProject.id, filters)
        .then(setData)
        .catch((cause) => setError(errorMessage(cause)));
    }
  }, [selectedProject, filters]);
  return (
    <ModulePage
      title="Onboarding statistics"
      description="Completion and drop-off across published onboarding flows."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <>
          <ExperienceStatisticsFilters value={filters} onChange={setFilters} />
          <div className="grid gap-4 md:grid-cols-3">
            {Object.entries(data?.totals ?? {}).map(([key, value]) => (
              <Card key={key}>
                <CardHeader>
                  <CardDescription>{key.replaceAll("_", " ")}</CardDescription>
                  <CardTitle className="text-3xl">
                    {value.toLocaleString()}
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
            <Card>
              <CardHeader>
                <CardDescription>completion rate</CardDescription>
                <CardTitle className="text-3xl">
                  {((data?.completion_rate ?? 0) * 100).toFixed(1)}%
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>drop-off rate</CardDescription>
                <CardTitle className="text-3xl">
                  {((data?.drop_off_rate ?? 0) * 100).toFixed(1)}%
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Step funnel</CardTitle>
            </CardHeader>
            <CardContent>
              {data?.funnel.map((row) => (
                <div
                  key={row.step}
                  className="flex justify-between border-b py-3"
                >
                  <span>{row.step}</span>
                  <b>{row.count.toLocaleString()}</b>
                </div>
              ))}
              {!data?.funnel.length && (
                <p className="text-sm text-muted-foreground">
                  No step events match this period.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Event timeline</CardTitle>
              <CardDescription>
                Detailed events for the active statistical dimensions.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Step</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Placement</TableHead>
                    <TableHead>Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.series ?? []).map((row, index) => (
                    <TableRow
                      key={`${row.date}:${row.event_type}:${row.step_id ?? ""}:${index}`}
                    >
                      <TableCell>{row.date}</TableCell>
                      <TableCell className="capitalize">
                        {row.event_type.replaceAll("_", " ")}
                      </TableCell>
                      <TableCell>{row.step_id || "—"}</TableCell>
                      <TableCell>{row.platform || "—"}</TableCell>
                      <TableCell>{row.placement || "—"}</TableCell>
                      <TableCell>
                        {Number(row.count).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!data?.series.length && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
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
