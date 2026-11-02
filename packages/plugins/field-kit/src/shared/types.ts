export type SubFieldType =
	| "text"
	| "number"
	| "boolean"
	| "select"
	| "textarea"
	| "date"
	| "color"
	| "url";

export interface SubFieldDef {
	key: string;
	label: string;
	type: SubFieldType;
	required?: boolean;
	placeholder?: string;
	helpText?: string;
	defaultValue?: unknown;
	options?: string[] | Array<{ label: string; value: string }>;
	min?: number;
	max?: number;
	step?: number;
	suffix?: string;
	prefix?: string;
	rows?: number;
}

export interface FieldWidgetProps {
	value: unknown;
	onChange: (value: unknown) => void;
	label: string;
	id: string;
	required?: boolean;
	options?: Record<string, unknown>;
	minimal?: boolean;
}

export interface GridAxisDef {
	key: string;
	label: string;
	image?: string;
}
