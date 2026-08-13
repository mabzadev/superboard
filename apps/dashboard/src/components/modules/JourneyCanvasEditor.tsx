"use client";

import { useMemo, useState } from "react";
import {
  Clock3,
  GitBranch,
  LogOut,
  Mail,
  PencilLine,
  Plus,
  Trash2,
  UserRoundCog,
  Webhook,
} from "lucide-react";
import type {
  EmailTemplate,
  JourneyCondition,
  JourneyDefinition,
  JourneyNode,
  MarketingChannelConnector,
} from "@/api/marketing/marketingService";
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
import { Label } from "@/components/ui/label";

type JourneyNodeType = JourneyNode["type"];

const nodeTypes: Array<{
  type: JourneyNodeType;
  label: string;
  description: string;
  icon: typeof Mail;
}> = [
  {
    type: "email",
    label: "Email",
    description: "Send a template through an approved sender",
    icon: Mail,
  },
  {
    type: "channel",
    label: "Channel",
    description: "Webhook, SMS, push, WhatsApp or Slack",
    icon: Webhook,
  },
  {
    type: "delay",
    label: "Delay",
    description: "Wait before continuing",
    icon: Clock3,
  },
  {
    type: "branch",
    label: "Branch",
    description: "Split by subscriber or event data",
    icon: GitBranch,
  },
  {
    type: "update_attribute",
    label: "Update data",
    description: "Write subscriber attributes",
    icon: UserRoundCog,
  },
  {
    type: "exit",
    label: "Exit",
    description: "Finish the journey",
    icon: LogOut,
  },
];

export function JourneyCanvasEditor({
  value,
  onChange,
  templates,
  connectors,
}: {
  value: JourneyDefinition;
  onChange: (value: JourneyDefinition) => void;
  templates: EmailTemplate[];
  connectors: MarketingChannelConnector[];
}) {
  const [selectedId, setSelectedId] = useState(value.start_node_id);
  const selected = value.nodes.find((node) => node.id === selectedId) ?? null;
  const ordered = useMemo(() => layoutNodes(value), [value]);

  const addNode = (type: JourneyNodeType) => {
    const id = `${type}-${crypto.randomUUID().slice(0, 8)}`;
    const node = defaultNode(type, id, templates, connectors);
    const firstExit = value.nodes.find(
      (candidate) => candidate.type === "exit"
    );
    const destination = firstExit?.id ?? null;
    const terminalEdges = destination
      ? value.edges.filter((edge) => edge.to === destination)
      : [];
    const sourceEdge = terminalEdges.find((edge) => edge.outcome === "default");
    const source = sourceEdge?.from;
    let edges = value.edges;
    if (sourceEdge) {
      edges = edges.map((edge) =>
        edge === sourceEdge ? { ...edge, to: id } : edge
      );
    }
    if (type === "branch" && destination) {
      edges = [
        ...edges,
        { from: id, to: destination, outcome: "true" as const },
        { from: id, to: destination, outcome: "false" as const },
      ];
    } else if (type !== "exit" && destination) {
      edges = [
        ...edges,
        { from: id, to: destination, outcome: "default" as const },
      ];
    }
    const nodes = firstExit
      ? value.nodes.flatMap((candidate) =>
          candidate.id === firstExit.id ? [node, candidate] : [candidate]
        )
      : [...value.nodes, node];
    onChange({
      start_node_id:
        value.nodes.length === 0 ||
        (value.start_node_id === destination && !source)
          ? id
          : value.start_node_id,
      nodes,
      edges,
    });
    setSelectedId(id);
  };

  const patchNode = (patch: Partial<JourneyNode>) => {
    if (!selected) return;
    onChange({
      ...value,
      nodes: value.nodes.map((node) =>
        node.id === selected.id
          ? ({ ...node, ...patch, id: node.id, type: node.type } as JourneyNode)
          : node
      ),
    });
  };

  const removeNode = (nodeId: string) => {
    const node = value.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || (node.type === "exit" && value.nodes.length === 1)) return;
    const incoming = value.edges.filter((edge) => edge.to === nodeId);
    const outgoing = value.edges.filter((edge) => edge.from === nodeId);
    const fallback =
      outgoing.find((edge) => edge.outcome === "default")?.to ??
      outgoing.find((edge) => edge.outcome === "true")?.to ??
      outgoing[0]?.to ??
      value.nodes.find(
        (candidate) => candidate.id !== nodeId && candidate.type === "exit"
      )?.id;
    let edges = value.edges.filter(
      (edge) => edge.from !== nodeId && edge.to !== nodeId
    );
    if (fallback) {
      edges = [
        ...edges,
        ...incoming.map((edge) => ({ ...edge, to: fallback })),
      ];
    }
    const nodes = value.nodes.filter((candidate) => candidate.id !== nodeId);
    const startNodeId =
      value.start_node_id === nodeId
        ? (fallback ?? nodes[0]?.id ?? "")
        : value.start_node_id;
    onChange({ start_node_id: startNodeId, nodes, edges });
    setSelectedId(startNodeId);
  };

  const connect = (
    nodeId: string,
    outcome: "default" | "true" | "false",
    destination: string
  ) => {
    const edges = value.edges.filter(
      (edge) => !(edge.from === nodeId && edge.outcome === outcome)
    );
    if (destination) edges.push({ from: nodeId, to: destination, outcome });
    onChange({ ...value, edges });
  };

  return (
    <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="font-medium">Journey canvas</div>
          <div className="text-sm text-muted-foreground">
            Add steps, configure them in the inspector and connect each outcome.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {nodeTypes.map(({ type, label, icon: Icon }) => (
            <Button
              key={type}
              type="button"
              size="sm"
              variant="outline"
              disabled={
                type === "exit" &&
                value.nodes.some((node) => node.type === "exit")
              }
              onClick={() => addNode(type)}
            >
              <Icon className="size-4" /> {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid min-h-[420px] gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-auto rounded-xl border bg-background p-5">
          <div className="mx-auto flex max-w-xl flex-col items-center">
            <div className="rounded-full border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm">
              Event trigger
            </div>
            <ConnectorLine />
            {ordered.map((node, index) => (
              <div key={node.id} className="flex w-full flex-col items-center">
                <JourneyNodeCard
                  node={node}
                  selected={node.id === selected?.id}
                  isStart={node.id === value.start_node_id}
                  onSelect={() => setSelectedId(node.id)}
                  onDelete={() => removeNode(node.id)}
                  summary={nodeSummary(node, templates, connectors)}
                />
                {index < ordered.length - 1 && <ConnectorLine />}
              </div>
            ))}
            {!ordered.length && (
              <button
                type="button"
                className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
                onClick={() => addNode("email")}
              >
                <Plus className="mx-auto mb-2 size-5" /> Add the first action
              </button>
            )}
          </div>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PencilLine className="size-4" /> Step inspector
            </CardTitle>
            <CardDescription>
              {selected
                ? nodeLabel(selected.type)
                : "Select a step on the canvas"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selected ? (
              <>
                <div className="rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
                  {selected.id}
                </div>
                <NodeFields
                  node={selected}
                  templates={templates}
                  connectors={connectors}
                  onChange={patchNode}
                />
                {selected.type !== "exit" && (
                  <ConnectionFields
                    node={selected}
                    definition={value}
                    onConnect={connect}
                  />
                )}
                {selected.id !== value.start_node_id && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      onChange({ ...value, start_node_id: selected.id })
                    }
                  >
                    Set as first step
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-destructive hover:text-destructive"
                  disabled={
                    selected.type === "exit" && value.nodes.length === 1
                  }
                  onClick={() => removeNode(selected.id)}
                >
                  <Trash2 className="size-4" /> Delete step
                </Button>
              </>
            ) : (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Select a step to edit it.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function JourneyNodeCard({
  node,
  selected,
  isStart,
  onSelect,
  onDelete,
  summary,
}: {
  node: JourneyNode;
  selected: boolean;
  isStart: boolean;
  onSelect: () => void;
  onDelete: () => void;
  summary: string;
}) {
  const metadata = nodeTypes.find((item) => item.type === node.type)!;
  const Icon = metadata.icon;
  return (
    <div
      className={`w-full max-w-md rounded-xl border bg-card p-4 shadow-sm transition ${
        selected
          ? "border-primary ring-2 ring-primary/15"
          : "hover:border-primary/50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          onClick={onSelect}
        >
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{metadata.label}</span>
              {isStart && <Badge variant="secondary">First</Badge>}
              {node.type === "branch" && (
                <Badge variant="outline">True / False</Badge>
              )}
            </div>
            <div className="mt-1 truncate text-sm text-muted-foreground">
              {summary}
            </div>
          </div>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Delete ${metadata.label}`}
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function NodeFields({
  node,
  templates,
  connectors,
  onChange,
}: {
  node: JourneyNode;
  templates: EmailTemplate[];
  connectors: MarketingChannelConnector[];
  onChange: (patch: Partial<JourneyNode>) => void;
}) {
  if (node.type === "email") {
    return (
      <Field label="Email template">
        <select
          className={selectClass}
          value={node.template_id ?? ""}
          onChange={(event) => onChange({ template_id: event.target.value })}
        >
          <option value="">Choose a template</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (node.type === "channel") {
    return (
      <Field label="Channel connector">
        <select
          className={selectClass}
          value={node.connector_id ?? ""}
          onChange={(event) => onChange({ connector_id: event.target.value })}
        >
          <option value="">Choose a connector</option>
          {connectors
            .filter((item) => item.enabled)
            .map((connector) => (
              <option key={connector.id} value={connector.id}>
                {connector.name} · {connector.channel}
              </option>
            ))}
        </select>
      </Field>
    );
  }
  if (node.type === "delay") {
    return (
      <Field label="Wait in minutes">
        <Input
          type="number"
          min={1}
          max={525_600}
          value={Math.max(1, Math.round((node.delay_seconds ?? 60) / 60))}
          onChange={(event) =>
            onChange({
              delay_seconds: Math.max(1, Number(event.target.value)) * 60,
            })
          }
        />
      </Field>
    );
  }
  if (node.type === "branch") {
    const condition = node.condition ?? {
      field: "status",
      operator: "equals",
      value: "enabled",
    };
    const patch = (value: Partial<JourneyCondition>) =>
      onChange({ condition: { ...condition, ...value } });
    return (
      <div className="space-y-4">
        <Field label="Field">
          <Input
            value={condition.field}
            onChange={(event) => patch({ field: event.target.value })}
            placeholder="attributes.plan"
          />
        </Field>
        <Field label="Operator">
          <select
            className={selectClass}
            value={condition.operator}
            onChange={(event) =>
              patch({
                operator: event.target.value as JourneyCondition["operator"],
              })
            }
          >
            <option value="equals">Equals</option>
            <option value="not_equals">Does not equal</option>
            <option value="contains">Contains</option>
            <option value="starts_with">Starts with</option>
            <option value="exists">Exists</option>
            <option value="in">Is one of</option>
            <option value="greater_than">Greater than</option>
            <option value="greater_or_equal">Greater or equal</option>
            <option value="less_than">Less than</option>
            <option value="less_or_equal">Less or equal</option>
          </select>
        </Field>
        {condition.operator !== "exists" && (
          <Field label="Value">
            <Input
              value={String(condition.value ?? "")}
              onChange={(event) => patch({ value: event.target.value })}
            />
          </Field>
        )}
      </div>
    );
  }
  if (node.type === "update_attribute") {
    const first = Object.entries(
      node.attributes ?? { lifecycle_stage: "activated" }
    )[0] ?? ["lifecycle_stage", "activated"];
    return (
      <div className="space-y-4">
        <Field label="Subscriber field">
          <Input
            value={first[0]}
            onChange={(event) =>
              onChange({ attributes: { [event.target.value]: first[1] } })
            }
          />
        </Field>
        <Field label="New value">
          <Input
            value={String(first[1])}
            onChange={(event) =>
              onChange({ attributes: { [first[0]]: event.target.value } })
            }
          />
        </Field>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      This step completes the enrollment.
    </div>
  );
}

function ConnectionFields({
  node,
  definition,
  onConnect,
}: {
  node: JourneyNode;
  definition: JourneyDefinition;
  onConnect: (
    nodeId: string,
    outcome: "default" | "true" | "false",
    destination: string
  ) => void;
}) {
  const destinations = definition.nodes.filter(
    (candidate) => candidate.id !== node.id
  );
  const target = (outcome: "default" | "true" | "false") =>
    definition.edges.find(
      (edge) => edge.from === node.id && edge.outcome === outcome
    )?.to ?? "";
  const select = (outcome: "default" | "true" | "false", label: string) => (
    <Field label={label}>
      <select
        className={selectClass}
        value={target(outcome)}
        onChange={(event) => onConnect(node.id, outcome, event.target.value)}
      >
        <option value="">Finish without another step</option>
        {destinations.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {nodeLabel(candidate.type)} · {candidate.id}
          </option>
        ))}
      </select>
    </Field>
  );
  return node.type === "branch" ? (
    <div className="space-y-4">
      {select("true", "If condition is true")}
      {select("false", "If condition is false")}
    </div>
  ) : (
    select("default", "Continue to")
  );
}

function ConnectorLine() {
  return <div className="h-8 w-px bg-border" aria-hidden="true" />;
}

function defaultNode(
  type: JourneyNodeType,
  id: string,
  templates: EmailTemplate[],
  connectors: MarketingChannelConnector[]
): JourneyNode {
  if (type === "email")
    return { id, type, template_id: templates[0]?.id ?? "" };
  if (type === "channel")
    return {
      id,
      type,
      connector_id: connectors.find((item) => item.enabled)?.id ?? "",
    };
  if (type === "delay") return { id, type, delay_seconds: 3_600 };
  if (type === "branch")
    return {
      id,
      type,
      condition: { field: "status", operator: "equals", value: "enabled" },
    };
  if (type === "update_attribute")
    return { id, type, attributes: { lifecycle_stage: "activated" } };
  return { id, type: "exit" };
}

function layoutNodes(definition: JourneyDefinition): JourneyNode[] {
  const result: JourneyNode[] = [];
  const seen = new Set<string>();
  let current = definition.start_node_id;
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = definition.nodes.find((candidate) => candidate.id === current);
    if (!node) break;
    result.push(node);
    current =
      definition.edges.find(
        (edge) => edge.from === current && edge.outcome === "default"
      )?.to ??
      definition.edges.find(
        (edge) => edge.from === current && edge.outcome === "true"
      )?.to ??
      "";
  }
  for (const node of definition.nodes)
    if (!seen.has(node.id)) result.push(node);
  return result;
}

function nodeSummary(
  node: JourneyNode,
  templates: EmailTemplate[],
  connectors: MarketingChannelConnector[]
) {
  if (node.type === "email")
    return (
      templates.find((item) => item.id === node.template_id)?.name ??
      "Choose a template"
    );
  if (node.type === "channel")
    return (
      connectors.find((item) => item.id === node.connector_id)?.name ??
      "Choose a connector"
    );
  if (node.type === "delay")
    return `Wait ${Math.round((node.delay_seconds ?? 60) / 60)} minutes`;
  if (node.type === "branch")
    return `${node.condition?.field ?? "field"} ${node.condition?.operator ?? "equals"} ${String(node.condition?.value ?? "")}`;
  if (node.type === "update_attribute")
    return (
      Object.entries(node.attributes ?? {})
        .map(([key, value]) => `${key} = ${String(value)}`)
        .join(", ") || "Configure subscriber data"
    );
  return "Complete this enrollment";
}

function nodeLabel(type: JourneyNodeType) {
  return nodeTypes.find((item) => item.type === type)?.label ?? type;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

const selectClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";
