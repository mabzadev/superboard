"use client";

import { useEffect, useRef, useState } from "react";
import type {
  FlowPropertyType,
  FlowQuestionType,
  FlowSurveyQuestion,
} from "@superboard/contracts/flows";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import type {
  FlowBlock,
  FlowComponentDefinition,
  FlowPath,
  FlowTranslation,
} from "@/api/flows/flowsService";
import { Button } from "@/components/ui/button";
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
import { showErrorNotification } from "@/lib/Notifications";
import { useFlowI18n } from "../i18n";
import {
  applyComponentDefinition,
  BASICS_V2_COMPONENT_TYPES,
  componentBlockType,
} from "./graph";

export function InspectorPanel({
  block,
  path,
  width,
  onResize,
  onChange,
  onPathChange,
  onDelete,
  locales,
  translations,
  components = [],
  onTranslate,
}: {
  block: FlowBlock | null;
  path?: FlowPath | null;
  width: number;
  onResize: (width: number) => void;
  onChange: (block: FlowBlock) => void;
  onPathChange?: (path: FlowPath) => void;
  onDelete: () => void;
  locales: string[];
  translations: FlowTranslation[];
  components?: FlowComponentDefinition[];
  onTranslate?: (
    blockKey: string,
    propertyKey: string,
    locale: string,
    value: unknown
  ) => Promise<void>;
}) {
  const { t, tr } = useFlowI18n();
  const resizing = useRef(false);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!resizing.current) return;
      onResize(Math.min(560, Math.max(280, window.innerWidth - event.clientX)));
    };
    const up = () => {
      resizing.current = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [onResize]);

  return (
    <aside
      className="relative shrink-0 overflow-y-auto border-l bg-card"
      style={{ width }}
      aria-label={t("inspector")}
    >
      <button
        type="button"
        aria-label={tr("Resize inspector")}
        className="absolute inset-y-0 left-0 z-10 flex w-2 cursor-col-resize items-center justify-center text-muted-foreground hover:bg-accent"
        onPointerDown={() => {
          resizing.current = true;
        }}
      >
        <GripVertical className="size-3" />
      </button>
      <div className="border-b px-5 py-4">
        <h2 className="font-semibold">{t("inspector")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {tr("Block properties and runtime behavior")}
        </p>
      </div>
      {path && onPathChange ? (
        <PathProperties
          path={path}
          onChange={onPathChange}
          onDelete={onDelete}
        />
      ) : !block ? (
        <p className="px-5 py-8 text-sm text-muted-foreground">
          {t("noSelection")}
        </p>
      ) : (
        <div className="grid gap-5 px-5 py-4">
          <label className="grid gap-2">
            <Label htmlFor="flow-block-name">{t("blockName")}</Label>
            <Input
              id="flow-block-name"
              value={block.name}
              onChange={(event) =>
                onChange({ ...block, name: event.target.value })
              }
            />
          </label>
          <label className="grid gap-2">
            <Label htmlFor="flow-block-key">{t("blockKey")}</Label>
            <Input
              id="flow-block-key"
              className="font-mono"
              value={block.key}
              onChange={(event) =>
                onChange({
                  ...block,
                  key: event.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]/g, "_"),
                })
              }
            />
          </label>
          <label className="grid gap-2">
            <Label htmlFor="flow-block-description">{t("description")}</Label>
            <Textarea
              id="flow-block-description"
              rows={3}
              value={block.description ?? ""}
              onChange={(event) =>
                onChange({ ...block, description: event.target.value })
              }
            />
          </label>
          <BlockProperties
            block={block}
            components={components}
            onChange={onChange}
          />
          <LocalizationEditor
            block={block}
            locales={locales}
            translations={translations}
            onTranslate={onTranslate}
          />
          <div className="border-t pt-4">
            <Button variant="destructive" size="sm" onClick={onDelete}>
              <Trash2 /> {t("delete")}
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}

function PathProperties({
  path,
  onChange,
  onDelete,
}: {
  path: FlowPath;
  onChange: (path: FlowPath) => void;
  onDelete: () => void;
}) {
  const { tr } = useFlowI18n();
  return (
    <div className="grid gap-5 px-5 py-4">
      <div className="grid gap-1 rounded border bg-muted/40 p-3 font-mono text-xs">
        <span className="truncate">{path.sourceBlockId}</span>
        <span className="text-muted-foreground">↓ {path.sourceExitNode}</span>
        <span className="truncate">{path.targetBlockId}</span>
      </div>
      <label className="grid gap-2">
        <Label htmlFor="flow-path-label">{tr("Connection label")}</Label>
        <Input
          id="flow-path-label"
          value={path.label ?? ""}
          placeholder={path.sourceExitNode}
          onChange={(event) =>
            onChange({ ...path, label: event.target.value || null })
          }
        />
      </label>
      <div className="flex items-center justify-between rounded border p-3">
        <div>
          <Label htmlFor="flow-path-trigger">{tr("Block trigger")}</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {tr("Trigger the destination without leaving the current block.")}
          </p>
        </div>
        <Switch
          id="flow-path-trigger"
          checked={Boolean(path.triggerOnly)}
          onCheckedChange={(triggerOnly) => onChange({ ...path, triggerOnly })}
        />
      </div>
      <div className="border-t pt-4">
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 /> {tr("Delete connection")}
        </Button>
      </div>
    </div>
  );
}

function LocalizationEditor({
  block,
  locales,
  translations,
  onTranslate,
}: {
  block: FlowBlock;
  locales: string[];
  translations: FlowTranslation[];
  onTranslate?: (
    blockKey: string,
    propertyKey: string,
    locale: string,
    value: unknown
  ) => Promise<void>;
}) {
  const { tr } = useFlowI18n();
  const [locale, setLocale] = useState(locales[0] ?? "en");
  useEffect(() => {
    if (!locales.includes(locale)) setLocale(locales[0] ?? "en");
  }, [locale, locales]);
  const fields = Object.entries(block.data).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  );
  if (!fields.length || !onTranslate) return null;
  return (
    <section className="grid gap-3 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{tr("Localized content")}</h3>
        <Select value={locale} onValueChange={setLocale}>
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {locales.map((item) => (
              <SelectItem key={item} value={item}>
                {item.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {fields.map(([key, fallback]) => {
        const translated = translations.find(
          (item) =>
            item.block_key === block.key &&
            item.property_key === key &&
            item.locale === locale
        )?.value;
        return (
          <TranslationField
            key={`${locale}:${key}`}
            label={key}
            fallback={fallback}
            value={typeof translated === "string" ? translated : ""}
            onSave={(value) => onTranslate(block.key, key, locale, value)}
          />
        );
      })}
    </section>
  );
}

function TranslationField({
  label,
  fallback,
  value,
  onSave,
}: {
  label: string;
  fallback: string;
  value: string;
  onSave: (value: string) => Promise<void>;
}) {
  const { tr } = useFlowI18n();
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(Boolean(value));
  return (
    <label className="grid gap-1.5">
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs">{label}</span>
        <span
          className={
            saved ? "text-[10px] text-green-600" : "text-[10px] text-amber-600"
          }
        >
          {saved ? tr("Translated") : tr("Missing · fallback")}
        </span>
      </span>
      <Input
        value={draft}
        placeholder={fallback}
        disabled={saving}
        onChange={(event) => {
          setDraft(event.target.value);
          setSaved(false);
        }}
        onBlur={() => {
          if (draft === value) return;
          setSaving(true);
          void onSave(draft)
            .then(() => setSaved(Boolean(draft)))
            .catch((cause: unknown) => {
              setSaved(false);
              showErrorNotification(
                cause instanceof Error
                  ? cause.message
                  : tr("Unable to save translation")
              );
            })
            .finally(() => setSaving(false));
        }}
      />
    </label>
  );
}

function BlockProperties({
  block,
  components,
  onChange,
}: {
  block: FlowBlock;
  components: FlowComponentDefinition[];
  onChange: (block: FlowBlock) => void;
}) {
  const { tr } = useFlowI18n();
  const setProperty = (key: string, value: unknown) =>
    onChange({
      ...block,
      data: { ...block.data, [key]: value },
    });
  const compatibleComponents = components.filter(
    (component) => componentBlockType(component) === block.type
  );
  const selectedComponent = compatibleComponents.find(
    (component) =>
      component.key === block.data.componentKey ||
      component.component_type === block.componentType
  );

  return (
    <section className="grid gap-3 border-t pt-4">
      <h3 className="text-sm font-semibold">{tr("Runtime properties")}</h3>
      {block.type === "delay" && (
        <label className="grid gap-2">
          <Label>{tr("Duration")}</Label>
          <div className="grid grid-cols-3 gap-2">
            <DurationInput
              label={tr("Days")}
              max={30}
              value={Number(block.data.days ?? 0)}
              onChange={(value) => setProperty("days", value)}
            />
            <DurationInput
              label={tr("Hours")}
              max={23}
              value={Number(block.data.hours ?? 0)}
              onChange={(value) => setProperty("hours", value)}
            />
            <DurationInput
              label={tr("Minutes")}
              max={59}
              value={Number(block.data.minutes ?? 0)}
              onChange={(value) => setProperty("minutes", value)}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            Maximum 30 days. Long delays run on Cloudflare Workflows.
          </span>
        </label>
      )}
      {(block.type === "component" ||
        block.type === "tour-component" ||
        block.type === "survey") && (
        <>
          <label className="grid gap-2">
            <Label htmlFor="component-key">{tr("Component definition")}</Label>
            {compatibleComponents.length > 0 ? (
              <Select
                value={selectedComponent?.key ?? ""}
                onValueChange={(key) => {
                  const component = components.find(
                    (item) =>
                      componentBlockType(item) === block.type &&
                      (item.key === key || item.component_type === key)
                  );
                  if (component)
                    onChange(applyComponentDefinition(block, component));
                }}
              >
                <SelectTrigger id="component-key" className="w-full">
                  <SelectValue placeholder={tr("Select a component")} />
                </SelectTrigger>
                <SelectContent>
                  {compatibleComponents.map((component) => (
                    <SelectItem key={component.id} value={component.key}>
                      {component.name} · v{component.current_version ?? 1}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="component-key"
                value={String(block.componentType ?? "")}
                onChange={(event) =>
                  onChange({ ...block, componentType: event.target.value })
                }
              />
            )}
            <span className="font-mono text-[10px] text-muted-foreground">
              {block.componentType ?? tr("No SDK component")}
            </span>
          </label>
          {block.slottable && (
            <label className="grid gap-2">
              <Label htmlFor="component-slot">{tr("Slot")}</Label>
              <Input
                id="component-slot"
                value={String(block.slotId ?? "default")}
                onChange={(event) =>
                  onChange({
                    ...block,
                    slotId: event.target.value,
                  })
                }
              />
            </label>
          )}
        </>
      )}
      {block.type === "workflow-trigger" && (
        <>
          <label className="grid gap-2">
            <Label htmlFor="target-workflow">{tr("Target workflow id")}</Label>
            <Input
              id="target-workflow"
              className="font-mono"
              value={String(block.data.workflowId ?? "")}
              onChange={(event) => setProperty("workflowId", event.target.value)}
            />
          </label>
          <label className="grid gap-2">
            <Label htmlFor="target-manual-start-key">
              {tr("Manual start block key")}
            </Label>
            <Input
              id="target-manual-start-key"
              className="font-mono"
              value={String(block.data.blockKey ?? "")}
              onChange={(event) => setProperty("blockKey", event.target.value)}
              placeholder="start-from-parent"
            />
          </label>
        </>
      )}
      {block.type === "note" && (
        <label className="grid gap-2">
          <Label htmlFor="note-text">{tr("Internal note")}</Label>
          <Textarea
            id="note-text"
            rows={6}
            value={String(block.notes ?? "")}
            onChange={(event) =>
              onChange({ ...block, notes: event.target.value })
            }
          />
        </label>
      )}
      {block.type === "survey" && (
        <SurveyBuilder
          value={block.surveyQuestions ?? []}
          onChange={(surveyQuestions) =>
            onChange({ ...block, surveyQuestions })
          }
        />
      )}
      {block.type === "tour" && (
        <TourBuilder
          value={records(block.data.steps)}
          components={components.filter(
            (component) => componentBlockType(component) === "tour-component"
          )}
          onChange={(value) => setProperty("steps", value)}
        />
      )}
      {block.type === "filter" && (
        <ConditionsBuilder
          value={records(block.conditions)}
          onChange={(conditions) =>
            onChange({
              ...block,
              conditions: conditions as FlowBlock["conditions"],
            })
          }
        />
      )}
      {block.type === "traffic-split" && (
        <TrafficSplitBuilder
          value={records(block.data.variants)}
          onChange={(variants) =>
            onChange({
              ...block,
              data: { ...block.data, variants },
              exitNodes: variants
                .map((variant) => String(variant.key ?? ""))
                .filter(Boolean),
            })
          }
        />
      )}
      <PropertyBagEditor block={block} onChange={onChange} />
    </section>
  );
}

function SurveyBuilder({
  value,
  onChange,
}: {
  value: FlowSurveyQuestion[];
  onChange: (value: FlowSurveyQuestion[]) => void;
}) {
  const { tr } = useFlowI18n();
  const add = () =>
    onChange([
      ...value,
      {
        id: crypto.randomUUID(),
        type: "freeform",
        title: tr("New question"),
        optional: false,
      },
    ]);
  return (
    <EditorCollection title={tr("Survey questions")} onAdd={add}>
      {value.map((question, index) => (
        <CollectionItem
          key={String(question.id ?? index)}
          index={index}
          count={value.length}
          onMove={(direction) => onChange(move(value, index, direction))}
          onRemove={() =>
            onChange(value.filter((_, itemIndex) => itemIndex !== index))
          }
        >
          <Select
            value={String(question.type ?? "freeform")}
            onValueChange={(type) =>
              onChange(
                replace(value, index, {
                  ...question,
                  type: type as FlowQuestionType,
                })
              )
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="freeform">{tr("Freeform")}</SelectItem>
              <SelectItem value="rating">{tr("Rating")}</SelectItem>
              <SelectItem value="single-choice">
                {tr("Single choice")}
              </SelectItem>
              <SelectItem value="multiple-choice">
                {tr("Multiple choice")}
              </SelectItem>
              <SelectItem value="link">{tr("Link")}</SelectItem>
              <SelectItem value="end-screen">{tr("End screen")}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={String(question.title ?? "")}
            placeholder={tr("Question title")}
            onChange={(event) =>
              onChange(
                replace(value, index, {
                  ...question,
                  title: event.target.value,
                })
              )
            }
          />
          <Textarea
            rows={2}
            value={String(question.description ?? "")}
            placeholder={tr("Optional supporting text")}
            onChange={(event) =>
              onChange(
                replace(value, index, {
                  ...question,
                  description: event.target.value,
                })
              )
            }
          />
          {question.type === "freeform" && (
            <Input
              value={String(question.textPlaceholder ?? "")}
              placeholder={tr("Answer placeholder")}
              onChange={(event) =>
                onChange(
                  replace(value, index, {
                    ...question,
                    textPlaceholder: event.target.value,
                  })
                )
              }
            />
          )}
          {(question.type === "single-choice" ||
            question.type === "multiple-choice") && (
            <Input
              value={optionLabels(question.options).join(", ")}
              placeholder={tr("Options separated by commas")}
              onChange={(event) =>
                onChange(
                  replace(value, index, {
                    ...question,
                    options: updateQuestionOptions(
                      question.options,
                      csv(event.target.value)
                    ),
                  })
                )
              }
            />
          )}
          {question.type === "rating" && (
            <div className="grid gap-2">
              <div className="grid grid-cols-3 gap-2">
                <Select
                  value={String(question.displayType ?? "number")}
                  onValueChange={(displayType) =>
                    onChange(
                      replace(value, index, {
                        ...question,
                        displayType: displayType as
                          | "number"
                          | "stars"
                          | "emoji",
                      })
                    )
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="number">{tr("Numbers")}</SelectItem>
                    <SelectItem value="stars">{tr("Stars")}</SelectItem>
                    <SelectItem value="emoji">{tr("Emojis")}</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  aria-label={tr("Minimum rating")}
                  type="number"
                  min={0}
                  max={9}
                  value={Number(question.minValue ?? 1)}
                  onChange={(event) =>
                    onChange(
                      replace(value, index, {
                        ...question,
                        minValue: Number(event.target.value),
                      })
                    )
                  }
                />
                <Input
                  aria-label={tr("Maximum rating")}
                  type="number"
                  min={2}
                  max={10}
                  value={Number(question.maxValue ?? 5)}
                  onChange={(event) =>
                    onChange(
                      replace(value, index, {
                        ...question,
                        maxValue: Number(event.target.value),
                      })
                    )
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={String(question.lowerBoundLabel ?? "")}
                  placeholder={tr("Lower bound label")}
                  onChange={(event) =>
                    onChange(
                      replace(value, index, {
                        ...question,
                        lowerBoundLabel: event.target.value,
                      })
                    )
                  }
                />
                <Input
                  value={String(question.upperBoundLabel ?? "")}
                  placeholder={tr("Upper bound label")}
                  onChange={(event) =>
                    onChange(
                      replace(value, index, {
                        ...question,
                        upperBoundLabel: event.target.value,
                      })
                    )
                  }
                />
              </div>
            </div>
          )}
          {question.type === "link" && (
            <div className="grid gap-2">
              <Input
                value={String(question.linkLabel ?? "")}
                placeholder={tr("Link label")}
                onChange={(event) =>
                  onChange(
                    replace(value, index, {
                      ...question,
                      linkLabel: event.target.value,
                    })
                  )
                }
              />
              <Input
                value={String(question.url ?? "")}
                placeholder="https://"
                onChange={(event) =>
                  onChange(
                    replace(value, index, {
                      ...question,
                      url: event.target.value,
                    })
                  )
                }
              />
              <Toggle
                label={tr("Open in new tab")}
                checked={Boolean(question.openInNew)}
                onChange={(openInNew) =>
                  onChange(replace(value, index, { ...question, openInNew }))
                }
              />
            </div>
          )}
          {!["end-screen", "link"].includes(String(question.type)) && (
            <div className="flex items-center justify-between rounded border px-3 py-2">
              <Label>{tr("Optional")}</Label>
              <Switch
                checked={Boolean(question.optional)}
                onCheckedChange={(optional) =>
                  onChange(replace(value, index, { ...question, optional }))
                }
              />
            </div>
          )}
          {(question.type === "single-choice" ||
            question.type === "multiple-choice") && (
            <div className="grid grid-cols-2 gap-2">
              <Toggle
                label={tr("Other")}
                checked={Boolean(question.otherOption)}
                onChange={(otherOption) =>
                  onChange(replace(value, index, { ...question, otherOption }))
                }
              />
              <Toggle
                label={tr("Shuffle")}
                checked={Boolean(question.shuffleOptions)}
                onChange={(shuffleOptions) =>
                  onChange(
                    replace(value, index, { ...question, shuffleOptions })
                  )
                }
              />
            </div>
          )}
          {(question.type === "single-choice" ||
            question.type === "multiple-choice") &&
            question.otherOption && (
              <Input
                value={String(question.otherLabel ?? "")}
                placeholder={tr("Other option label")}
                onChange={(event) =>
                  onChange(
                    replace(value, index, {
                      ...question,
                      otherLabel: event.target.value,
                    })
                  )
                }
              />
            )}
        </CollectionItem>
      ))}
    </EditorCollection>
  );
}

function TourBuilder({
  value,
  components,
  onChange,
}: {
  value: Record<string, unknown>[];
  components: FlowComponentDefinition[];
  onChange: (value: Record<string, unknown>[]) => void;
}) {
  const { tr } = useFlowI18n();
  const add = () => {
    const component = components[0];
    onChange([
      ...value,
      {
        id: crypto.randomUUID(),
        name: `${tr("Step")} ${value.length + 1}`,
        componentKey: component?.key ?? "tour-tooltip",
        componentType:
          component?.component_type ?? BASICS_V2_COMPONENT_TYPES.tooltip,
        componentLibraryName:
          component?.library_name ??
          component?.library_identifier ??
          "Basics V2",
        componentVersion: component?.current_version ?? 1,
        slottable: component?.schema.slottable === true,
        anchor: "",
        trigger: "immediate",
        wait: "none",
      },
    ]);
  };
  return (
    <EditorCollection title={tr("Tour steps")} onAdd={add}>
      {value.map((step, index) => (
        <CollectionItem
          key={String(step.id ?? index)}
          index={index}
          count={value.length}
          onMove={(direction) => onChange(move(value, index, direction))}
          onRemove={() =>
            onChange(value.filter((_, itemIndex) => itemIndex !== index))
          }
        >
          <Input
            value={String(step.name ?? "")}
            placeholder={`${tr("Step")} ${index + 1}`}
            onChange={(event) =>
              onChange(
                replace(value, index, { ...step, name: event.target.value })
              )
            }
          />
          <div className="grid grid-cols-2 gap-2">
            {components.length > 0 ? (
              <Select
                value={String(step.componentKey ?? components[0]?.key ?? "")}
                onValueChange={(key) => {
                  const component = components.find((item) => item.key === key);
                  if (!component) return;
                  onChange(
                    replace(value, index, {
                      ...step,
                      componentKey: component.key,
                      componentType: component.component_type,
                      componentLibraryName:
                        component.library_name ??
                        component.library_identifier ??
                        "Basics V2",
                      componentVersion: component.current_version ?? 1,
                      slottable: component.schema.slottable === true,
                    })
                  );
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={tr("Tour component")} />
                </SelectTrigger>
                <SelectContent>
                  {components.map((component) => (
                    <SelectItem key={component.id} value={component.key}>
                      {component.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={String(
                  step.componentType ?? BASICS_V2_COMPONENT_TYPES.tooltip
                )}
                placeholder={tr("SDK component type")}
                onChange={(event) =>
                  onChange(
                    replace(value, index, {
                      ...step,
                      componentType: event.target.value,
                    })
                  )
                }
              />
            )}
            <Input
              value={String(step.anchor ?? "")}
              placeholder={tr("DOM/mobile anchor")}
              onChange={(event) =>
                onChange(
                  replace(value, index, { ...step, anchor: event.target.value })
                )
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={String(step.trigger ?? "immediate")}
              onValueChange={(trigger) =>
                onChange(replace(value, index, { ...step, trigger }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">{tr("Immediate")}</SelectItem>
                <SelectItem value="navigation">{tr("Navigation")}</SelectItem>
                <SelectItem value="click">{tr("Click")}</SelectItem>
                <SelectItem value="element-present">
                  {tr("Element present")}
                </SelectItem>
                <SelectItem value="element-absent">
                  {tr("Element absent")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={String(step.wait ?? "none")}
              onValueChange={(wait) =>
                onChange(replace(value, index, { ...step, wait }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{tr("No wait")}</SelectItem>
                <SelectItem value="navigation">{tr("Navigation")}</SelectItem>
                <SelectItem value="click">{tr("Click")}</SelectItem>
                <SelectItem value="delay">{tr("Delay")}</SelectItem>
                <SelectItem value="element-present">
                  {tr("Element present")}
                </SelectItem>
                <SelectItem value="element-absent">
                  {tr("Element absent")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CollectionItem>
      ))}
    </EditorCollection>
  );
}

function ConditionsBuilder({
  value,
  onChange,
}: {
  value: Record<string, unknown>[];
  onChange: (value: Record<string, unknown>[]) => void;
}) {
  const { tr } = useFlowI18n();
  const add = () =>
    onChange([
      ...value,
      { key: "", data_type: "string", operator: "equals", value: [""] },
    ]);
  return (
    <EditorCollection title={tr("Typed conditions (AND)")} onAdd={add}>
      {value.map((condition, index) => (
        <CollectionItem
          key={index}
          index={index}
          count={value.length}
          onMove={(direction) => onChange(move(value, index, direction))}
          onRemove={() =>
            onChange(value.filter((_, itemIndex) => itemIndex !== index))
          }
        >
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <Input
              value={String(condition.key ?? "")}
              placeholder={tr("User property")}
              onChange={(event) =>
                onChange(
                  replace(value, index, {
                    ...condition,
                    key: event.target.value,
                  })
                )
              }
            />
            <Select
              value={String(condition.data_type ?? "string")}
              onValueChange={(data_type) =>
                onChange(replace(value, index, { ...condition, data_type }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="string">{tr("String")}</SelectItem>
                <SelectItem value="number">{tr("Number")}</SelectItem>
                <SelectItem value="boolean">{tr("Boolean")}</SelectItem>
                <SelectItem value="array">{tr("Array")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Select
            value={String(condition.operator ?? "equals")}
            onValueChange={(operator) =>
              onChange(replace(value, index, { ...condition, operator }))
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                "equals",
                "not-equals",
                "greater-than",
                "greater-than-or-equal",
                "less-than",
                "less-than-or-equal",
                "contains",
                "not-contains",
                "starts-with",
                "ends-with",
                "regex",
              ].map((operator) => (
                <SelectItem key={operator} value={operator}>
                  {operator.replaceAll("-", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={array(condition.value).join(", ")}
            placeholder={tr("Allowed values (OR)")}
            onChange={(event) =>
              onChange(
                replace(value, index, {
                  ...condition,
                  value: csv(event.target.value),
                })
              )
            }
          />
        </CollectionItem>
      ))}
    </EditorCollection>
  );
}

function TrafficSplitBuilder({
  value,
  onChange,
}: {
  value: Record<string, unknown>[];
  onChange: (value: Record<string, unknown>[]) => void;
}) {
  const { tr } = useFlowI18n();
  const total = value.reduce(
    (sum, variant) => sum + Number(variant.weight ?? 0),
    0
  );
  return (
    <EditorCollection
      title={`${tr("Stable variants")} · ${total}%`}
      onAdd={() =>
        onChange([...value, { key: `variant_${value.length + 1}`, weight: 0 }])
      }
    >
      {value.map((variant, index) => (
        <CollectionItem
          key={String(variant.key ?? index)}
          index={index}
          count={value.length}
          onMove={(direction) => onChange(move(value, index, direction))}
          onRemove={() =>
            onChange(value.filter((_, itemIndex) => itemIndex !== index))
          }
        >
          <div className="grid grid-cols-[1fr_96px] gap-2">
            <Input
              className="font-mono"
              value={String(variant.key ?? "")}
              onChange={(event) =>
                onChange(
                  replace(value, index, { ...variant, key: event.target.value })
                )
              }
            />
            <Input
              type="number"
              min={0}
              max={100}
              value={Number(variant.weight ?? 0)}
              onChange={(event) =>
                onChange(
                  replace(value, index, {
                    ...variant,
                    weight: Number(event.target.value),
                  })
                )
              }
            />
          </div>
        </CollectionItem>
      ))}
    </EditorCollection>
  );
}

function PropertyBagEditor({
  block,
  onChange,
}: {
  block: FlowBlock;
  onChange: (block: FlowBlock) => void;
}) {
  const { tr } = useFlowI18n();
  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState<FlowPropertyType>("string");
  const update = (index: number, value: unknown) =>
    onChange({
      ...block,
      propertyMeta: block.propertyMeta.map((property, itemIndex) =>
        itemIndex === index ? { ...property, value } : property
      ),
    });
  const remove = (index: number) =>
    onChange({
      ...block,
      propertyMeta: block.propertyMeta.filter(
        (_, itemIndex) => itemIndex !== index
      ),
    });
  const add = () => {
    const key = newKey.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!key || block.propertyMeta.some((property) => property.key === key))
      return;
    const defaults: Record<string, unknown> = {
      string: "",
      number: 0,
      boolean: false,
      select: "",
      array: [],
      action: { type: "exit", target: "default" },
      "state-memory": { key: "", value: "" },
      "block-trigger": { blockKey: "" },
      "block-state": { blockKey: "", state: "active" },
    };
    onChange({
      ...block,
      propertyMeta: [
        ...block.propertyMeta,
        { key, type: newType, value: defaults[newType] ?? "" },
      ],
    });
    setNewKey("");
  };
  return (
    <div className="grid gap-3 border-t pt-4">
      <h3 className="text-sm font-semibold">{tr("Typed properties")}</h3>
      {block.propertyMeta.map((property, index) => (
        <div
          key={`${property.key}:${index}`}
          className="grid gap-2 rounded border p-2"
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">
              {property.key}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
              {property.type}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${property.key}`}
              onClick={() => remove(index)}
            >
              <X />
            </Button>
          </div>
          <TypedProperty
            value={property.value}
            onChange={(next) => update(index, next)}
          />
        </div>
      ))}
      <div className="grid grid-cols-[1fr_132px_auto] gap-1">
        <Input
          value={newKey}
          onChange={(event) => setNewKey(event.target.value)}
          placeholder="property_key"
        />
        <Select
          value={newType}
          onValueChange={(value) => setNewType(value as FlowPropertyType)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[
              "string",
              "number",
              "boolean",
              "select",
              "array",
              "action",
              "state-memory",
              "block-trigger",
              "block-state",
            ].map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon"
          variant="outline"
          disabled={!newKey.trim()}
          onClick={add}
        >
          <Plus />
          <span className="sr-only">{tr("Add property")}</span>
        </Button>
      </div>
    </div>
  );
}

function TypedProperty({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { tr } = useFlowI18n();
  if (typeof value === "boolean")
    return (
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{tr("Boolean")}</span>
        <Switch checked={value} onCheckedChange={onChange} />
      </div>
    );
  if (typeof value === "number")
    return (
      <Input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    );
  if (typeof value === "string")
    return (
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    );
  return <JsonValueEditor value={value} onChange={onChange} />;
}

function JsonValueEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  useEffect(() => setText(JSON.stringify(value, null, 2)), [value]);
  return (
    <Textarea
      className="font-mono text-xs"
      rows={5}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        try {
          onChange(JSON.parse(event.target.value) as unknown);
        } catch {
          /* Retain draft text until JSON becomes valid. */
        }
      }}
    />
  );
}

function EditorCollection({
  title,
  onAdd,
  children,
}: {
  title: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const { tr } = useFlowI18n();
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h4>
        <Button variant="outline" size="icon" onClick={onAdd}>
          <Plus />
          <span className="sr-only">{tr("Add")}</span>
        </Button>
      </div>
      {children}
    </div>
  );
}
function CollectionItem({
  index,
  count,
  onMove,
  onRemove,
  children,
}: {
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const { t, tr } = useFlowI18n();
  return (
    <div className="grid gap-2 rounded-[var(--radius-sm)] border bg-background p-2">
      <div className="flex items-center gap-1">
        <span className="mr-auto text-xs font-medium">#{index + 1}</span>
        <Button
          variant="ghost"
          size="icon"
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp />
          <span className="sr-only">{tr("Move up")}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown />
          <span className="sr-only">{tr("Move down")}</span>
        </Button>
        <Button variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 />
          <span className="sr-only">{t("delete")}</span>
        </Button>
      </div>
      {children}
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded border px-2 py-2">
      <span className="text-xs">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
function DurationInput({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] uppercase text-muted-foreground">
        {label}
      </span>
      <Input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(event) =>
          onChange(Math.max(0, Math.min(max, Number(event.target.value))))
        }
      />
    </label>
  );
}
function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}
function array(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}
function optionLabels(value: unknown): string[] {
  return records(value)
    .map((option) => String(option.label ?? ""))
    .filter(Boolean);
}
function updateQuestionOptions(
  current: FlowSurveyQuestion["options"],
  labels: string[]
): Array<{ id: string; label: string }> {
  return labels.map((label, index) => ({
    id: current?.[index]?.id ?? crypto.randomUUID(),
    label,
  }));
}
function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
function replace<T>(items: T[], index: number, value: T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? value : item));
}
function move<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const current = next[index];
  const other = next[target];
  if (current === undefined || other === undefined) return items;
  next[index] = other;
  next[target] = current;
  return next;
}
