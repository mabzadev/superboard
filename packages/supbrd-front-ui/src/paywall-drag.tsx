import {
	createContext,
	useContext,
	useState,
	useRef,
	useId,
	type ComponentProps,
	type DragEvent,
	type ReactNode,
} from "react";

export type PaywallDrag = { kind: "block" | "component"; value: string };
type DropTarget = { key: string; index: number; edge: "before" | "after" };
type DragPreview = { x: number; y: number; label: string };
const mime = "application/x-superboard-paywall";
const DragContext = createContext<{
	scope: string;
	item: PaywallDrag | null;
	setItem: (item: PaywallDrag | null) => void;
	insert: (item: PaywallDrag, index: number) => void;
	target: DropTarget | null;
	setTarget: (target: DropTarget | null) => void;
	setPreview: (preview: DragPreview | null) => void;
} | null>(null);

export function PaywallDragProvider({
	children,
	onInsert,
}: {
	children: ReactNode;
	onInsert: (item: PaywallDrag, index: number) => void;
}) {
	const scope = useId();
	const [item, setItem] = useState<PaywallDrag | null>(null);
	const [target, setTarget] = useState<DropTarget | null>(null);
	const [preview, setPreview] = useState<DragPreview | null>(null);
	return (
		<DragContext.Provider
			value={{ scope, item, setItem, insert: onInsert, target, setTarget, setPreview }}
		>
			{children}
			{preview && (
				<div className="paywall-drag-preview" style={{ left: preview.x + 14, top: preview.y + 14 }}>
					{preview.label}
				</div>
			)}
		</DragContext.Provider>
	);
}

function targetAtPoint(document: Document, x: number, y: number, scope: string): DropTarget | null {
	const element = document
		.elementsFromPoint(x, y)
		.map((item) => item.closest<HTMLElement>("[data-paywall-drop-index]"))
		.find((item) => item?.dataset.paywallDropScope === scope);
	if (!element) return null;
	const index = Number(element.dataset.paywallDropIndex);
	const key = element.dataset.paywallDropKey;
	if (!Number.isInteger(index) || index < 0 || !key) return null;
	const bounds = element.getBoundingClientRect();
	const after = element.dataset.paywallDropWhole !== "true" && y >= bounds.top + bounds.height / 2;
	return { key, index: index + (after ? 1 : 0), edge: after ? "after" : "before" };
}

function readDrag(event: DragEvent, fallback: PaywallDrag | null): PaywallDrag | null {
	try {
		const data: unknown = JSON.parse(event.dataTransfer.getData(mime));
		if (
			data &&
			typeof data === "object" &&
			"kind" in data &&
			"value" in data &&
			(data.kind === "block" || data.kind === "component") &&
			typeof data.value === "string"
		) {
			return { kind: data.kind, value: data.value };
		}
	} catch {
		return fallback;
	}
	return fallback;
}

export function PaywallDragItem({
	source,
	index,
	enabled = true,
	onPick,
	onActivate,
	children,
	...props
}: ComponentProps<"div"> & {
	source?: PaywallDrag;
	index?: number;
	enabled?: boolean;
	onPick?: () => void;
	onActivate?: () => void;
}) {
	const context = useContext(DragContext);
	const key = useId();
	const pointer = useRef<{ x: number; y: number; active: boolean } | null>(null);
	const suppressClick = useRef(false);
	const [edge, setEdge] = useState<"before" | "after" | null>(null);
	const finish = () => {
		pointer.current = null;
		context?.setItem(null);
		context?.setTarget(null);
		context?.setPreview(null);
		setEdge(null);
	};
	const dropIndex = (event: DragEvent<HTMLDivElement>) => {
		const bounds = event.currentTarget.getBoundingClientRect();
		return (index ?? 0) + (source ? (event.clientY < bounds.top + bounds.height / 2 ? 0 : 1) : 0);
	};
	return (
		<div
			{...props}
			role={props.role ?? "group"}
			draggable={enabled && Boolean(source)}
			data-paywall-drop-index={enabled ? index : undefined}
			data-paywall-drop-key={key}
			data-paywall-drop-scope={context?.scope}
			data-paywall-drop-whole={!source}
			data-drop-edge={
				context?.item
					? context.target?.key === key
						? context.target.edge
						: (edge ?? undefined)
					: undefined
			}
			data-dragging={Boolean(
				source && context?.item?.kind === source.kind && context.item.value === source.value,
			)}
			onPointerDown={(event) => {
				if (!enabled || !source || !context || event.button !== 0) return;
				if (
					event.target instanceof Element &&
					event.target.closest(
						"input,textarea,select,[contenteditable=true],[data-paywall-no-drag]",
					)
				)
					return;
				event.preventDefault();
				event.stopPropagation();
				onPick?.();
				event.currentTarget.focus({ preventScroll: true });
				pointer.current = { x: event.clientX, y: event.clientY, active: false };
				suppressClick.current = false;
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onPointerMove={(event) => {
				if (!pointer.current || !source || !context) return;
				if (
					!pointer.current.active &&
					Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) < 6
				)
					return;
				pointer.current.active = true;
				suppressClick.current = true;
				context.setItem(source);
				context.setPreview({
					x: event.clientX,
					y: event.clientY,
					label: props["aria-label"] ?? event.currentTarget.textContent?.trim().slice(0, 70) ?? "",
				});
				context.setTarget(
					targetAtPoint(
						event.currentTarget.ownerDocument,
						event.clientX,
						event.clientY,
						context.scope,
					),
				);
				const scroller = event.currentTarget.ownerDocument
					.elementsFromPoint(event.clientX, event.clientY)
					.map((element) =>
						element.closest<HTMLElement>(".paywall-device-content, .paywall-layer-panel"),
					)
					.find(Boolean);
				if (scroller) {
					const r = scroller.getBoundingClientRect();
					if (event.clientY > r.bottom - 20) scroller.scrollTop += 12;
					else if (event.clientY < r.top + 20) scroller.scrollTop -= 12;
				}
			}}
			onPointerUp={(event) => {
				if (pointer.current?.active && source && context) {
					const target = targetAtPoint(
						event.currentTarget.ownerDocument,
						event.clientX,
						event.clientY,
						context.scope,
					);
					if (target) context.insert(source, target.index);
				} else if (pointer.current && onActivate) {
					suppressClick.current = true;
					onActivate();
				}
				finish();
				if (event.currentTarget.hasPointerCapture(event.pointerId))
					event.currentTarget.releasePointerCapture(event.pointerId);
			}}
			onPointerCancel={finish}
			onClickCapture={(event) => {
				if (suppressClick.current) {
					event.preventDefault();
					event.stopPropagation();
					suppressClick.current = false;
				}
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") finish();
				else props.onKeyDown?.(event);
			}}
			onDragStart={(event) => {
				if (!enabled || !source || !context) return;
				event.stopPropagation();
				props.onDragStart?.(event);
				event.dataTransfer.effectAllowed = source.kind === "component" ? "copy" : "move";
				event.dataTransfer.setData(mime, JSON.stringify(source));
				context.setItem(source);
			}}
			onDragEnd={() => {
				context?.setItem(null);
				setEdge(null);
			}}
			onDragOver={(event) => {
				if (!enabled || index === undefined || !context?.item) return;
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = context.item.kind === "component" ? "copy" : "move";
				setEdge(dropIndex(event) === index ? "before" : "after");
			}}
			onDragLeave={(event) => {
				if (
					!(event.relatedTarget instanceof Node) ||
					!event.currentTarget.contains(event.relatedTarget)
				)
					setEdge(null);
			}}
			onDrop={(event) => {
				if (!enabled || index === undefined || !context) return;
				const item = readDrag(event, context.item);
				if (!item) return;
				event.preventDefault();
				event.stopPropagation();
				context.insert(item, dropIndex(event));
				context.setItem(null);
				setEdge(null);
			}}
		>
			{children}
		</div>
	);
}

export function PaywallDropEnd({ index, label }: { index: number; label: string }) {
	const context = useContext(DragContext);
	return (
		<PaywallDragItem
			index={index}
			role="presentation"
			className="paywall-drop-end"
			data-active={Boolean(context?.item)}
			aria-label={label}
		>
			{context?.item ? label : null}
		</PaywallDragItem>
	);
}
