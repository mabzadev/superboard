"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CheckCircle2,
  Copy,
  GripVertical,
  MonitorSmartphone,
  Plus,
  Redo2,
  Smartphone,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createBlock,
  createScreen,
  uniqueId,
  validateExperienceDocument,
} from "./model";
import type {
  EditorBlockType,
  ExperienceBlock,
  ExperienceDocument,
  ExperienceKind,
  ExperienceScreen,
} from "./types";
import { useEditorHistory } from "./useEditorHistory";

const BLOCKS: Array<{ type: EditorBlockType; label: string }> = [
  { type: "heading", label: "Heading" },
  { type: "text", label: "Text" },
  { type: "image", label: "Image" },
  { type: "benefits", label: "Benefits" },
  { type: "product", label: "Products" },
  { type: "button", label: "Button" },
  { type: "legal", label: "Legal" },
  { type: "spacer", label: "Spacer" },
  { type: "close", label: "Close" },
];

export function ExperienceEditor({
  kind,
  initialDocument,
  onChange,
}: {
  kind: ExperienceKind;
  initialDocument: ExperienceDocument;
  onChange?: (document: ExperienceDocument, valid: boolean) => void;
}) {
  const history = useEditorHistory(initialDocument);
  const [selectedScreenId, setSelectedScreenId] = useState(
    initialDocument.screens[0]?.id ?? ""
  );
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [preview, setPreview] = useState<"editor" | "preview">("editor");
  const issues = useMemo(
    () => validateExperienceDocument(history.value),
    [history.value]
  );
  const screen =
    history.value.screens.find(({ id }) => id === selectedScreenId) ??
    history.value.screens[0];
  const selectedBlock = screen?.blocks.find(({ id }) => id === selectedBlockId);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    onChange?.(history.value, issues.length === 0);
  }, [history.value, issues.length, onChange]);

  const updateScreen = (
    updater: (value: ExperienceScreen) => ExperienceScreen
  ) => {
    if (!screen) return;
    history.set((document) => ({
      ...document,
      screens: document.screens.map((item) =>
        item.id === screen.id ? updater(item) : item
      ),
    }));
  };

  const updateBlock = (
    updater: (value: ExperienceBlock) => ExperienceBlock
  ) => {
    if (!selectedBlock) return;
    updateScreen((value) => ({
      ...value,
      blocks: value.blocks.map((block) =>
        block.id === selectedBlock.id ? updater(block) : block
      ),
    }));
  };

  const addBlock = (type: EditorBlockType) => {
    const block = createBlock(type);
    updateScreen((value) => ({ ...value, blocks: [...value.blocks, block] }));
    setSelectedBlockId(block.id);
  };

  const addScreen = () => {
    const next = createScreen(`Screen ${history.value.screens.length + 1}`);
    history.set((document) => ({
      ...document,
      screens: [...document.screens, next],
    }));
    setSelectedScreenId(next.id);
    setSelectedBlockId(null);
  };

  const duplicateScreen = () => {
    if (!screen) return;
    const copy: ExperienceScreen = {
      ...structuredClone(screen),
      id: uniqueId("screen"),
      name: `${screen.name} copy`,
      blocks: screen.blocks.map((block) => ({
        ...structuredClone(block),
        id: uniqueId(block.type),
      })),
    };
    history.set((document) => ({
      ...document,
      screens: [...document.screens, copy],
    }));
    setSelectedScreenId(copy.id);
  };

  const deleteScreen = () => {
    if (!screen || history.value.screens.length === 1) return;
    const index = history.value.screens.findIndex(({ id }) => id === screen.id);
    const screens = history.value.screens.filter(({ id }) => id !== screen.id);
    history.set({ ...history.value, screens });
    setSelectedScreenId(screens[Math.max(0, index - 1)]!.id);
    setSelectedBlockId(null);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId.startsWith("screen:") && overId.startsWith("screen:")) {
      const activeScreen = activeId.slice(7);
      const overScreen = overId.slice(7);
      history.set((document) => {
        const from = document.screens.findIndex(
          ({ id }) => id === activeScreen
        );
        const to = document.screens.findIndex(({ id }) => id === overScreen);
        return { ...document, screens: arrayMove(document.screens, from, to) };
      });
      return;
    }
    if (
      activeId.startsWith("block:") &&
      overId.startsWith("block:") &&
      screen
    ) {
      const activeBlock = activeId.split(":").at(-1);
      const overBlock = overId.split(":").at(-1);
      updateScreen((value) => {
        const from = value.blocks.findIndex(({ id }) => id === activeBlock);
        const to = value.blocks.findIndex(({ id }) => id === overBlock);
        return { ...value, blocks: arrayMove(value.blocks, from, to) };
      });
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-4" data-testid="experience-editor">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={!history.canUndo}
              onClick={history.undo}
              aria-label="Undo"
            >
              <Undo2 />
              Undo
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!history.canRedo}
              onClick={history.redo}
              aria-label="Redo"
            >
              <Redo2 />
              Redo
            </Button>
          </div>
          <div className="flex items-center gap-1 rounded-md border bg-background p-1">
            <Button
              size="sm"
              variant={preview === "editor" ? "default" : "ghost"}
              onClick={() => setPreview("editor")}
            >
              <MonitorSmartphone />
              Editor
            </Button>
            <Button
              size="sm"
              variant={preview === "preview" ? "default" : "ghost"}
              onClick={() => setPreview("preview")}
            >
              <Smartphone />
              Preview
            </Button>
          </div>
          <div
            className={cn(
              "flex items-center gap-1 text-xs",
              issues.length ? "text-destructive" : "text-emerald-600"
            )}
          >
            <CheckCircle2 className="size-4" />
            {issues.length
              ? `${issues.length} issue${issues.length === 1 ? "" : "s"}`
              : "Ready to save"}
          </div>
        </div>

        {kind === "onboarding" && (
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">Screens</p>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={addScreen}>
                  <Plus />
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={duplicateScreen}
                  disabled={!screen}
                >
                  <Copy />
                  Duplicate
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={deleteScreen}
                  disabled={history.value.screens.length === 1}
                  aria-label="Delete screen"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            <SortableContext
              items={history.value.screens.map(({ id }) => `screen:${id}`)}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex gap-2 overflow-x-auto pb-1">
                {history.value.screens.map((item, index) => (
                  <SortableScreen
                    key={item.id}
                    screen={item}
                    index={index}
                    selected={item.id === screen?.id}
                    onSelect={() => {
                      setSelectedScreenId(item.id);
                      setSelectedBlockId(null);
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </div>
        )}

        {preview === "preview" ? (
          <MobilePreview document={history.value} screen={screen} />
        ) : (
          <div className="grid gap-4 2xl:grid-cols-[180px_minmax(320px,1fr)_300px]">
            <aside className="rounded-lg border p-3">
              <p className="mb-3 text-sm font-medium">Blocks</p>
              <div className="grid grid-cols-2 gap-2 2xl:grid-cols-1">
                {BLOCKS.filter(
                  ({ type }) => kind === "onboarding" || type !== "benefits"
                ).map(({ type, label }) => (
                  <Button
                    key={type}
                    size="sm"
                    variant="outline"
                    className="justify-start"
                    onClick={() => addBlock(type)}
                  >
                    <Plus />
                    {label}
                  </Button>
                ))}
              </div>
            </aside>

            <section className="min-h-[520px] rounded-lg border bg-muted/20 p-3">
              {screen && (
                <>
                  {kind === "onboarding" && (
                    <div className="mb-3 space-y-2">
                      <div className="grid gap-2 md:grid-cols-2">
                        <Input
                          aria-label="Screen name"
                          value={screen.name}
                          onChange={(event) =>
                            updateScreen((value) => ({
                              ...value,
                              name: event.target.value,
                            }))
                          }
                        />
                        <select
                          aria-label="Next screen"
                          className="h-9 rounded-md border bg-background px-3 text-sm"
                          value={screen.next_screen_id ?? ""}
                          onChange={(event) =>
                            updateScreen((value) => ({
                              ...value,
                              next_screen_id: event.target.value || null,
                            }))
                          }
                        >
                          <option value="">Finish flow</option>
                          {history.value.screens
                            .filter(({ id }) => id !== screen.id)
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                Continue to {item.name}
                              </option>
                            ))}
                        </select>
                      </div>
                      <ScreenConditionsEditor
                        screen={screen}
                        onChange={updateScreen}
                      />
                    </div>
                  )}
                  <SortableContext
                    items={screen.blocks.map(
                      ({ id }) => `block:${screen.id}:${id}`
                    )}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {screen.blocks.map((block) => (
                        <SortableBlock
                          key={block.id}
                          block={block}
                          screenId={screen.id}
                          selected={block.id === selectedBlockId}
                          onSelect={() => setSelectedBlockId(block.id)}
                          onDelete={() => {
                            updateScreen((value) => ({
                              ...value,
                              blocks: value.blocks.filter(
                                ({ id }) => id !== block.id
                              ),
                            }));
                            setSelectedBlockId(null);
                          }}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </>
              )}
            </section>

            <aside className="space-y-4 rounded-lg border p-3">
              {selectedBlock ? (
                <BlockInspector block={selectedBlock} onChange={updateBlock} />
              ) : (
                <ThemeInspector
                  document={history.value}
                  onChange={history.set}
                />
              )}
            </aside>
          </div>
        )}

        {issues.length > 0 && (
          <div
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3"
            role="alert"
          >
            <p className="text-sm font-medium text-destructive">
              Fix before saving
            </p>
            <ul className="mt-1 list-disc pl-5 text-xs text-destructive">
              {issues.map((issue) => (
                <li key={`${issue.path}:${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </DndContext>
  );
}

function SortableScreen({
  screen,
  index,
  selected,
  onSelect,
}: {
  screen: ExperienceScreen;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const sortable = useSortable({ id: `screen:${screen.id}` });
  return (
    <button
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      {...sortable.attributes}
      {...sortable.listeners}
      onClick={onSelect}
      className={cn(
        "flex min-w-36 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm",
        selected && "border-primary bg-primary/5"
      )}
    >
      <GripVertical className="size-4 text-muted-foreground" />
      <span>
        <b className="block">
          {index + 1}. {screen.name}
        </b>
        <span className="text-xs text-muted-foreground">
          {screen.blocks.length} blocks
        </span>
      </span>
    </button>
  );
}

function SortableBlock({
  block,
  screenId,
  selected,
  onSelect,
  onDelete,
}: {
  block: ExperienceBlock;
  screenId: string;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const sortable = useSortable({ id: `block:${screenId}:${block.id}` });
  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cn(
        "group flex items-center gap-2 rounded-md border bg-background p-2",
        selected && "border-primary ring-2 ring-primary/10"
      )}
    >
      <button
        {...sortable.attributes}
        {...sortable.listeners}
        aria-label={`Move ${block.type}`}
        className="cursor-grab rounded p-1 text-muted-foreground"
      >
        <GripVertical className="size-4" />
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={onSelect}>
        <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {block.type}
        </span>
        <span className="block truncate text-sm">{blockSummary(block)}</span>
      </button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Delete ${block.type}`}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function BlockInspector({
  block,
  onChange,
}: {
  block: ExperienceBlock;
  onChange: (updater: (block: ExperienceBlock) => ExperienceBlock) => void;
}) {
  const update = (key: string, value: unknown) =>
    onChange((current) => ({
      ...current,
      props: { ...current.props, [key]: value },
    }));
  const text = typeof block.props.text === "string" ? block.props.text : "";
  const url = typeof block.props.url === "string" ? block.props.url : "";
  const action =
    typeof block.props.action === "string" ? block.props.action : "next";
  return (
    <>
      <div>
        <p className="text-sm font-medium capitalize">{block.type} settings</p>
        <p className="text-xs text-muted-foreground">
          Changes are saved in the next immutable draft.
        </p>
      </div>
      {["heading", "text", "button", "legal"].includes(block.type) && (
        <label className="block space-y-1 text-xs">
          Text
          <textarea
            className="min-h-24 w-full rounded-md border bg-background p-2 text-sm"
            value={text}
            onChange={(event) => update("text", event.target.value)}
          />
        </label>
      )}
      {block.type === "image" && (
        <>
          <label className="block space-y-1 text-xs">
            Image URL
            <Input
              value={url}
              onChange={(event) => update("url", event.target.value)}
              placeholder="https://…"
            />
          </label>
          <label className="block space-y-1 text-xs">
            Alternative text
            <Input
              value={String(block.props.alt ?? "")}
              onChange={(event) => update("alt", event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs">
            Aspect ratio
            <select
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={String(block.props.aspect_ratio ?? "16/9")}
              onChange={(event) => update("aspect_ratio", event.target.value)}
            >
              <option value="16/9">16:9</option>
              <option value="4/3">4:3</option>
              <option value="1/1">Square</option>
              <option value="9/16">Portrait</option>
            </select>
          </label>
        </>
      )}
      {["heading", "text", "legal"].includes(block.type) && (
        <label className="block space-y-1 text-xs">
          Alignment
          <select
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={String(block.props.align ?? "center")}
            onChange={(event) => update("align", event.target.value)}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </label>
      )}
      {block.type === "button" && (
        <label className="block space-y-1 text-xs">
          Action
          <select
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={action}
            onChange={(event) => update("action", event.target.value)}
          >
            <option value="next">Next screen</option>
            <option value="purchase">Purchase</option>
            <option value="restore">Restore</option>
            <option value="dismiss">Dismiss</option>
            <option value="complete">Complete</option>
          </select>
        </label>
      )}
      {block.type === "spacer" && (
        <label className="block space-y-1 text-xs">
          Height
          <Input
            type="number"
            min={4}
            max={200}
            value={Number(block.props.height ?? 24)}
            onChange={(event) => update("height", Number(event.target.value))}
          />
        </label>
      )}
      {block.type === "product" && (
        <>
          <label className="block space-y-1 text-xs">
            Offering identifier
            <Input
              value={String(block.props.offering_identifier ?? "default")}
              onChange={(event) =>
                update("offering_identifier", event.target.value)
              }
              placeholder="default"
            />
          </label>
          <label className="block space-y-1 text-xs">
            Package identifiers
            <Input
              value={
                Array.isArray(block.props.package_identifiers)
                  ? block.props.package_identifiers.join(",")
                  : ""
              }
              onChange={(event) =>
                update(
                  "package_identifiers",
                  event.target.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean)
                )
              }
              placeholder="monthly,annual"
            />
          </label>
          <label className="block space-y-1 text-xs">
            Layout
            <select
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={String(block.props.style ?? "cards")}
              onChange={(event) => update("style", event.target.value)}
            >
              <option value="cards">Cards</option>
              <option value="list">List</option>
              <option value="compact">Compact</option>
            </select>
          </label>
        </>
      )}
      {block.type === "close" && (
        <label className="block space-y-1 text-xs">
          Accessibility label
          <Input
            value={String(block.props.accessibility_label ?? "Close")}
            onChange={(event) =>
              update("accessibility_label", event.target.value)
            }
          />
        </label>
      )}
      {block.type === "benefits" && (
        <label className="block space-y-1 text-xs">
          Benefits
          <textarea
            className="min-h-28 w-full rounded-md border bg-background p-2 text-sm"
            value={
              Array.isArray(block.props.items)
                ? block.props.items.join("\n")
                : ""
            }
            onChange={(event) =>
              update("items", event.target.value.split("\n").filter(Boolean))
            }
          />
        </label>
      )}
    </>
  );
}

function ScreenConditionsEditor({
  screen,
  onChange,
}: {
  screen: ExperienceScreen;
  onChange: (updater: (screen: ExperienceScreen) => ExperienceScreen) => void;
}) {
  const conditions = screen.conditions ?? {};
  const update = (key: string, value: string) =>
    onChange((current) => {
      const next = { ...(current.conditions ?? {}) };
      if (value.trim()) next[key] = value.trim();
      else delete next[key];
      return {
        ...current,
        conditions: Object.keys(next).length ? next : undefined,
      };
    });
  return (
    <details className="rounded-md border bg-background p-2">
      <summary className="cursor-pointer text-xs font-medium">
        Screen display conditions
      </summary>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <label className="space-y-1 text-xs">
          Platform
          <select
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={
              typeof conditions.platform === "string" ? conditions.platform : ""
            }
            onChange={(event) => update("platform", event.target.value)}
          >
            <option value="">Any platform</option>
            <option value="ios">iOS</option>
            <option value="android">Android</option>
            <option value="web">Web</option>
          </select>
        </label>
        <label className="space-y-1 text-xs">
          Locale
          <Input
            value={
              typeof conditions.locale === "string" ? conditions.locale : ""
            }
            onChange={(event) => update("locale", event.target.value)}
            placeholder="fr-FR"
          />
        </label>
        <label className="space-y-1 text-xs">
          Minimum app version
          <Input
            value={
              typeof conditions.min_app_version === "string"
                ? conditions.min_app_version
                : ""
            }
            onChange={(event) => update("min_app_version", event.target.value)}
            placeholder="2.4.0"
          />
        </label>
      </div>
    </details>
  );
}

function ThemeInspector({
  document,
  onChange,
}: {
  document: ExperienceDocument;
  onChange: (
    value:
      | ExperienceDocument
      | ((value: ExperienceDocument) => ExperienceDocument)
  ) => void;
}) {
  const update = (
    key: keyof ExperienceDocument["theme"],
    value: string | number
  ) =>
    onChange((current) => ({
      ...current,
      theme: { ...current.theme, [key]: value },
    }));
  return (
    <>
      <div>
        <p className="text-sm font-medium">Theme</p>
        <p className="text-xs text-muted-foreground">
          Select a block to edit its content.
        </p>
      </div>
      {(["accent_color", "background_color", "text_color"] as const).map(
        (key) => (
          <label
            key={key}
            className="flex items-center justify-between gap-2 text-xs capitalize"
          >
            {key.replaceAll("_", " ")}
            <input
              type="color"
              value={document.theme[key]}
              onChange={(event) => update(key, event.target.value)}
            />
          </label>
        )
      )}
      <label className="block space-y-1 text-xs">
        Font family
        <Input
          value={document.theme.font_family}
          onChange={(event) => update("font_family", event.target.value)}
        />
      </label>
      <label className="block space-y-1 text-xs">
        Corner radius
        <Input
          type="number"
          min={0}
          max={40}
          value={document.theme.corner_radius}
          onChange={(event) =>
            update("corner_radius", Number(event.target.value))
          }
        />
      </label>
    </>
  );
}

function MobilePreview({
  document,
  screen,
}: {
  document: ExperienceDocument;
  screen?: ExperienceScreen;
}) {
  const theme = document.theme;
  return (
    <div className="flex min-h-[620px] items-center justify-center rounded-xl border bg-muted/30 p-6">
      <div
        className="relative h-[600px] w-[310px] overflow-hidden rounded-[42px] border-[8px] border-slate-900 shadow-xl"
        style={{
          background: theme.background_color,
          color: theme.text_color,
          fontFamily: theme.font_family,
        }}
      >
        <div className="mx-auto mt-2 h-5 w-24 rounded-full bg-slate-900" />
        <div className="flex h-[550px] flex-col gap-3 overflow-auto p-5">
          {screen?.blocks.map((block) => (
            <PreviewBlock
              key={block.id}
              block={block}
              accent={theme.accent_color}
              radius={theme.corner_radius}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewBlock({
  block,
  accent,
  radius,
}: {
  block: ExperienceBlock;
  accent: string;
  radius: number;
}) {
  if (block.type === "heading")
    return (
      <h2 className="text-center text-2xl font-bold">
        {String(block.props.text ?? "")}
      </h2>
    );
  if (["text", "legal"].includes(block.type))
    return (
      <p
        className={cn(
          "text-center",
          block.type === "legal" && "text-xs opacity-70"
        )}
      >
        {String(block.props.text ?? "")}
      </p>
    );
  if (block.type === "image")
    return block.props.url ? (
      <Image
        src={String(block.props.url)}
        alt={String(block.props.alt ?? "")}
        width={270}
        height={152}
        unoptimized
        className="w-full object-cover"
        style={{ borderRadius: radius }}
      />
    ) : (
      <div
        className="grid h-32 place-items-center border border-dashed text-xs opacity-60"
        style={{ borderRadius: radius }}
      >
        Image
      </div>
    );
  if (block.type === "benefits")
    return (
      <ul className="space-y-2">
        {(Array.isArray(block.props.items) ? block.props.items : []).map(
          (item) => (
            <li key={String(item)}>✓ {String(item)}</li>
          )
        )}
      </ul>
    );
  if (block.type === "product")
    return (
      <div className="rounded-xl border p-3">
        <b>Premium</b>
        <span className="float-right">$9.99</span>
        <p className="text-xs opacity-70">Best value</p>
      </div>
    );
  if (block.type === "button")
    return (
      <button
        className="w-full px-4 py-3 font-medium text-white"
        style={{ background: accent, borderRadius: radius }}
      >
        {String(block.props.text ?? "Continue")}
      </button>
    );
  if (block.type === "close")
    return (
      <button className="absolute right-4 top-10 grid size-8 place-items-center rounded-full bg-black/10">
        ×
      </button>
    );
  if (block.type === "spacer")
    return <div style={{ height: Number(block.props.height ?? 24) }} />;
  return null;
}

function blockSummary(block: ExperienceBlock) {
  if (typeof block.props.text === "string") return block.props.text;
  if (block.type === "image")
    return String(block.props.url || "No image selected");
  if (block.type === "benefits")
    return `${Array.isArray(block.props.items) ? block.props.items.length : 0} benefits`;
  if (block.type === "spacer") return `${Number(block.props.height ?? 24)}px`;
  return block.type === "product"
    ? "Active offering packages"
    : "Configure this block";
}
