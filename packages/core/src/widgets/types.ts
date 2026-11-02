import type { PortableTextBlock } from "../fields/index.js";

export type WidgetType = "content" | "menu" | "component";

export interface Widget {
	id: string;
	type: WidgetType;
	title?: string;
	content?: PortableTextBlock[];
	menuName?: string;
	componentId?: string;
	componentProps?: Record<string, unknown>;
}

export interface WidgetArea {
	id: string;
	name: string;
	label: string;
	description?: string;
	widgets: Widget[];
}

export interface WidgetRow {
	id: string;
	area_id: string;
	sort_order: number;
	type: WidgetType;
	title: string | null;
	content: string | null;
	menu_name: string | null;
	component_id: string | null;
	component_props: string | null;
	created_at: string;
}

export interface WidgetAreaRow {
	id: string;
	name: string;
	label: string;
	description: string | null;
	created_at: string;
}

export interface WidgetComponentDef {
	id: string;
	label: string;
	description?: string;
	props: Record<string, PropDef>;
}

export interface PropDef {
	type: "string" | "number" | "boolean" | "select";
	label: string;
	default?: unknown;
	options?: Array<{ value: string; label: string }>;
}

export interface CreateWidgetAreaInput {
	name: string;
	label: string;
	description?: string;
}

export interface CreateWidgetInput {
	type: WidgetType;
	title?: string;
	content?: PortableTextBlock[];
	menuName?: string;
	componentId?: string;
	componentProps?: Record<string, unknown>;
}

export interface UpdateWidgetInput extends Partial<CreateWidgetInput> {}

export interface ReorderWidgetsInput {
	widgetIds: string[];
}
