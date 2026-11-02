import type { z } from "astro/zod";

import type { FieldValidation } from "../schema/types.js";

export type ColumnType = "TEXT" | "REAL" | "INTEGER" | "JSON";

export interface FieldDefinition<_T = unknown> {
	type: string;
	columnType: ColumnType;
	schema: z.ZodTypeAny;
	options?: unknown;
	ui?: FieldUIHints;
	validation?: FieldValidation;
}

export interface FieldUIHints {
	widget?: string;
	placeholder?: string;
	helpText?: string;
	rows?: number;
	min?: number | string;
	max?: number | string;
	[key: string]: unknown;
}

export interface PortableTextBlock {
	_type: string;
	_key: string;
	[key: string]: unknown;
}

export type { MediaValue } from "../media/types.js";
import type { MediaValue } from "../media/types.js";

export type ImageValue = MediaValue;

export interface FileValue {
	id: string;
	url?: string;
	src?: string;
	filename?: string;
	mimeType?: string;
	size?: number;
	provider?: string;
	meta?: Record<string, unknown>;
}
