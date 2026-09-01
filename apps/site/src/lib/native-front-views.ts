import type {
	NativeRendererBlock,
	NativeRendererCard,
	NativeRendererField,
} from "@superboard/supbrd-core";
import type { Menu, MenuItem } from "emdash";

import type {
	NativeFrontEditableNavigationGroup,
	NativeFrontEditableView,
	NativeFrontViewBindings,
} from "./native-front-presentation.js";

const PATH_SUFFIX_PATTERN = /[?#]/u;
const PATH_EDGE_SLASH_PATTERN = /^\/+|\/+$/gu;
const FIELD_CONTROLS = new Set<NativeRendererField["control"]>(["text", "textarea", "range"]);

export function frontViewSlug(path: string): string {
	const normalized =
		path.split(PATH_SUFFIX_PATTERN, 1)[0]?.replace(PATH_EDGE_SLASH_PATTERN, "") ?? "";
	return normalized ? normalized.replaceAll("/", "--") : "home";
}

export function editableNavigationFromMenu(
	menu: Menu | null,
): NativeFrontEditableNavigationGroup[] | undefined {
	if (!menu) return undefined;
	return menu.items.map((group) => ({
		label: group.label,
		items: flattenMenuItems(group.children.length > 0 ? group.children : [group]),
	}));
}

export function editableViewFromEntry(entry: unknown): NativeFrontEditableView | null {
	if (!isRecord(entry) || !isRecord(entry.data)) return null;
	const data = entry.data;
	if (
		typeof data.route_id !== "string" ||
		!data.route_id ||
		typeof data.plugin_id !== "string" ||
		!data.plugin_id ||
		typeof data.path !== "string" ||
		!data.path.startsWith("/")
	) {
		return null;
	}
	const presentation = jsonRecord(data.presentation);
	const blocks = presentation ? rendererBlocks(presentation.blocks) : [];
	if (blocks === null) return null;
	return {
		route_id: data.route_id,
		plugin_id: data.plugin_id,
		path: data.path,
		title: typeof data.name === "string" ? data.name : null,
		description: typeof data.description === "string" ? data.description : null,
		blocks,
		bindings: viewBindings(data.bindings),
	};
}

function flattenMenuItems(items: readonly MenuItem[]): Array<{ label: string; href: string }> {
	return items.flatMap((item) => [
		{ label: item.label, href: item.url },
		...flattenMenuItems(item.children),
	]);
}

function rendererBlocks(value: unknown): NativeRendererBlock[] | null {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return null;
	const blocks = value.map((block) => rendererBlock(block));
	return blocks.every((block): block is NativeRendererBlock => block !== null) ? blocks : null;
}

function rendererBlock(value: unknown): NativeRendererBlock | null {
	if (!isRecord(value) || typeof value.kind !== "string") return null;
	if (value.kind === "notice") {
		return typeof value.title === "string" && typeof value.description === "string"
			? { kind: "notice", title: value.title, description: value.description }
			: null;
	}
	if (value.kind === "columns") {
		if (!Array.isArray(value.columns)) return null;
		const columns = value.columns.map((column) => rendererCard(column));
		return columns.every((column): column is NativeRendererCard => column !== null)
			? { kind: "columns", columns }
			: null;
	}
	if (value.kind !== "card") return null;
	const card = rendererCard(value);
	return card ? { kind: "card", ...card } : null;
}

function rendererCard(value: unknown): NativeRendererCard | null {
	if (!isRecord(value) || typeof value.title !== "string") return null;
	let fields: NativeRendererField[] | undefined;
	if (value.fields !== undefined) {
		if (!Array.isArray(value.fields)) return null;
		const parsed = value.fields.map((field) => rendererField(field));
		if (!parsed.every((field): field is NativeRendererField => field !== null)) return null;
		fields = parsed;
	}
	if (value.description !== undefined && typeof value.description !== "string") return null;
	if (value.action_label !== undefined && typeof value.action_label !== "string") return null;
	if (value.empty_state !== undefined && typeof value.empty_state !== "string") return null;
	return {
		title: value.title,
		...(typeof value.description === "string" ? { description: value.description } : {}),
		...(fields ? { fields } : {}),
		...(typeof value.action_label === "string" ? { action_label: value.action_label } : {}),
		...(typeof value.empty_state === "string" ? { empty_state: value.empty_state } : {}),
	};
}

function rendererField(value: unknown): NativeRendererField | null {
	if (
		!isRecord(value) ||
		typeof value.label !== "string" ||
		typeof value.control !== "string" ||
		!FIELD_CONTROLS.has(value.control as NativeRendererField["control"])
	) {
		return null;
	}
	if (value.placeholder !== undefined && typeof value.placeholder !== "string") return null;
	if (value.value !== undefined && typeof value.value !== "string") return null;
	return {
		label: value.label,
		control: value.control as NativeRendererField["control"],
		...(typeof value.placeholder === "string" ? { placeholder: value.placeholder } : {}),
		...(typeof value.value === "string" ? { value: value.value } : {}),
	};
}

function viewBindings(value: unknown): NativeFrontViewBindings {
	const bindings = jsonRecord(value);
	return {
		data_sources: stringArray(bindings?.data_sources),
		commands: stringArray(bindings?.commands),
	};
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && item.length > 0)
		: [];
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
	if (isRecord(value)) return value;
	if (typeof value !== "string") return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
