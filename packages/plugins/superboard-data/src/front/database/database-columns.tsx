import { Button, Select, SwitchField } from "@superboard/front-ui/kumo";
import {
	SettingsActions,
	SettingsDependents,
	SettingsTextField,
} from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { useState } from "react";

import { DELETE, PATCH, POST } from "./transport.js";
import {
	COLUMN_TYPES,
	encode,
	readBody,
	useDataAction,
	type Column,
	type ColumnType,
	type Table,
} from "../console/client.js";
import { useDataConsoleI18n, type DataConsoleMessages } from "../console/i18n.js";
import { cellText, CodeField, ConfirmPanel, ErrorAlert, Notice } from "../console/shared.js";

export interface ColumnDraft {
	key: string;
	name: string;
	type: ColumnType;
	required: boolean;
	unique: boolean;
	indexed: boolean;
	hasDefault: boolean;
	defaultValue: string;
}

export class DraftError extends Error {}

let columnSequence = 0;

export function nextColumnKey(): string {
	columnSequence += 1;
	return `column-${columnSequence}`;
}

export function emptyColumn(key: string): ColumnDraft {
	return {
		key,
		name: "",
		type: "text",
		required: false,
		unique: false,
		indexed: false,
		hasDefault: false,
		defaultValue: "",
	};
}

export function columnDraft(column: Column): ColumnDraft {
	return {
		key: column.name,
		name: column.name,
		type: column.type,
		required: !column.nullable,
		unique: column.unique,
		indexed: column.indexed,
		hasDefault: column.default !== null,
		defaultValue: valueText(column.type, column.default),
	};
}

export function valueText(type: ColumnType, value: unknown): string {
	if (value === null || value === undefined) return "";
	if (type === "json") return JSON.stringify(value, null, 2);
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "string") return value;
	if (typeof value === "number") return value.toString();
	return JSON.stringify(value);
}

export function parseValue(
	type: ColumnType,
	text: string,
	name: string,
	t: DataConsoleMessages,
): unknown {
	if (type === "integer" || type === "number") {
		const number = Number(text.trim());
		if (!text.trim() || !Number.isFinite(number))
			throw new DraftError(t.database.invalidNumber(name));
		return number;
	}
	if (type === "boolean") return text === "true";
	if (type === "json") {
		try {
			const parsed: unknown = JSON.parse(text);
			return parsed;
		} catch {
			throw new DraftError(t.database.invalidJson(name));
		}
	}
	return text;
}

export function columnPayload(draft: ColumnDraft, t: DataConsoleMessages) {
	return {
		name: draft.name.trim(),
		type: draft.type,
		nullable: !draft.required,
		unique: draft.unique,
		indexed: draft.unique || draft.indexed,
		default:
			draft.hasDefault && !draft.unique
				? parseValue(draft.type, draft.defaultValue, draft.name || draft.type, t)
				: null,
	};
}

function isColumnType(value: string): value is ColumnType {
	return (COLUMN_TYPES as readonly string[]).includes(value);
}

export function ValueInput({
	type,
	label,
	value,
	nullable,
	onChange,
}: {
	type: ColumnType;
	label: string;
	value: string;
	nullable: boolean;
	onChange(value: string): void;
}) {
	const { t } = useDataConsoleI18n();
	if (type === "boolean")
		return (
			<Select
				label={label}
				className="w-full"
				value={value}
				onValueChange={(next) => {
					if (typeof next === "string") onChange(next);
				}}
				items={{
					...(nullable ? { "": t.database.nullValue } : {}),
					true: t.common.yes,
					false: t.common.no,
				}}
			/>
		);
	if (type === "json")
		return (
			<CodeField
				label={label}
				value={value}
				rows={4}
				onChange={onChange}
				description={nullable ? t.database.nullValue : undefined}
			/>
		);
	return (
		<SettingsTextField
			label={label}
			value={value}
			inputMode={type === "integer" || type === "number" ? "decimal" : undefined}
			placeholder={nullable ? t.database.nullValue : undefined}
			onChange={(event) => {
				onChange(event.target.value);
			}}
		/>
	);
}

export function ColumnFields({
	draft,
	editableIdentity,
	onChange,
}: {
	draft: ColumnDraft;
	editableIdentity: boolean;
	onChange(draft: ColumnDraft): void;
}) {
	const { t } = useDataConsoleI18n();
	const update = (patch: Partial<ColumnDraft>) => {
		onChange({ ...draft, ...patch });
	};
	return (
		<div className="space-y-3">
			{editableIdentity && (
				<>
					<SettingsTextField
						label={t.database.columnName}
						value={draft.name}
						autoComplete="off"
						onChange={(event) => {
							update({ name: event.target.value });
						}}
					/>
					<Select
						label={t.database.columnType}
						className="w-full"
						value={draft.type}
						onValueChange={(next) => {
							if (typeof next === "string" && isColumnType(next))
								update({
									type: next,
									defaultValue: next === "boolean" ? "false" : "",
								});
						}}
						items={Object.fromEntries(COLUMN_TYPES.map((type) => [type, t.database.types[type]]))}
					/>
				</>
			)}
			<SwitchField
				label={t.database.required}
				description={t.database.requiredHelp}
				checked={draft.required}
				onCheckedChange={(checked) => {
					update({ required: checked });
				}}
			/>
			<SwitchField
				label={t.database.unique}
				description={t.database.uniqueHelp}
				checked={draft.unique}
				onCheckedChange={(checked) => {
					update({ unique: checked, ...(checked ? { hasDefault: false } : {}) });
				}}
			/>
			{!draft.unique && (
				<SwitchField
					label={t.database.indexed}
					description={t.database.indexedHelp}
					checked={draft.indexed}
					onCheckedChange={(checked) => {
						update({ indexed: checked });
					}}
				/>
			)}
			{!draft.unique && (
				<SwitchField
					label={t.database.hasDefault}
					checked={draft.hasDefault}
					onCheckedChange={(checked) => {
						update({
							hasDefault: checked,
							defaultValue:
								draft.type === "boolean" && !draft.defaultValue ? "false" : draft.defaultValue,
						});
					}}
				/>
			)}
			{!draft.unique && draft.hasDefault && (
				<SettingsDependents>
					<ValueInput
						type={draft.type}
						label={t.database.defaultValue}
						value={draft.defaultValue}
						nullable={false}
						onChange={(value) => {
							update({ defaultValue: value });
						}}
					/>
					<p className="text-xs text-kumo-subtle">
						{t.database.defaultHelp(t.database.types[draft.type])}
					</p>
				</SettingsDependents>
			)}
		</div>
	);
}

export function ColumnsEditor({
	base,
	table,
	onChanged,
}: {
	base: string;
	table: Table;
	onChanged(table: Table): void;
}) {
	const { t } = useDataConsoleI18n();
	const action = useDataAction();
	const [editing, setEditing] = useState<ColumnDraft | null>(null);
	const [deleting, setDeleting] = useState<string | null>(null);
	const [adding, setAdding] = useState<ColumnDraft>(() => emptyColumn(nextColumnKey()));
	const [draftError, setDraftError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const tablePath = `${base}/tables/${encode(table.name)}`;
	const submit = (request: () => Promise<{ data: unknown }>, done: () => void) => {
		setMessage(null);
		action.run(async () => {
			const next = readBody<Table>(await request());
			done();
			setMessage(t.database.columnSaved);
			onChanged(next);
		});
	};
	const prepare = (draft: ColumnDraft) => {
		setDraftError(null);
		try {
			return columnPayload(draft, t);
		} catch (cause) {
			setDraftError(cause instanceof DraftError ? cause.message : t.errors.generic);
			return null;
		}
	};
	return (
		<div className="space-y-5">
			<p className="text-sm text-kumo-subtle">{t.database.systemColumns}</p>
			{table.columns.length === 0 && <Notice>{t.database.noColumns}</Notice>}
			<ul className="divide-y divide-kumo-line rounded-lg border border-kumo-line">
				{table.columns.map((column) => (
					<li key={column.name} className="space-y-3 p-4">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div className="flex flex-wrap items-center gap-2">
								<span className="font-mono text-sm font-medium">{column.name}</span>
								<Badge>{t.database.types[column.type]}</Badge>
								{!column.nullable && <Badge variant="info">{t.database.required}</Badge>}
								{column.unique && <Badge variant="info">{t.database.unique}</Badge>}
								{column.indexed && !column.unique && (
									<Badge variant="info">{t.database.indexed}</Badge>
								)}
								{column.default !== null && (
									<span className="text-xs text-kumo-subtle">
										{t.database.defaultIs(cellText(column.default, t))}
									</span>
								)}
							</div>
							<div className="flex gap-2">
								<Button
									type="button"
									variant="secondary"
									size="sm"
									aria-label={t.database.editColumn(column.name)}
									onClick={() => {
										setDeleting(null);
										setEditing(columnDraft(column));
									}}
								>
									{t.common.edit}
								</Button>
								<Button
									type="button"
									variant="secondary-destructive"
									size="sm"
									aria-label={t.database.deleteColumn(column.name)}
									onClick={() => {
										setEditing(null);
										setDeleting(column.name);
									}}
								>
									{t.common.delete}
								</Button>
							</div>
						</div>
						{editing?.name === column.name && (
							<form
								className="space-y-3"
								onSubmit={(event) => {
									event.preventDefault();
									const payload = prepare(editing);
									if (!payload) return;
									submit(
										() =>
											PATCH(`${tablePath}/columns/${encode(column.name)}`, {
												nullable: payload.nullable,
												unique: payload.unique,
												indexed: payload.indexed,
												default: payload.default,
											}),
										() => {
											setEditing(null);
										},
									);
								}}
							>
								<ColumnFields draft={editing} editableIdentity={false} onChange={setEditing} />
								<SettingsActions>
									<Button
										type="button"
										variant="secondary"
										onClick={() => {
											setEditing(null);
										}}
									>
										{t.common.cancel}
									</Button>
									<Button type="submit" variant="primary" disabled={action.busy}>
										{t.database.saveColumn}
									</Button>
								</SettingsActions>
							</form>
						)}
						{deleting === column.name && (
							<ConfirmPanel
								title={t.database.deleteColumn(column.name)}
								message={t.database.deleteColumnMessage(column.name)}
								confirmLabel={t.common.delete}
								busy={action.busy}
								onCancel={() => {
									setDeleting(null);
								}}
								onConfirm={() => {
									submit(
										() =>
											DELETE(
												`${tablePath}/columns/${encode(column.name)}?confirm=${encode(column.name)}`,
											),
										() => {
											setDeleting(null);
										},
									);
								}}
							/>
						)}
					</li>
				))}
			</ul>
			{draftError && <p role="alert">{draftError}</p>}
			<ErrorAlert error={action.error} />
			{message && <Notice>{message}</Notice>}
			<form
				className="space-y-3 rounded-lg border border-kumo-line p-4"
				onSubmit={(event) => {
					event.preventDefault();
					const payload = prepare(adding);
					if (!payload) return;
					submit(
						() => POST(`${tablePath}/columns`, payload),
						() => {
							setAdding(emptyColumn(nextColumnKey()));
						},
					);
				}}
			>
				<h2 className="text-base font-semibold">{t.database.addColumn}</h2>
				<ColumnFields draft={adding} editableIdentity onChange={setAdding} />
				<SettingsActions>
					<Button type="submit" variant="primary" disabled={action.busy || !adding.name.trim()}>
						{t.database.addColumn}
					</Button>
				</SettingsActions>
			</form>
		</div>
	);
}
