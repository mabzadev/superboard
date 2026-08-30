"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Clipboard,
  Copy,
  Maximize2,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { useTheme } from "next-themes";

import type {
  FlowBlock,
  FlowBlockType,
  FlowComponentDefinition,
  FlowGraph,
  FlowTranslation,
} from "@/api/flows/flowsService";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useFlowI18n } from "../i18n";
import {
  BlockCatalog,
  FLOW_BLOCK_DRAG_TYPE,
  FLOW_COMPONENT_DRAG_TYPE,
} from "./BlockCatalog";
import { FlowNode, type FlowNodeData } from "./FlowNode";
import {
  createBlock,
  createBlockFromDefinition,
  createPath,
  validateGraph,
} from "./graph";
import { InspectorPanel } from "./InspectorPanel";
import { useFlowHistory } from "./useFlowHistory";

const nodeTypes = { flowBlock: FlowNode };

export function FlowEditor(props: {
  initialGraph: FlowGraph;
  revision: number;
  readOnly?: boolean;
  locales?: string[];
  translations?: FlowTranslation[];
  components?: FlowComponentDefinition[];
  onTranslate?: (
    blockKey: string,
    propertyKey: string,
    locale: string,
    value: unknown
  ) => Promise<void>;
  onSave: (graph: FlowGraph, revision: number) => Promise<number>;
}) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}

function FlowEditorInner({
  initialGraph,
  revision,
  readOnly = false,
  locales = ["en", "fr"],
  translations = [],
  components = [],
  onTranslate,
  onSave,
}: {
  initialGraph: FlowGraph;
  revision: number;
  readOnly?: boolean;
  locales?: string[];
  translations?: FlowTranslation[];
  components?: FlowComponentDefinition[];
  onTranslate?: (
    blockKey: string,
    propertyKey: string,
    locale: string,
    value: unknown
  ) => Promise<void>;
  onSave: (graph: FlowGraph, revision: number) => Promise<number>;
}) {
  const { t, tr } = useFlowI18n();
  const { resolvedTheme } = useTheme();
  const { graph, update, undo, redo, canUndo, canRedo } =
    useFlowHistory(initialGraph);
  const flow = useReactFlow();
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedPathIds, setSelectedPathIds] = useState<string[]>([]);
  const [inspectorWidth, setInspectorWidth] = useState(360);
  const [saving, setSaving] = useState(false);
  const [savedRevision, setSavedRevision] = useState(revision);
  const [dirty, setDirty] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    screen: { x: number; y: number };
    flow: { x: number; y: number };
  } | null>(null);
  const clipboard = useRef<FlowBlock[]>([]);
  const validation = useMemo(() => validateGraph(graph), [graph]);
  const invalidBlockIds = useMemo(
    () =>
      new Set(
        validation.issues.flatMap((issue) =>
          issue.blockId ? [issue.blockId] : []
        )
      ),
    [validation]
  );

  const nodes = useMemo<Array<Node<FlowNodeData>>>(
    () =>
      graph.blocks.map((block) => ({
        id: block.id,
        type: "flowBlock",
        position: block.position,
        selected: selectedBlockId === block.id,
        data: { block, invalid: invalidBlockIds.has(block.id) },
      })),
    [graph.blocks, invalidBlockIds, selectedBlockId]
  );
  const edges = useMemo<Edge[]>(
    () =>
      graph.paths.map((path) => ({
        id: path.id,
        source: path.sourceBlockId,
        target: path.targetBlockId,
        sourceHandle: path.sourceExitNode,
        label: path.label ?? path.sourceExitNode,
        selected: selectedPathIds.includes(path.id),
        animated: Boolean(path.triggerOnly),
        style: path.triggerOnly ? { strokeDasharray: "5 5" } : undefined,
      })),
    [graph.paths, selectedPathIds]
  );
  const selectedBlock =
    graph.blocks.find((block) => block.id === selectedBlockId) ?? null;
  const selectedPath =
    graph.paths.find((path) => selectedPathIds.includes(path.id)) ?? null;

  const commit = useCallback(
    (next: FlowGraph | ((value: FlowGraph) => FlowGraph)) => {
      if (readOnly) return;
      update(next);
      setDirty(true);
    },
    [readOnly, update]
  );

  const addBlock = useCallback(
    (type: FlowBlockType, position?: { x: number; y: number }) => {
      const next = createBlock(
        type,
        position ??
          flow.screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          }),
        graph.blocks.length + 1
      );
      commit((current) => ({ ...current, blocks: [...current.blocks, next] }));
      setSelectedBlockId(next.id);
      setCatalogOpen(false);
    },
    [commit, flow, graph.blocks.length]
  );

  const addComponent = useCallback(
    (
      component: FlowComponentDefinition,
      position?: { x: number; y: number }
    ) => {
      const next = createBlockFromDefinition(
        component,
        position ??
          flow.screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          }),
        graph.blocks.length + 1
      );
      commit((current) => ({ ...current, blocks: [...current.blocks, next] }));
      setSelectedBlockId(next.id);
      setCatalogOpen(false);
    },
    [commit, flow, graph.blocks.length]
  );

  const deleteSelection = useCallback(() => {
    if (readOnly || (!selectedBlockId && selectedPathIds.length === 0)) return;
    commit((current) => ({
      ...current,
      blocks: selectedBlockId
        ? current.blocks.filter((block) => block.id !== selectedBlockId)
        : current.blocks,
      paths: current.paths.filter(
        (path) =>
          !selectedPathIds.includes(path.id) &&
          path.sourceBlockId !== selectedBlockId &&
          path.targetBlockId !== selectedBlockId
      ),
    }));
    setSelectedBlockId(null);
    setSelectedPathIds([]);
  }, [commit, readOnly, selectedBlockId, selectedPathIds]);

  const copySelection = useCallback(() => {
    if (!selectedBlockId) return;
    const selected = graph.blocks.filter(
      (block) => block.id === selectedBlockId
    );
    clipboard.current = structuredClone(selected);
  }, [graph.blocks, selectedBlockId]);

  const pasteSelection = useCallback(() => {
    if (readOnly || clipboard.current.length === 0) return;
    const copies = clipboard.current.map((block, index) => ({
      ...structuredClone(block),
      id: crypto.randomUUID(),
      key: `${block.key}_copy_${graph.blocks.length + index + 1}`,
      name: `${block.name} copy`,
      position: { x: block.position.x + 40, y: block.position.y + 40 },
    }));
    commit((current) => ({
      ...current,
      blocks: [...current.blocks, ...copies],
    }));
    setSelectedBlockId(copies[0]?.id ?? null);
  }, [commit, graph.blocks.length, readOnly]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, [contenteditable=true]");
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (modifier && event.key.toLowerCase() === "c" && !typing) {
        event.preventDefault();
        copySelection();
      } else if (modifier && event.key.toLowerCase() === "v" && !typing) {
        event.preventDefault();
        pasteSelection();
      } else if (
        (event.key === "Backspace" || event.key === "Delete") &&
        !typing
      ) {
        event.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [copySelection, deleteSelection, pasteSelection, redo, undo]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (readOnly) return;
      const positionChanges = new Map(
        changes
          .filter(
            (change): change is Extract<NodeChange, { type: "position" }> =>
              change.type === "position" && Boolean(change.position)
          )
          .map((change) => [change.id, change.position!])
      );
      const selection = changes.find(
        (change): change is Extract<NodeChange, { type: "select" }> =>
          change.type === "select" && change.selected
      );
      if (selection) {
        setSelectedBlockId(selection.id);
        setSelectedPathIds([]);
      }
      if (positionChanges.size > 0) {
        commit((current) => ({
          ...current,
          blocks: current.blocks.map((block) =>
            positionChanges.has(block.id)
              ? { ...block, position: positionChanges.get(block.id)! }
              : block
          ),
        }));
      }
      const removed = changes
        .filter((change) => change.type === "remove")
        .map((change) => change.id);
      if (removed.length) {
        commit((current) => ({
          ...current,
          blocks: current.blocks.filter((block) => !removed.includes(block.id)),
          paths: current.paths.filter(
            (path) =>
              !removed.includes(path.sourceBlockId) &&
              !removed.includes(path.targetBlockId)
          ),
        }));
      }
    },
    [commit, readOnly]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const selected = changes
        .filter(
          (change): change is Extract<EdgeChange, { type: "select" }> =>
            change.type === "select" && change.selected
        )
        .map((change) => change.id);
      if (selected.length) {
        setSelectedPathIds(selected);
        setSelectedBlockId(null);
      }
      const removed = changes
        .filter((change) => change.type === "remove")
        .map((change) => change.id);
      if (removed.length && !readOnly) {
        commit((current) => ({
          ...current,
          paths: current.paths.filter((path) => !removed.includes(path.id)),
        }));
      }
    },
    [commit, readOnly]
  );

  const connect = useCallback(
    (connection: Connection) => {
      if (readOnly || !connection.source || !connection.target) return;
      const path = createPath(
        connection.source,
        connection.target,
        connection.sourceHandle ?? "default"
      );
      commit((current) => ({ ...current, paths: [...current.paths, path] }));
    },
    [commit, readOnly]
  );

  const save = async () => {
    if (readOnly || saving || !validation.valid) return;
    setSaving(true);
    try {
      const nextRevision = await onSave(graph, savedRevision);
      setSavedRevision(nextRevision);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-[var(--radius)] border bg-card">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-1 border-b bg-card px-2 py-1.5">
          <Popover open={catalogOpen} onOpenChange={setCatalogOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" disabled={readOnly}>
                <Plus /> {t("addBlock")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <BlockCatalog
                components={components}
                onAdd={(type) => addBlock(type)}
                onAddComponent={(component) => addComponent(component)}
              />
            </PopoverContent>
          </Popover>
          <Separator orientation="vertical" className="mx-1 h-6" />
          <ToolbarButton
            label={t("undo")}
            icon={Undo2}
            disabled={readOnly || !canUndo}
            onClick={() => {
              undo();
              setDirty(true);
            }}
          />
          <ToolbarButton
            label={t("redo")}
            icon={Redo2}
            disabled={readOnly || !canRedo}
            onClick={() => {
              redo();
              setDirty(true);
            }}
          />
          <ToolbarButton
            label={t("copy")}
            icon={Copy}
            disabled={!selectedBlockId}
            onClick={copySelection}
          />
          <ToolbarButton
            label={t("paste")}
            icon={Clipboard}
            disabled={readOnly || clipboard.current.length === 0}
            onClick={pasteSelection}
          />
          <ToolbarButton
            label={t("delete")}
            icon={Trash2}
            disabled={
              readOnly || (!selectedBlockId && selectedPathIds.length === 0)
            }
            onClick={deleteSelection}
          />
          <ToolbarButton
            label={t("fitView")}
            icon={Maximize2}
            onClick={() => void flow.fitView({ duration: 240, padding: 0.2 })}
          />
          <div className="ml-auto flex items-center gap-2 pl-2">
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs",
                validation.valid
                  ? "text-green-700 dark:text-green-300"
                  : "text-destructive"
              )}
              title={validation.issues
                .map((issue) => tr(issue.message))
                .join("\n")}
            >
              {validation.valid ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <XCircle className="size-4" />
              )}
              <span className="hidden lg:inline">
                {validation.valid
                  ? t("validGraph")
                  : `${validation.issues.length} ${t("issues")}`}
              </span>
            </span>
            {!readOnly && (
              <Button
                size="sm"
                disabled={!dirty || !validation.valid || saving}
                onClick={() => void save()}
              >
                <Save /> {saving ? t("saving") : t("save")}
              </Button>
            )}
          </div>
        </div>
        <div
          className="relative min-h-0 flex-1 bg-[var(--color-main)]"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const componentId = event.dataTransfer.getData(
              FLOW_COMPONENT_DRAG_TYPE
            );
            const component = components.find(
              (item) => item.id === componentId
            );
            const position = flow.screenToFlowPosition({
              x: event.clientX,
              y: event.clientY,
            });
            if (component) addComponent(component, position);
            else {
              const type = event.dataTransfer.getData(
                FLOW_BLOCK_DRAG_TYPE
              ) as FlowBlockType;
              if (!type) return;
              addBlock(type, position);
            }
          }}
        >
          <ReactFlow
            colorMode={resolvedTheme === "dark" ? "dark" : "light"}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={connect}
            onPaneClick={() => {
              setSelectedBlockId(null);
              setSelectedPathIds([]);
              setContextMenu(null);
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault();
              const pane = event.currentTarget as Element | null;
              const bounds = pane?.getBoundingClientRect() ?? {
                left: 0,
                top: 0,
                width: window.innerWidth,
                height: window.innerHeight,
              };
              setContextMenu({
                screen: {
                  x: Math.min(event.clientX - bounds.left, bounds.width - 330),
                  y: Math.min(event.clientY - bounds.top, bounds.height - 420),
                },
                flow: flow.screenToFlowPosition({
                  x: event.clientX,
                  y: event.clientY,
                }),
              });
            }}
            onNodeClick={(_: React.MouseEvent, node: Node<FlowNodeData>) => {
              setSelectedBlockId(node.id);
              setSelectedPathIds([]);
            }}
            onEdgeClick={(_: React.MouseEvent, edge: Edge) => {
              setSelectedPathIds([edge.id]);
              setSelectedBlockId(null);
            }}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable
            deleteKeyCode={null}
            fitView
            fitViewOptions={{ padding: 0.22 }}
            minZoom={0.15}
            maxZoom={2.5}
            snapToGrid
            snapGrid={[16, 16]}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={16}
              size={1.3}
              color="var(--color-border)"
            />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor="var(--color-muted)"
              maskColor="color-mix(in srgb, var(--color-main) 72%, transparent)"
            />
          </ReactFlow>
          {contextMenu && !readOnly && (
            <div
              className="absolute z-20 rounded-[var(--radius)] border bg-popover shadow-lg"
              style={{
                left: Math.max(8, contextMenu.screen.x),
                top: Math.max(8, contextMenu.screen.y),
              }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <BlockCatalog
                components={components}
                onAdd={(type) => {
                  addBlock(type, contextMenu.flow);
                  setContextMenu(null);
                }}
                onAddComponent={(component) => {
                  addComponent(component, contextMenu.flow);
                  setContextMenu(null);
                }}
              />
            </div>
          )}
          {readOnly && (
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border bg-card/95 px-3 py-1 text-xs font-medium">
              {tr("Read-only published version")}
            </div>
          )}
        </div>
      </div>
      <InspectorPanel
        block={selectedBlock}
        path={selectedPath}
        width={inspectorWidth}
        onResize={setInspectorWidth}
        onChange={(block) =>
          commit((current) => ({
            ...current,
            blocks: current.blocks.map((item) =>
              item.id === block.id ? block : item
            ),
          }))
        }
        onPathChange={(path) =>
          commit((current) => ({
            ...current,
            paths: current.paths.map((item) =>
              item.id === path.id ? path : item
            ),
          }))
        }
        onDelete={deleteSelection}
        locales={locales}
        translations={translations}
        components={components}
        onTranslate={onTranslate}
      />
    </div>
  );
}

function ToolbarButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={disabled}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <Icon />
    </Button>
  );
}
