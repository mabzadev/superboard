export interface ConfirmDialog {
	title: string;
	text: string;
	confirm: string;
	deny: string;
	style?: "danger";
}

export interface ButtonElement {
	type: "button";
	action_id: string;
	label: string;
	style?: "primary" | "danger" | "secondary";
	value?: unknown;
	confirm?: ConfirmDialog;
}

export interface TextInputElement {
	type: "text_input";
	action_id: string;
	label: string;
	placeholder?: string;
	initial_value?: string;
	multiline?: boolean;
}

export interface NumberInputElement {
	type: "number_input";
	action_id: string;
	label: string;
	initial_value?: number;
	min?: number;
	max?: number;
}

export interface SelectElement {
	type: "select";
	action_id: string;
	label: string;
	options: Array<{ label: string; value: string }>;
	initial_value?: string;
	optionsRoute?: string;
}

export interface ToggleElement {
	type: "toggle";
	action_id: string;
	label: string;
	description?: string;
	initial_value?: boolean;
}

export interface SecretInputElement {
	type: "secret_input";
	action_id: string;
	label: string;
	placeholder?: string;
	has_value?: boolean;
}

export interface CheckboxElement {
	type: "checkbox";
	action_id: string;
	label: string;
	options: Array<{ label: string; value: string }>;
	initial_value?: string[];
}

export interface DateInputElement {
	type: "date_input";
	action_id: string;
	label: string;
	initial_value?: string;
	placeholder?: string;
}

export interface ComboboxElement {
	type: "combobox";
	action_id: string;
	label: string;
	options: Array<{ label: string; value: string }>;
	initial_value?: string;
	placeholder?: string;
}

export interface RadioElement {
	type: "radio";
	action_id: string;
	label: string;
	options: Array<{ label: string; value: string }>;
	initial_value?: string;
}

export type RepeaterSubField =
	| TextInputElement
	| NumberInputElement
	| SelectElement
	| ToggleElement;

export interface RepeaterElement {
	type: "repeater";
	action_id: string;
	label: string;
	item_label?: string;
	fields: RepeaterSubField[];
	min_items?: number;
	max_items?: number;
	initial_value?: Array<Record<string, unknown>>;
}

export interface MediaPickerElement {
	type: "media_picker";
	action_id: string;
	label: string;
	mime_type_filter?: string;
	initial_value?: string;
	placeholder?: string;
}

export type Element =
	| ButtonElement
	| TextInputElement
	| NumberInputElement
	| SelectElement
	| ToggleElement
	| SecretInputElement
	| CheckboxElement
	| DateInputElement
	| ComboboxElement
	| RadioElement
	| RepeaterElement
	| MediaPickerElement;

export type FieldCondition =
	| { field: string; eq?: unknown; neq?: never }
	| { field: string; neq?: unknown; eq?: never };

export type FormField = (
	| ButtonElement
	| TextInputElement
	| NumberInputElement
	| SelectElement
	| ToggleElement
	| SecretInputElement
	| CheckboxElement
	| DateInputElement
	| ComboboxElement
	| RadioElement
) & {
	condition?: FieldCondition;
};

export interface TableColumn {
	key: string;
	label: string;
	format?: "text" | "badge" | "relative_time" | "number" | "code";
	sortable?: boolean;
}

export interface StatItem {
	label: string;
	value: string | number;
	description?: string;
	trend?: "up" | "down" | "neutral";
}

export interface ChartSeries {
	name: string;
	data: [number, number][];
	color?: string;
}

export interface TimeseriesChartConfig {
	chart_type: "timeseries";
	style?: "line" | "bar";
	series: ChartSeries[];
	x_axis_name?: string;
	y_axis_name?: string;
	height?: number;
	gradient?: boolean;
}

export interface CustomChartConfig {
	chart_type: "custom";
	options: Record<string, unknown>;
	height?: number;
}

export type ChartConfig = TimeseriesChartConfig | CustomChartConfig;

interface BlockBase {
	block_id?: string;
}

export interface HeaderBlock extends BlockBase {
	type: "header";
	text: string;
}

export interface SectionBlock extends BlockBase {
	type: "section";
	text: string;
	accessory?: Element;
}

export interface DividerBlock extends BlockBase {
	type: "divider";
}

export interface FieldsBlock extends BlockBase {
	type: "fields";
	fields: Array<{ label: string; value: string }>;
}

export interface TableBlock extends BlockBase {
	type: "table";
	columns: TableColumn[];
	rows: Array<Record<string, unknown>>;
	next_cursor?: string;
	page_action_id: string;
	empty_text?: string;
}

export interface ActionsBlock extends BlockBase {
	type: "actions";
	elements: Element[];
}

export interface StatsBlock extends BlockBase {
	type: "stats";
	items: StatItem[];
}

export interface FormBlock extends BlockBase {
	type: "form";
	fields: FormField[];
	submit: { label: string; action_id: string };
}

export interface ImageBlock extends BlockBase {
	type: "image";
	url: string;
	alt: string;
	title?: string;
}

export interface ContextBlock extends BlockBase {
	type: "context";
	text: string;
}

export interface ColumnsBlock extends BlockBase {
	type: "columns";
	columns: Block[][];
}

export interface ChartBlock extends BlockBase {
	type: "chart";
	config: ChartConfig;
}

export interface BannerBlock extends BlockBase {
	type: "banner";
	title?: string;
	description?: string;
	variant?: "default" | "alert" | "error";
}

export interface MeterBlock extends BlockBase {
	type: "meter";
	label: string;
	value: number;
	max?: number;
	min?: number;
	custom_value?: string;
}

export interface CodeBlock extends BlockBase {
	type: "code";
	code: string;
	language?: "ts" | "tsx" | "jsonc" | "bash" | "css";
}

export interface TabPanel {
	label: string;
	blocks: Block[];
}

export interface TabBlock extends BlockBase {
	type: "tab";
	panels: TabPanel[];
	default_tab?: number;
}

export interface EmptyBlock extends BlockBase {
	type: "empty";
	title: string;
	description?: string;
	command_line?: string;
	size?: "sm" | "base" | "lg";
	actions?: Element[];
}

export interface AccordionBlock extends BlockBase {
	type: "accordion";
	label: string;
	blocks: Block[];
	default_open?: boolean;
}

export type Block =
	| HeaderBlock
	| SectionBlock
	| DividerBlock
	| FieldsBlock
	| TableBlock
	| ActionsBlock
	| StatsBlock
	| FormBlock
	| ImageBlock
	| ContextBlock
	| ColumnsBlock
	| ChartBlock
	| BannerBlock
	| MeterBlock
	| CodeBlock
	| TabBlock
	| EmptyBlock
	| AccordionBlock;

export interface BlockAction {
	type: "block_action";
	action_id: string;
	block_id?: string;
	value?: unknown;
}

export interface FormSubmit {
	type: "form_submit";
	action_id: string;
	block_id?: string;
	values: Record<string, unknown>;
}

export interface PageLoad {
	type: "page_load";
	page: string;
}

export type BlockInteraction = BlockAction | FormSubmit | PageLoad;

export interface BlockResponse {
	blocks: Block[];
	toast?: { message: string; type: "success" | "error" | "info" };
}
