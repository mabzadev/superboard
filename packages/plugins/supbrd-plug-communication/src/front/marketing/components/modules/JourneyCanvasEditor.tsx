"use client";
import {
	ReactFlow,
	Background,
	Controls,
	MiniMap,
	Handle,
	Position,
	type NodeProps,
} from "@xyflow/react";
import {
	Clock3,
	GitBranch,
	LogOut,
	Mail,
	PencilLine,
	Trash2,
	UserRoundCog,
	Webhook,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../../../../../../../supbrd-front-ui/src/shared/components/ui/button.js";

import "@xyflow/react/dist/style.css";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../../../../../supbrd-front-ui/src/shared/components/ui/card.js";
import { Input } from "../../../../../../../supbrd-front-ui/src/shared/components/ui/input.js";
import { Label } from "../../../../../../../supbrd-front-ui/src/shared/components/ui/label.js";
import type {
	EmailTemplate,
	JourneyCondition,
	JourneyDefinition,
	JourneyNode,
	MarketingChannelConnector,
} from "../../api/marketing/marketingService.js";
import { useStudioI18n } from "../../studio/i18n.js";
import { JourneySimulation } from "../../studio/JourneySimulation.js";

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
	project,
	value,
	onChange,
	templates,
	connectors,
}: {
	project: string;
	value: JourneyDefinition;
	onChange: (value: JourneyDefinition) => void;
	templates: EmailTemplate[];
	connectors: MarketingChannelConnector[];
}) {
	const { t } = useStudioI18n();
	const [selectedId, setSelectedId] = useState(value.start_node_id);
	const selected = value.nodes.find((node) => node.id === selectedId) ?? null;
	const ordered = useMemo(() => layoutNodes(value), [value]);

	const addNode = (type: JourneyNodeType) => {
		const id = `${type}-${crypto.randomUUID().slice(0, 8)}`;
		const node = defaultNode(type, id, templates, connectors);
		const firstExit = value.nodes.find((candidate) => candidate.type === "exit");
		const destination = firstExit?.id ?? null;
		const terminalEdges = destination ? value.edges.filter((edge) => edge.to === destination) : [];
		const sourceEdge = terminalEdges.find((edge) => edge.outcome === "default");
		const source = sourceEdge?.from;
		let edges = value.edges;
		if (sourceEdge) {
			edges = edges.map((edge) => (edge === sourceEdge ? { ...edge, to: id } : edge));
		}
		if (type === "branch" && destination) {
			edges = [
				...edges,
				{ from: id, to: destination, outcome: "true" as const },
				{ from: id, to: destination, outcome: "false" as const },
			];
		} else if (type !== "exit" && destination) {
			edges = [...edges, { from: id, to: destination, outcome: "default" as const }];
		}
		const nodes = firstExit
			? value.nodes.flatMap((candidate) =>
					candidate.id === firstExit.id ? [node, candidate] : [candidate],
				)
			: [...value.nodes, node];
		onChange({
			start_node_id:
				value.nodes.length === 0 || (value.start_node_id === destination && !source)
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
					: node,
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
			value.nodes.find((candidate) => candidate.id !== nodeId && candidate.type === "exit")?.id;
		let edges = value.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
		if (fallback) {
			edges = [...edges, ...incoming.map((edge) => ({ ...edge, to: fallback }))];
		}
		const nodes = value.nodes.filter((candidate) => candidate.id !== nodeId);
		const startNodeId =
			value.start_node_id === nodeId ? (fallback ?? nodes[0]?.id ?? "") : value.start_node_id;
		onChange({ start_node_id: startNodeId, nodes, edges });
		setSelectedId(startNodeId);
	};

	const connect = (nodeId: string, outcome: "default" | "true" | "false", destination: string) => {
		const edges = value.edges.filter((edge) => !(edge.from === nodeId && edge.outcome === outcome));
		if (destination) edges.push({ from: nodeId, to: destination, outcome });
		onChange({ ...value, edges });
	};

	return (
		<div className="space-y-4 rounded-xl border bg-muted/20 p-4">
			<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div>
					<div className="font-medium">{t("Journey canvas")}</div>
					<div className="text-sm text-muted-foreground">
						{t("Add steps, configure them in the inspector and connect each outcome.")}
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					{nodeTypes.map(({ type, label, icon: Icon }) => (
						<Button
							key={type}
							type="button"
							size="sm"
							variant="outline"
							disabled={type === "exit" && value.nodes.some((node) => node.type === "exit")}
							onClick={() => addNode(type)}
						>
							<Icon className="size-4" /> {label}
						</Button>
					))}
				</div>
			</div>

			<div className="grid min-h-[420px] gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
				<div className="h-[620px] overflow-hidden rounded-xl border border-kumo-line bg-kumo-tint">
					<ReactFlow
						nodes={ordered.map((node, index) => ({
							id: node.id,
							type: "journey",
							position: { x: node.type === "branch" ? 160 : (index % 2) * 320, y: index * 150 },
							data: {
								label: t(nodeLabel(node.type)),
								summary: nodeSummary(node, templates, connectors, t),
								kind: node.type,
							},
							selected: node.id === selectedId,
						}))}
						edges={value.edges.map((edge, index) => ({
							id: edge.from + ":" + edge.outcome + ":" + index,
							source: edge.from,
							target: edge.to,
							sourceHandle: edge.outcome,
							label: edge.outcome === "default" ? undefined : t(edge.outcome),
							type: "smoothstep",
						}))}
						nodeTypes={journeyNodeTypes}
						onNodeClick={(_event, node) => setSelectedId(node.id)}
						onConnect={(connection) => {
							if (connection.source && connection.target && connection.source !== connection.target)
								connect(
									connection.source,
									connection.sourceHandle === "true"
										? "true"
										: connection.sourceHandle === "false"
											? "false"
											: "default",
									connection.target,
								);
						}}
						nodesDraggable={false}
						onNodesDelete={(nodes) => {
							for (const node of nodes) removeNode(node.id);
						}}
						fitView
						minZoom={0.25}
						maxZoom={1.5}
						ariaLabelConfig={{
							"controls.zoomIn.ariaLabel": t("Zoom in"),
							"controls.zoomOut.ariaLabel": t("Zoom out"),
							"controls.fitView.ariaLabel": t("Fit view"),
							"controls.interactive.ariaLabel": t("Toggle interaction"),
						}}
					>
						<Background />
						<Controls />
						<MiniMap />
					</ReactFlow>
				</div>

				<Card className="h-fit">
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<PencilLine className="size-4" /> {t("Step inspector")}
						</CardTitle>
						<CardDescription>
							{selected ? t(nodeLabel(selected.type)) : t("Select a step on the canvas")}
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
									<ConnectionFields node={selected} definition={value} onConnect={connect} />
								)}
								{selected.id !== value.start_node_id && (
									<Button
										type="button"
										variant="outline"
										className="w-full"
										onClick={() => onChange({ ...value, start_node_id: selected.id })}
									>
										{t("Set as first step")}
									</Button>
								)}
								<Button
									type="button"
									variant="ghost"
									className="w-full text-destructive hover:text-destructive"
									disabled={selected.type === "exit" && value.nodes.length === 1}
									onClick={() => removeNode(selected.id)}
								>
									<Trash2 className="size-4" /> {t("Delete step")}
								</Button>
							</>
						) : (
							<div className="py-10 text-center text-sm text-muted-foreground">
								{t("Select a step to edit it.")}
							</div>
						)}
					</CardContent>
				</Card>
			</div>
			<JourneySimulation project={project} definition={value} templates={templates} />
		</div>
	);
}

function JourneyGraphNode({ data }: NodeProps) {
	return (
		<div className="w-60 rounded-xl border border-kumo-line bg-kumo-base p-4 text-kumo-default shadow-sm">
			<Handle type="target" position={Position.Top} />
			<p className="text-sm font-semibold">{String(data.label)}</p>
			<p className="mt-2 text-xs text-kumo-subtle">{String(data.summary)}</p>
			{data.kind === "branch" ? (
				<>
					<Handle id="true" type="source" position={Position.Bottom} style={{ left: "25%" }} />
					<Handle id="false" type="source" position={Position.Bottom} style={{ left: "75%" }} />
				</>
			) : data.kind !== "exit" ? (
				<Handle id="default" type="source" position={Position.Bottom} />
			) : null}
		</div>
	);
}
const journeyNodeTypes = { journey: JourneyGraphNode };

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
	const { t } = useStudioI18n();
	if (node.type === "email") {
		return (
			<Field label={t("Email template")}>
				<select
					className={selectClass}
					value={node.template_id ?? ""}
					onChange={(event) => onChange({ template_id: event.target.value })}
				>
					<option value="">{t("Choose a template")}</option>
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
			<Field label={t("Channel connector")}>
				<select
					className={selectClass}
					value={node.connector_id ?? ""}
					onChange={(event) => onChange({ connector_id: event.target.value })}
				>
					<option value="">{t("Choose a connector")}</option>
					{connectors
						.filter((item) => item.enabled)
						.map((connector) => (
							<option key={connector.id} value={connector.id}>
								{connector.name} {t("·")} {connector.channel}
							</option>
						))}
				</select>
			</Field>
		);
	}
	if (node.type === "delay") {
		return (
			<Field label={t("Wait in minutes")}>
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
				<Field label={t("Field")}>
					<Input
						value={condition.field}
						onChange={(event) => patch({ field: event.target.value })}
						placeholder={t("attributes.plan")}
					/>
				</Field>
				<Field label={t("Operator")}>
					<select
						className={selectClass}
						value={condition.operator}
						onChange={(event) =>
							patch({
								operator: event.target.value as JourneyCondition["operator"],
							})
						}
					>
						<option value="equals">{t("Equals")}</option>
						<option value="not_equals">{t("Does not equal")}</option>
						<option value="contains">{t("Contains")}</option>
						<option value="starts_with">{t("Starts with")}</option>
						<option value="exists">{t("Exists")}</option>
						<option value="in">{t("Is one of")}</option>
						<option value="greater_than">{t("Greater than")}</option>
						<option value="greater_or_equal">{t("Greater or equal")}</option>
						<option value="less_than">{t("Less than")}</option>
						<option value="less_or_equal">{t("Less or equal")}</option>
					</select>
				</Field>
				{condition.operator !== "exists" && (
					<Field label={t("Value")}>
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
		const first = Object.entries(node.attributes ?? { lifecycle_stage: "activated" })[0] ?? [
			"lifecycle_stage",
			"activated",
		];
		return (
			<div className="space-y-4">
				<Field label={t("Subscriber field")}>
					<Input
						value={first[0]}
						onChange={(event) => onChange({ attributes: { [event.target.value]: first[1] } })}
					/>
				</Field>
				<Field label={t("New value")}>
					<Input
						value={String(first[1])}
						onChange={(event) => onChange({ attributes: { [first[0]]: event.target.value } })}
					/>
				</Field>
			</div>
		);
	}
	return (
		<div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
			{t("This step completes the enrollment.")}
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
	onConnect: (nodeId: string, outcome: "default" | "true" | "false", destination: string) => void;
}) {
	const { t } = useStudioI18n();
	const destinations = definition.nodes.filter((candidate) => candidate.id !== node.id);
	const target = (outcome: "default" | "true" | "false") =>
		definition.edges.find((edge) => edge.from === node.id && edge.outcome === outcome)?.to ?? "";
	const select = (outcome: "default" | "true" | "false", label: string) => (
		<Field label={label}>
			<select
				className={selectClass}
				value={target(outcome)}
				onChange={(event) => onConnect(node.id, outcome, event.target.value)}
			>
				<option value="">{t("Finish without another step")}</option>
				{destinations.map((candidate) => (
					<option key={candidate.id} value={candidate.id}>
						{t(nodeLabel(candidate.type))} {t("·")} {candidate.id}
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

function defaultNode(
	type: JourneyNodeType,
	id: string,
	templates: EmailTemplate[],
	connectors: MarketingChannelConnector[],
): JourneyNode {
	if (type === "email") return { id, type, template_id: templates[0]?.id ?? "" };
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
			definition.edges.find((edge) => edge.from === current && edge.outcome === "default")?.to ??
			definition.edges.find((edge) => edge.from === current && edge.outcome === "true")?.to ??
			"";
	}
	for (const node of definition.nodes) if (!seen.has(node.id)) result.push(node);
	return result;
}

function nodeSummary(
	node: JourneyNode,
	templates: EmailTemplate[],
	connectors: MarketingChannelConnector[],
	t: (key: string) => string,
) {
	if (node.type === "email")
		return templates.find((item) => item.id === node.template_id)?.name ?? t("Choose a template");
	if (node.type === "channel")
		return (
			connectors.find((item) => item.id === node.connector_id)?.name ?? t("Choose a connector")
		);
	if (node.type === "delay")
		return t("Wait {minutes} minutes").replace(
			"{minutes}",
			String(Math.round((node.delay_seconds ?? 60) / 60)),
		);
	if (node.type === "branch")
		return `${node.condition?.field ?? "field"} ${node.condition?.operator ?? "equals"} ${String(node.condition?.value ?? "")}`;
	if (node.type === "update_attribute")
		return (
			Object.entries(node.attributes ?? {})
				.map(([key, value]) => `${key} = ${String(value)}`)
				.join(", ") || t("Configure subscriber data")
		);
	return t("Complete this enrollment");
}

function nodeLabel(type: JourneyNodeType) {
	return nodeTypes.find((item) => item.type === type)?.label ?? type;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="space-y-2">
			<Label>{label}</Label>
			{children}
		</div>
	);
}

const selectClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";
