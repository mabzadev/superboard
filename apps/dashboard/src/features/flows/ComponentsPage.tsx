"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckSquare2,
  CircleHelp,
  Component,
  CreditCard,
  ListChecks,
  MessageCircle,
  PanelTop,
  Pencil,
  Plus,
  RefreshCw,
  SquareStack,
} from "lucide-react";

import {
  flowsApi,
  type FlowComponentDefinition,
  type FlowComponentLibrary,
} from "@/api/flows/flowsService";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { useFlows } from "./FlowsContext";
import { FlowsEmptyState, FlowsPage } from "./FlowsPage";
import { useFlowI18n } from "./i18n";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  card: CreditCard,
  BasicsV2Card: CreditCard,
  "floating-checklist": ListChecks,
  BasicsV2FloatingChecklist: ListChecks,
  hint: CircleHelp,
  BasicsV2Hint: CircleHelp,
  modal: SquareStack,
  BasicsV2Modal: SquareStack,
  tooltip: MessageCircle,
  BasicsV2Tooltip: MessageCircle,
  "survey-popover": CheckSquare2,
  BasicsV2SurveyPopover: CheckSquare2,
  tour: PanelTop,
};

export function ComponentsPage() {
  const { t, tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const [libraries, setLibraries] = useState<FlowComponentLibrary[]>([]);
  const [components, setComponents] = useState<FlowComponentDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [componentDialog, setComponentDialog] = useState<{
    library: FlowComponentLibrary;
    component?: FlowComponentDefinition;
  } | null>(null);

  const load = useCallback(async () => {
    if (!projectRef) return;
    setLoading(true);
    try {
      const result = await flowsApi.listComponents(projectRef);
      setLibraries(result.libraries);
      setComponents(result.components);
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
    } finally {
      setLoading(false);
    }
  }, [projectRef, t]);
  useEffect(() => {
    void load();
  }, [load]);

  const byLibrary = useMemo(
    () =>
      new Map(
        libraries.map((library) => [
          library.id,
          components.filter((component) => component.library_id === library.id),
        ])
      ),
    [components, libraries]
  );

  const toggle = async (library: FlowComponentLibrary, enabled: boolean) => {
    if (!projectRef) return;
    setLibraries((items) =>
      items.map((item) =>
        item.id === library.id ? { ...item, enabled } : item
      )
    );
    try {
      await flowsApi.updateComponentLibrary(projectRef, library.id, {
        name: library.name,
        enabled,
      });
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
      await load();
    }
  };
  const synchronize = async (component: FlowComponentDefinition) => {
    if (!projectRef) return;
    try {
      const result = await flowsApi.synchronizeComponent(
        projectRef,
        component.id
      );
      showSuccessNotification(
        `${component.name} · ${tr("Instances synchronized with")} v${result.version}`
      );
      await load();
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
    }
  };

  return (
    <FlowsPage
      title={t("components")}
      description={t("componentsDescription")}
      actions={
        <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus /> {tr("New component library")}
            </Button>
          </DialogTrigger>
          <CreateLibraryDialog
            onCreated={() => {
              setLibraryOpen(false);
              void load();
            }}
          />
        </Dialog>
      }
    >
      {libraries.map((library) => (
        <section key={library.id} className="grid gap-3">
          <header className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border bg-card p-4">
            <div>
              <h2 className="font-semibold">{library.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {library.source} · {library.identifier}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {library.source === "custom" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setComponentDialog({ library })}
                >
                  <Plus /> {tr("Create component")}
                </Button>
              )}
              <span className="text-sm text-muted-foreground">
                {library.enabled ? t("enabled") : t("disabled")}
              </span>
              <Switch
                checked={Boolean(library.enabled)}
                onCheckedChange={(value) => void toggle(library, value)}
              />
            </div>
          </header>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(byLibrary.get(library.id) ?? []).map((definition) => {
              const Icon =
                ICONS[definition.component_type] ??
                ICONS[definition.key] ??
                Component;
              return (
                <Card key={definition.id}>
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <span className="rounded-[var(--radius-sm)] border bg-muted p-2">
                        <Icon className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <CardTitle>{definition.name}</CardTitle>
                        <CardDescription className="mt-1 font-mono text-xs">
                          {definition.key} · v{definition.current_version ?? 1}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      {definition.exit_nodes.map((exit) => (
                        <span
                          key={exit}
                          className="rounded-full border bg-muted px-2 py-0.5 font-mono text-[10px]"
                        >
                          {exit}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {Object.keys(definition.css_variables).length} CSS
                      variables · {schemaProperties(definition).length}{" "}
                      properties · {definition.instance_count ?? 0} instances
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("outdatedInstances")}:{" "}
                      {definition.outdated_instances ?? 0}
                    </p>
                    {library.source === "custom" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setComponentDialog({
                            library,
                            component: definition,
                          })
                        }
                      >
                        <Pencil /> {tr("Edit definition")}
                      </Button>
                    )}
                    {Number(definition.outdated_instances ?? 0) > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void synchronize(definition)}
                      >
                        <RefreshCw /> {t("updateInstances")} (
                        {definition.outdated_instances})
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
      {!loading && libraries.length === 0 && (
        <FlowsEmptyState
          icon={Component}
          title={t("noData")}
          description={tr("Basics V2 is available in every project.")}
        />
      )}
      {loading && libraries.length === 0 && (
        <div className="min-h-52 animate-pulse rounded-[var(--radius)] border bg-card" />
      )}
      <Dialog
        open={Boolean(componentDialog)}
        onOpenChange={(open) => {
          if (!open) setComponentDialog(null);
        }}
      >
        {componentDialog && (
          <ComponentDefinitionDialog
            key={componentDialog.component?.id ?? componentDialog.library.id}
            library={componentDialog.library}
            component={componentDialog.component}
            onSaved={() => {
              setComponentDialog(null);
              void load();
            }}
          />
        )}
      </Dialog>
    </FlowsPage>
  );
}

function CreateLibraryDialog({ onCreated }: { onCreated: () => void }) {
  const { tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!projectRef || !name.trim() || !key) return;
    setBusy(true);
    try {
      await flowsApi.createComponentLibrary(projectRef, {
        name: name.trim(),
        identifier: key,
      });
      showSuccessNotification(`${name.trim()} · ${tr("Created")}`);
      onCreated();
    } catch (cause) {
      showErrorNotification(tr(errorMessage(cause)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{tr("New component library")}</DialogTitle>
        <DialogDescription>
          {tr(
            "Custom libraries are available to every workflow in this project."
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <label className="grid gap-2">
          <Label>{tr("Name")}</Label>
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!key) setKey(toIdentifier(event.target.value));
            }}
          />
        </label>
        <label className="grid gap-2">
          <Label>{tr("Identifier")}</Label>
          <Input
            className="font-mono"
            value={key}
            onChange={(event) => setKey(toIdentifier(event.target.value))}
          />
        </label>
      </div>
      <DialogFooter>
        <Button
          disabled={!name.trim() || !key || busy}
          onClick={() => void create()}
        >
          {busy ? tr("Creating…") : tr("Create library")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ComponentDefinitionDialog({
  library,
  component,
  onSaved,
}: {
  library: FlowComponentLibrary;
  component?: FlowComponentDefinition;
  onSaved: () => void;
}) {
  const { tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const schema = component?.schema ?? {};
  const [name, setName] = useState(component?.name ?? "");
  const [key, setKey] = useState(component?.key ?? "");
  const [componentType, setComponentType] = useState(
    component?.component_type ?? ""
  );
  const [templateType, setTemplateType] = useState(
    String(schema.template_type ?? "component")
  );
  const [description, setDescription] = useState(
    String(schema.description ?? "")
  );
  const [slottable, setSlottable] = useState(schema.slottable === true);
  const [exitNodes, setExitNodes] = useState(
    component?.exit_nodes.join(", ") ?? "continue, close"
  );
  const [properties, setProperties] = useState(() =>
    JSON.stringify(schemaProperties(component), null, 2)
  );
  const [cssVariables, setCssVariables] = useState(() =>
    JSON.stringify(component?.css_variables ?? {}, null, 2)
  );
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!projectRef || !name.trim() || !key || !componentType) return;
    setBusy(true);
    try {
      const parsedProperties = parseJsonArray(properties, "properties");
      const parsedCss = parseCssVariables(cssVariables);
      const definition = {
        name: name.trim(),
        schema: {
          template_type: templateType,
          description: description.trim(),
          slottable,
          properties: parsedProperties,
        },
        exit_nodes: commaSeparated(exitNodes),
        css_variables: parsedCss,
      };
      if (component) {
        await flowsApi.updateComponent(projectRef, component.id, definition);
      } else {
        await flowsApi.createComponent(projectRef, {
          library_id: library.id,
          key,
          component_type: componentType,
          ...definition,
        });
      }
      showSuccessNotification(
        component
          ? tr("New component version created")
          : tr("Component created")
      );
      onSaved();
    } catch (cause) {
      showErrorNotification(tr(errorMessage(cause)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>
          {component
            ? `${tr("Edit")} ${component.name}`
            : `${tr("New")} ${library.name} ${tr("Component").toLowerCase()}`}
        </DialogTitle>
        <DialogDescription>
          {tr(
            "Saving an existing definition creates a new immutable component version. Instances update only after explicit synchronization."
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2">
          <Label>{tr("Name")}</Label>
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!key) setKey(toIdentifier(event.target.value));
              if (!componentType)
                setComponentType(toIdentifier(event.target.value));
            }}
          />
        </label>
        <label className="grid gap-2">
          <Label>{tr("Persistent key")}</Label>
          <Input
            className="font-mono"
            disabled={Boolean(component)}
            value={key}
            onChange={(event) => setKey(toIdentifier(event.target.value))}
          />
        </label>
        <label className="grid gap-2">
          <Label>{tr("SDK component type")}</Label>
          <Input
            className="font-mono"
            disabled={Boolean(component)}
            value={componentType}
            onChange={(event) =>
              setComponentType(toIdentifier(event.target.value))
            }
          />
        </label>
        <label className="grid gap-2">
          <Label>{tr("Template type")}</Label>
          <Select value={templateType} onValueChange={setTemplateType}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="component">{tr("Component")}</SelectItem>
              <SelectItem value="tour-component">
                {tr("Tour component")}
              </SelectItem>
              <SelectItem value="survey-component">
                {tr("Survey component")}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-2 sm:col-span-2">
          <Label>{tr("Description")}</Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className="flex items-center justify-between rounded border p-3 sm:col-span-2">
          <div>
            <Label>{tr("Slottable")}</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {tr("Allow the SDK to render this component in a named slot.")}
            </p>
          </div>
          <Switch checked={slottable} onCheckedChange={setSlottable} />
        </div>
        <label className="grid gap-2 sm:col-span-2">
          <Label>{tr("Exit nodes")}</Label>
          <Input
            className="font-mono"
            value={exitNodes}
            onChange={(event) => setExitNodes(event.target.value)}
            placeholder="continue, close"
          />
        </label>
        <label className="grid gap-2 sm:col-span-2">
          <Label>{tr("Typed properties (JSON array)")}</Label>
          <Textarea
            className="min-h-44 font-mono text-xs"
            value={properties}
            onChange={(event) => setProperties(event.target.value)}
          />
        </label>
        <label className="grid gap-2 sm:col-span-2">
          <Label>{tr("CSS variables (JSON object)")}</Label>
          <Textarea
            className="min-h-32 font-mono text-xs"
            value={cssVariables}
            onChange={(event) => setCssVariables(event.target.value)}
          />
        </label>
      </div>
      <DialogFooter>
        <Button
          disabled={!name.trim() || !key || !componentType || busy}
          onClick={() => void save()}
        >
          {busy
            ? tr("Saving…")
            : component
              ? tr("Create version")
              : tr("Create component")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function schemaProperties(
  component?: FlowComponentDefinition
): Record<string, unknown>[] {
  const value = component?.schema.properties;
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

function parseJsonArray(
  value: string,
  field: string
): Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error(`${field} must be a JSON array`);
  if (
    !parsed.every(
      (item) =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
  )
    throw new Error(`${field} must contain JSON objects`);
  return parsed as Record<string, unknown>[];
}

function parseCssVariables(value: string): Record<string, string> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("CSS variables must be a JSON object");
  return Object.fromEntries(
    Object.entries(parsed).map(([key, item]) => [key, String(item ?? "")])
  );
}

function commaSeparated(value: string): string[] {
  return [...new Set(value.split(",").map(toIdentifier).filter(Boolean))];
}

function toIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unable to update component";
}
