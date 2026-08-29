"use client";

import { memo } from "react";
import {
  CircleStop,
  Clock3,
  Component,
  FileText,
  Filter,
  Flag,
  GitBranch,
  ListChecks,
  MessageSquareText,
  MousePointerClick,
  Play,
  Route,
  Split,
} from "lucide-react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { FlowBlock, FlowBlockType } from "@/api/flows/flowsService";
import { cn } from "@/lib/utils";

export type FlowNodeData = Record<string, unknown> & {
  block: FlowBlock;
  invalid: boolean;
};

const ICONS: Record<
  FlowBlockType,
  React.ComponentType<{ className?: string }>
> = {
  start: Play,
  "manual-start": MousePointerClick,
  component: Component,
  "tour-component": Route,
  survey: MessageSquareText,
  tour: Flag,
  filter: Filter,
  "workflow-trigger": GitBranch,
  delay: Clock3,
  note: FileText,
  "traffic-split": Split,
  end: CircleStop,
};

export const FlowNode = memo(function FlowNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const { block, invalid } = nodeData;
  const Icon = ICONS[block.type] ?? ListChecks;
  const isStart = block.type === "start" || block.type === "manual-start";
  const isEnd = block.type === "end";
  const isNote = block.type === "note";

  return (
    <article
      className={cn(
        "flow-node min-w-52 rounded-[var(--radius)] border bg-card text-card-foreground",
        selected && "border-foreground ring-2 ring-[var(--color-focus)]/70",
        invalid && "border-destructive",
        isNote && "border-amber-500/40 bg-amber-50 dark:bg-amber-950/30"
      )}
      aria-label={`${block.name}, ${block.type}`}
    >
      {!isStart && !isNote && (
        <Handle
          type="target"
          position={Position.Left}
          className="!size-3 !border-2 !border-card !bg-foreground"
        />
      )}
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <span className="rounded border bg-muted p-1.5">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{block.name}</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {block.key}
          </p>
        </div>
      </header>
      <div className="px-3 py-2 text-xs text-muted-foreground">
        <p className="line-clamp-2">
          {block.description || block.type.replaceAll("-", " ")}
        </p>
      </div>
      {!isEnd && !isNote && (
        <>
          {(block.exitNodes.length ? block.exitNodes : ["default"]).map(
            (exitNode, index, exits) => (
              <Handle
                key={exitNode}
                type="source"
                position={Position.Right}
                id={exitNode}
                title={exitNode}
                style={{
                  top: `${((index + 1) / (exits.length + 1)) * 100}%`,
                }}
                className="!size-3 !border-2 !border-card !bg-foreground"
              />
            )
          )}
        </>
      )}
    </article>
  );
});
