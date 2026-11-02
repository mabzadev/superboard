export interface FormDefinition {
	name: string;
	slug: string;
	pages: FormPage[];
	settings: FormSettings;
	status: "active" | "paused";
	submissionCount: number;
	lastSubmissionAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface FormPage {
	title?: string;
	fields: FormField[];
}

export interface FormSettings {
	confirmationMessage: string;
	redirectUrl?: string;
	notifyEmails: string[];
	digestEnabled: boolean;
	digestHour: number;
	autoresponder?: {
		subject: string;
		body: string;
	};
	webhookUrl?: string;
	retentionDays: number;
	spamProtection: "none" | "honeypot" | "turnstile";
	submitLabel: string;
	nextLabel?: string;
	prevLabel?: string;
}

export interface FormField {
	id: string;
	type: FieldType;
	label: string;
	name: string;
	placeholder?: string;
	helpText?: string;
	required: boolean;
	validation?: FieldValidation;
	options?: FieldOption[];
	defaultValue?: string;
	width: "full" | "half";
	condition?: FieldCondition;
}

export type FieldType =
	| "text"
	| "email"
	| "textarea"
	| "number"
	| "tel"
	| "url"
	| "date"
	| "select"
	| "radio"
	| "checkbox"
	| "checkbox-group"
	| "file"
	| "hidden";

export interface FieldValidation {
	minLength?: number;
	maxLength?: number;
	min?: number;
	max?: number;
	pattern?: string;
	patternMessage?: string;
	accept?: string;
	maxFileSize?: number;
}

export interface FieldOption {
	label: string;
	value: string;
}

export interface FieldCondition {
	field: string;
	op: "eq" | "neq" | "filled" | "empty";
	value?: string;
}

export interface Submission {
	formId: string;
	data: Record<string, unknown>;
	files?: SubmissionFile[];
	status: "new" | "read" | "archived";
	starred: boolean;
	notes?: string;
	createdAt: string;
	meta: SubmissionMeta;
}

export interface SubmissionFile {
	fieldName: string;
	filename: string;
	contentType: string;
	size: number;
	mediaId: string;
}

export interface SubmissionMeta {
	ip: string | null;
	userAgent: string | null;
	referer: string | null;
	country: string | null;
}

export function getFormFields(form: FormDefinition): FormField[] {
	return form.pages.flatMap((p) => p.fields);
}

export function isMultiPage(form: FormDefinition): boolean {
	return form.pages.length > 1;
}

export function hasFileFields(form: FormDefinition): boolean {
	return getFormFields(form).some((f) => f.type === "file");
}
