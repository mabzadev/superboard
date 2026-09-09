import { ReactFlow, Background, Controls, MiniMap, Position } from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import type { ReactNode } from "react";

type FlowScreen = {
	id: string;
	name: string;
	next_screen_id?: string | null;
	blocks: Array<{ id: string; type: string; props: Record<string, unknown> }>;
};
export function ExperienceFlowCanvas({
	screens,
	positions,
	onSelect,
	onConnect,
	onPosition,
	preview,
	t,
}: {
	screens: FlowScreen[];
	positions: Record<string, { x: number; y: number }>;
	onSelect: (id: string) => void;
	onConnect: (from: string, to: string) => void;
	onPosition: (id: string, position: { x: number; y: number }) => void;
	preview: (screen: FlowScreen) => ReactNode;
	t: (key: string) => string;
}) {
	const edges = screens.flatMap((screen, index) => {
		const next = screen.next_screen_id ?? screens[index + 1]?.id;
		const branches = screen.blocks
			.filter((block) => block.type === "question")
			.flatMap((block) =>
				(Array.isArray(block.props.options)
					? (block.props.options as Array<Record<string, unknown>>)
					: []
				)
					.filter(
						(option) =>
							typeof option.next_screen_id === "string" &&
							screens.some((item) => item.id === option.next_screen_id),
					)
					.map((option) => ({
						id: screen.id + ":" + String(option.value),
						source: screen.id,
						target: String(option.next_screen_id),
						label: String(option.label ?? option.value),
						type: "smoothstep",
					})),
			);
		return [
			...branches,
			...(next && screens.some((item) => item.id === next)
				? [
						{
							id: screen.id + ":next",
							source: screen.id,
							target: next,
							label: t("Next screen"),
							type: "smoothstep",
						},
					]
				: []),
		];
	});
	return (
		<div className="h-[650px] bg-kumo-tint">
			<ReactFlow
				nodes={screens.map((screen, index) => ({
					id: screen.id,
					sourcePosition: Position.Right,
					targetPosition: Position.Left,
					position: positions[screen.id] ?? { x: index * 330, y: 80 * (index % 2) },
					data: {
						label: (
							<div className="w-56 overflow-hidden rounded-xl border border-kumo-line bg-kumo-base text-kumo-default shadow-sm">
								<p className="border-b border-kumo-line p-3 text-start font-semibold">
									{screen.name}
								</p>
								<div className="pointer-events-none h-64 overflow-hidden p-3">
									{preview(screen)}
								</div>
							</div>
						),
					},
					style: { padding: 0, border: 0, background: "transparent" },
				}))}
				edges={edges}
				onNodeClick={(_event, node) => onSelect(node.id)}
				onConnect={(connection) => {
					if (connection.source && connection.target && connection.source !== connection.target)
						onConnect(connection.source, connection.target);
				}}
				onNodeDragStop={(_event, node) => onPosition(node.id, node.position)}
				fitView
				minZoom={0.2}
				maxZoom={1.5}
				deleteKeyCode={null}
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
	);
}
