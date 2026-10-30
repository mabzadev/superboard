import {
	ArrowDown,
	ArrowUp,
	ChevronDown,
	GripVertical,
	Hand,
	Image,
	Layers,
	LayoutTemplate,
	Maximize,
	MousePointer2,
	Palette,
	Plus,
	Type,
	ZoomIn,
	ZoomOut,
	Square,
	CreditCard,
	X,
	Languages,
	Play,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button, Input } from "./kumo.js";
import { PaywallDragItem, PaywallDropEnd } from "./paywall-drag.js";

import "./paywall-builder.css";

type Layer = { id: string; type: string; props: Record<string, unknown> };
type Translate = (key: string) => string;
const icons: Record<string, typeof Type> = {
	heading: Type,
	text: Type,
	image: Image,
	product: CreditCard,
	button: Square,
	legal: Type,
	spacer: GripVertical,
	close: X,
};

export function PaywallLayers<T extends string>({
	blocks,
	selectedId,
	types,
	t,
	onSelect,
	onAdd,
	onMove,
	onTemplate,
	onMode,
	compact = false,
	screenLabel,
}: {
	compact?: boolean;
	screenLabel?: string;
	blocks: Layer[];
	selectedId?: string;
	types: T[];
	t: Translate;
	onSelect: (id: string) => void;
	onAdd: (type: T) => void;
	onMove: (id: string, delta: number) => void;
	onTemplate: (name: string) => void;
	onMode: (mode: string) => void;
}) {
	const [panel, setPanel] = useState("Layers");
	const [search, setSearch] = useState("");
	const [collapsed, setCollapsed] = useState(false);
	return (
		<aside className="paywall-layers" aria-label={t("Layers")}>
			<nav hidden={compact} className="paywall-tools" aria-label={t("Editor tools")}>
				{(
					[
						["Layers", Layers],
						["Add component", Plus],
						["Templates", LayoutTemplate],
						["Theme", Palette],
						["Languages", Languages],
						["Preview", Play],
					] as const
				).map(([label, Icon]) => (
					<Button
						key={label}
						shape="square"
						variant={panel === label ? "secondary" : "ghost"}
						title={t(label)}
						aria-label={t(label)}
						aria-pressed={panel === label}
						onClick={() => {
							setPanel(label);
							onMode(label === "Languages" || label === "Preview" ? label : "Design");
							if (label === "Theme") onSelect("");
						}}
					>
						<Icon size={18} />
					</Button>
				))}
			</nav>
			<div className="paywall-layer-panel">
				{compact && (
					<nav className="onboarding-panel-tabs" aria-label={t("Editor tools")}>
						{["Layers", "Templates"].map((name) => (
							<Button
								key={name}
								size="sm"
								variant={panel === name ? "secondary" : "ghost"}
								onClick={() => {
									setPanel(name);
								}}
							>
								{t(name)}
							</Button>
						))}
					</nav>
				)}
				<header className="paywall-panel-heading">
					<strong>{t(panel)}</strong>
					{panel === "Layers" && (
						<Button
							variant="ghost"
							size="sm"
							title={t("Add component")}
							onClick={() => {
								setPanel("Add component");
							}}
						>
							<Plus size={16} />
							{t("Add")}
						</Button>
					)}
				</header>
				<div className="paywall-panel-content">
					{panel === "Add component" ? (
						<>
							<Input
								aria-label={t("Search components")}
								placeholder={t("Search components")}
								value={search}
								onChange={(event) => {
									setSearch(event.target.value);
								}}
							/>
							<div className="paywall-component-grid">
								{types
									.filter((type) =>
										t(type).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
									)
									.map((type) => {
										const Icon = icons[type] ?? Square;
										return (
											<PaywallDragItem
												key={type}
												source={{ kind: "component", value: type }}
												aria-label={t(type)}
												onActivate={() => {
													onAdd(type);
													setPanel("Layers");
												}}
												className="paywall-palette-item"
											>
												<Button
													variant="outline"
													className="paywall-component"
													onClick={() => {
														onAdd(type);
														setPanel("Layers");
													}}
												>
													<Icon size={22} />
													{t(type)}
												</Button>
											</PaywallDragItem>
										);
									})}
							</div>
						</>
					) : panel === "Templates" ? (
						<div className="space-y-3">
							{["Minimal", "Comparison", "Editorial"].map((name) => (
								<Button
									key={name}
									variant="outline"
									className="w-full"
									onClick={() => {
										onTemplate(name);
									}}
								>
									<LayoutTemplate size={16} />
									{t(name)}
								</Button>
							))}
						</div>
					) : (
						<>
							{panel !== "Layers" && (
								<p className="mb-4 text-sm text-kumo-subtle">
									{t(
										panel === "Theme"
											? "Edit the paywall theme in the properties panel."
											: panel === "Languages"
												? "Translate your content in the properties panel."
												: "Preview interactions without making a purchase.",
									)}
								</p>
							)}
							<Button
								variant="ghost"
								className="w-full justify-start"
								aria-expanded={!collapsed}
								onClick={() => {
									setCollapsed(!collapsed);
								}}
							>
								<ChevronDown
									size={14}
									style={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
								/>
								<Layers size={15} />
								{screenLabel ?? t("Paywall screen")}
							</Button>
							{!collapsed && (
								<div className="paywall-layer-list">
									{blocks.map((block, index) => {
										const Icon = icons[block.type] ?? Square;
										const name =
											typeof block.props.editor_name === "string" && block.props.editor_name
												? block.props.editor_name
												: typeof block.props.text === "string" && block.props.text
													? block.props.text
													: t(block.type);
										return (
											<PaywallDragItem
												key={block.id}
												className="paywall-layer-row"
												data-selected={selectedId === block.id}
												source={{ kind: "block", value: block.id }}
												index={index}
												onPick={() => {
													onSelect(block.id);
													onMode("Design");
												}}
											>
												<Button
													variant={selectedId === block.id ? "secondary" : "ghost"}
													size="sm"
													className="paywall-layer-select"
													title={name}
													aria-pressed={selectedId === block.id}
													onClick={() => {
														onSelect(block.id);
														onMode("Design");
													}}
												>
													<Icon size={15} />
													<span>{name}</span>
												</Button>
												<div className="paywall-layer-actions" data-paywall-no-drag>
													<Button
														size="xs"
														variant="ghost"
														shape="square"
														aria-label={t("Move up")}
														disabled={index === 0}
														onClick={() => {
															onMove(block.id, -1);
														}}
													>
														<ArrowUp size={12} />
													</Button>
													<Button
														size="xs"
														variant="ghost"
														shape="square"
														aria-label={t("Move down")}
														disabled={index === blocks.length - 1}
														onClick={() => {
															onMove(block.id, 1);
														}}
													>
														<ArrowDown size={12} />
													</Button>
												</div>
											</PaywallDragItem>
										);
									})}
									<PaywallDropEnd index={blocks.length} label={t("Drop here")} />
								</div>
							)}
						</>
					)}
				</div>
			</div>
		</aside>
	);
}

export function StudioCanvas({
	builder,
	children,
	t,
	controls,
	size,
	label,
}: {
	label?: string;
	builder: boolean;
	children: ReactNode;
	t: Translate;
	controls?: ReactNode;
	size?: { width: number; height: number };
}) {
	const frameWidth = size?.width;
	const frameHeight = size?.height;
	const [fittedZoom, setFittedZoom] = useState(0.55);
	const [manualZoom, setZoom] = useState<number | null>(null);
	const zoom = manualZoom ?? fittedZoom;
	const [pan, setPan] = useState(false);
	const viewport = useRef<HTMLDivElement>(null);
	const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
	useEffect(() => {
		const element = viewport.current;
		if (
			!builder ||
			!element ||
			!frameWidth ||
			!frameHeight ||
			typeof ResizeObserver === "undefined"
		)
			return;
		const fit = () => {
			const availableWidth = element.clientWidth - 80;
			const availableHeight = element.clientHeight - 200;
			if (availableWidth > 0 && availableHeight > 0)
				setFittedZoom(
					Math.max(0.2, Math.min(1, availableWidth / frameWidth, availableHeight / frameHeight)),
				);
		};
		const observer = new ResizeObserver(fit);
		observer.observe(element);
		fit();
		return () => {
			observer.disconnect();
		};
	}, [builder, frameWidth, frameHeight]);
	if (!builder) return <main className="overflow-auto bg-kumo-tint p-5">{children}</main>;
	return (
		<div className="paywall-canvas">
			<div className="paywall-preview-toolbar">{controls}</div>
			<div
				ref={viewport}
				className="paywall-canvas-viewport"
				data-pan={pan}
				aria-label={label ?? t("Paywall canvas")}
				onPointerDown={(event) => {
					if (!pan || !viewport.current) return;
					drag.current = {
						x: event.clientX,
						y: event.clientY,
						left: viewport.current.scrollLeft,
						top: viewport.current.scrollTop,
					};
					event.currentTarget.setPointerCapture(event.pointerId);
				}}
				onPointerMove={(event) => {
					if (!drag.current || !viewport.current) return;
					viewport.current.scrollLeft = drag.current.left - event.clientX + drag.current.x;
					viewport.current.scrollTop = drag.current.top - event.clientY + drag.current.y;
				}}
				onPointerUp={() => {
					drag.current = null;
				}}
				onPointerCancel={() => {
					drag.current = null;
				}}
			>
				<div className="paywall-artboard" style={{ zoom }} inert={pan}>
					<p className="paywall-artboard-label">{label ?? t("Paywall screen")}</p>
					{children}
				</div>
			</div>
			<div className="paywall-zoom-toolbar" aria-label={t("Canvas controls")}>
				<Button
					variant={!pan ? "secondary" : "ghost"}
					shape="square"
					aria-label={t("Select component")}
					aria-pressed={!pan}
					onClick={() => {
						setPan(false);
					}}
				>
					<MousePointer2 size={16} />
				</Button>
				<Button
					variant={pan ? "secondary" : "ghost"}
					shape="square"
					aria-label={t("Pan canvas")}
					aria-pressed={pan}
					onClick={() => {
						setPan(true);
					}}
				>
					<Hand size={16} />
				</Button>
				<span className="paywall-toolbar-divider" />
				<Button
					variant="ghost"
					shape="square"
					aria-label={t("Zoom out")}
					disabled={zoom <= 0.2}
					onClick={() => {
						setZoom(Math.max(0.2, zoom - 0.1));
					}}
				>
					<ZoomOut size={16} />
				</Button>
				<output className="min-w-12 text-center text-xs tabular-nums" aria-label={t("Zoom")}>
					{Math.round(zoom * 100)}%
				</output>
				<Button
					variant="ghost"
					shape="square"
					aria-label={t("Zoom in")}
					disabled={zoom >= 2}
					onClick={() => {
						setZoom(Math.min(2, zoom + 0.1));
					}}
				>
					<ZoomIn size={16} />
				</Button>
				<Button
					variant="ghost"
					shape="square"
					aria-label={t("Reset canvas")}
					onClick={() => {
						setZoom(null);
						viewport.current?.scrollTo?.({ left: 0, top: 0 });
					}}
				>
					<Maximize size={16} />
				</Button>
			</div>
		</div>
	);
}
