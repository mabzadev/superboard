import { Button, Dialog, Input, InputArea, Select, Switch } from "@cloudflare/kumo";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { X } from "@phosphor-icons/react";
import * as React from "react";

import type {
	BylineFieldDefinition,
	BylineFieldType,
	BylineFieldValidation,
	CreateBylineFieldInput,
	UpdateBylineFieldInput,
} from "../lib/api/byline-fields.js";
import { DialogError, getMutationError } from "./DialogError.js";

const SLUG_INVALID_CHARS_REGEX = /[^a-z0-9]+/g;
const SLUG_LEADING_TRAILING_REGEX = /^_|_$/g;

const TYPE_OPTIONS: { value: BylineFieldType; label: MessageDescriptor }[] = [
	{ value: "string", label: msg`Short text` },
	{ value: "text", label: msg`Long text` },
	{ value: "url", label: msg`URL` },
	{ value: "boolean", label: msg`Boolean` },
	{ value: "select", label: msg`Select` },
];

export interface BylineFieldEditorProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	field?: BylineFieldDefinition | null;
	usageTotal?: number;
	onSave: (input: CreateBylineFieldInput | UpdateBylineFieldInput) => void;
	isSaving?: boolean;
	error?: unknown;
}

interface FormState {
	slug: string;
	label: string;
	type: BylineFieldType;
	required: boolean;
	translatable: boolean;
	options: string;
}

function initialFormState(field?: BylineFieldDefinition | null): FormState {
	if (!field) {
		return {
			slug: "",
			label: "",
			type: "string",
			required: false,
			translatable: true,
			options: "",
		};
	}
	return {
		slug: field.slug,
		label: field.label,
		type: field.type,
		required: field.required,
		translatable: field.translatable,
		options: field.validation?.options?.join("\n") ?? "",
	};
}

export function BylineFieldEditor({
	open,
	onOpenChange,
	field,
	usageTotal = 0,
	onSave,
	isSaving,
	error,
}: BylineFieldEditorProps) {
	const { t } = useLingui();
	const isEdit = !!field;
	const [state, setState] = React.useState<FormState>(() => initialFormState(field));

	React.useEffect(() => {
		if (open) setState(initialFormState(field));
	}, [open, field]);

	const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
		setState((prev) => ({ ...prev, [key]: value }));

	const handleLabelChange = (value: string) => {
		setField("label", value);
		if (!isEdit) {
			setField(
				"slug",
				value
					.toLowerCase()
					.replace(SLUG_INVALID_CHARS_REGEX, "_")
					.replace(SLUG_LEADING_TRAILING_REGEX, ""),
			);
		}
	};

	const parsedSelectOptions =
		state.type === "select"
			? state.options
					.split("\n")
					.map((o) => o.trim())
					.filter(Boolean)
			: [];

	const handleSave = () => {
		if (!state.label.trim()) return;
		if (!isEdit && !state.slug.trim()) return;
		if (state.type === "select" && parsedSelectOptions.length === 0) return;

		const validation: BylineFieldValidation | null =
			state.type === "select" ? { options: parsedSelectOptions } : null;

		if (isEdit) {
			const updateInput: UpdateBylineFieldInput = {
				label: state.label,
				required: state.required,
				translatable:
					field && state.translatable !== field.translatable ? state.translatable : undefined,
				validation,
			};
			onSave(updateInput);
		} else {
			const createInput: CreateBylineFieldInput = {
				slug: state.slug,
				label: state.label,
				type: state.type,
				required: state.required,
				translatable: state.translatable,
				validation,
			};
			onSave(createInput);
		}
	};

	const translatableLocked = isEdit && usageTotal > 0;
	const canSave =
		state.label.trim().length > 0 &&
		(isEdit || state.slug.trim().length > 0) &&
		(state.type !== "select" || parsedSelectOptions.length > 0);

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog className="p-6 max-w-xl" size="lg">
				<div className="flex items-start justify-between gap-4 mb-4">
					<Dialog.Title className="text-lg font-semibold leading-none tracking-tight">
						{isEdit ? t`Edit byline field` : t`New byline field`}
					</Dialog.Title>
					<Dialog.Close
						aria-label={t`Close`}
						render={(props) => (
							<Button
								{...props}
								variant="ghost"
								shape="square"
								aria-label={t`Close`}
								className="absolute end-4 top-4"
							>
								<X className="h-4 w-4" />
								<span className="sr-only">{t`Close`}</span>
							</Button>
						)}
					/>
				</div>

				<div className="space-y-5">
					<div className="grid grid-cols-2 gap-4">
						<Input
							label={t`Label`}
							value={state.label}
							onChange={(e) => handleLabelChange(e.target.value)}
							placeholder={t`Job title`}
						/>
						<div>
							<Input
								label={t`Slug`}
								value={state.slug}
								onChange={(e) => setField("slug", e.target.value)}
								placeholder={t`job_title`}
								disabled={isEdit}
							/>
							{isEdit && (
								<p className="text-xs text-kumo-subtle mt-2">
									{t`Slugs cannot be changed after the field is created.`}
								</p>
							)}
						</div>
					</div>

					<div>
						<Select
							label={t`Type`}
							value={state.type}
							onValueChange={(v) => setField("type", v ?? "string")}
							items={Object.fromEntries(TYPE_OPTIONS.map(({ value, label }) => [value, t(label)]))}
							disabled={isEdit}
						/>
						{isEdit && (
							<p className="text-xs text-kumo-subtle mt-2">
								{t`Field type cannot be changed after creation.`}
							</p>
						)}
					</div>

					<div className="flex flex-wrap items-start gap-6">
						<Switch
							checked={state.required}
							onCheckedChange={(checked) => setField("required", checked)}
							label={<span className="text-sm">{t`Required`}</span>}
						/>
						<div className="flex flex-col gap-1">
							<Switch
								checked={state.translatable}
								onCheckedChange={(checked) => setField("translatable", checked)}
								disabled={translatableLocked}
								label={<span className="text-sm">{t`Translatable`}</span>}
							/>
							<p className="text-xs text-kumo-subtle max-w-xs">
								{translatableLocked
									? t`Locked because this field has stored values. Delete the values (or the field) to change this.`
									: state.translatable
										? t`Stored per locale — each translation of a byline gets its own value.`
										: t`Shared across all translations of the same byline.`}
							</p>
						</div>
					</div>

					{state.type === "select" && (
						<InputArea
							label={t`Options (one per line)`}
							value={state.options}
							onChange={(e) => setField("options", e.target.value)}
							placeholder={t`Editor\nReporter\nPhotographer`}
							rows={5}
						/>
					)}

					<DialogError message={getMutationError(error)} className="mt-1" />
				</div>

				<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
						{t`Cancel`}
					</Button>
					<Button onClick={handleSave} disabled={!canSave || isSaving}>
						{isSaving ? t`Saving…` : isEdit ? t`Save changes` : t`Create field`}
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
