import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { API_BASE, apiFetch, parseApiResponse, throwResponseError } from "./client.js";

export interface WidgetArea {
	id: string;
	name: string;
	label: string;
	description?: string;
	widgets?: Widget[];
	widgetCount?: number;
}

export interface Widget {
	id: string;
	type: "content" | "menu" | "component";
	title?: string;
	content?: unknown[];
	menuName?: string;
	componentId?: string;
	componentProps?: Record<string, unknown>;
	sort_order?: number;
}

export interface WidgetComponent {
	id: string;
	label: string;
	description?: string;
	props: Record<
		string,
		{
			type: "string" | "number" | "boolean" | "select";
			label: string;
			default?: unknown;
			options?: Array<{ value: string; label: string }>;
		}
	>;
}

export interface CreateWidgetAreaInput {
	name: string;
	label: string;
	description?: string;
}

export interface CreateWidgetInput {
	type: "content" | "menu" | "component";
	title?: string;
	content?: unknown[];
	menuName?: string;
	componentId?: string;
	componentProps?: Record<string, unknown>;
}

export interface UpdateWidgetInput {
	type?: "content" | "menu" | "component";
	title?: string;
	content?: unknown[];
	menuName?: string;
	componentId?: string;
	componentProps?: Record<string, unknown>;
}

export async function fetchWidgetAreas(): Promise<WidgetArea[]> {
	const response = await apiFetch(`${API_BASE}/widget-areas`);
	const data = await parseApiResponse<{ items: WidgetArea[] }>(
		response,
		"Failed to fetch widget areas",
	);
	return data.items;
}

export async function fetchWidgetArea(name: string): Promise<WidgetArea> {
	const response = await apiFetch(`${API_BASE}/widget-areas/${name}`);
	return parseApiResponse<WidgetArea>(response, "Failed to fetch widget area");
}

export async function createWidgetArea(input: CreateWidgetAreaInput): Promise<WidgetArea> {
	const response = await apiFetch(`${API_BASE}/widget-areas`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	return parseApiResponse<WidgetArea>(response, "Failed to create widget area");
}

export async function deleteWidgetArea(name: string): Promise<void> {
	const response = await apiFetch(`${API_BASE}/widget-areas/${name}`, {
		method: "DELETE",
	});
	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to delete widget area`));
}

export async function createWidget(areaName: string, input: CreateWidgetInput): Promise<Widget> {
	const response = await apiFetch(`${API_BASE}/widget-areas/${areaName}/widgets`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	return parseApiResponse<Widget>(response, "Failed to create widget");
}

export async function updateWidget(
	areaName: string,
	widgetId: string,
	input: UpdateWidgetInput,
): Promise<Widget> {
	const response = await apiFetch(`${API_BASE}/widget-areas/${areaName}/widgets/${widgetId}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	return parseApiResponse<Widget>(response, "Failed to update widget");
}

export async function deleteWidget(areaName: string, widgetId: string): Promise<void> {
	const response = await apiFetch(`${API_BASE}/widget-areas/${areaName}/widgets/${widgetId}`, {
		method: "DELETE",
	});
	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to delete widget`));
}

export async function reorderWidgets(areaName: string, widgetIds: string[]): Promise<void> {
	const response = await apiFetch(`${API_BASE}/widget-areas/${areaName}/reorder`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ widgetIds }),
	});
	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to reorder widgets`));
}

export async function fetchWidgetComponents(): Promise<WidgetComponent[]> {
	const response = await apiFetch(`${API_BASE}/widget-components`);
	const data = await parseApiResponse<{ items: WidgetComponent[] }>(
		response,
		"Failed to fetch widget components",
	);
	return data.items;
}
