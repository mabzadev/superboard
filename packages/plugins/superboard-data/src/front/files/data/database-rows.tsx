import { Button } from "@superboard/front-ui/kumo";
import { SettingsActions, SettingsTextField } from "@superboard/front-ui/settings-form";
import {
	Table as FrontTable,
	TableBody as FrontTableBody,
	TableCell as FrontTableCell,
	TableHead as FrontTableHead,
	TableHeader as FrontTableHeader,
	TableRow as FrontTableRow,
} from "@superboard/front-ui/ui/table.js";
import { useState } from "react";

import { DELETE, PATCH, POST } from "../transport.js";
import {
	encode,
	useDataAction,
	useDataResource,
	type Page,
	type Row,
	type Table,
} from "./client.js";
import { DraftError, parseValue, valueText, ValueInput } from "./database-columns.js";
import { useDataConsoleI18n } from "./i18n.js";
import { cellText, ConfirmPanel, ErrorAlert, LoadState, Notice, Pager } from "./shared.js";

type Drafts = Record<string, string>;

function rowId(row: Row): string {
	return typeof row.id === "string" ? row.id : "";
}

function draftsFor(table: Table, row: Row | null): Drafts {
	const drafts: Drafts = {
		owner_id: typeof row?.owner_id === "string" ? row.owner_id : "",
	};
	for (const column of table.columns)
		drafts[column.name] = row
			? valueText(column.type, row[column.name])
			: column.type === "boolean" && !column.nullable
				? "false"
				: "";
	return drafts;
}

export function RowsBrowser({
	base,
	table,
	onChanged,
}: {
	base: string;
	table: Table;
	onChanged(): void;
}) {
	const { t } = useDataConsoleI18n();
	const [cursors, setCursors] = useState<string[]>([]);
	const [editing, setEditing] = useState<Row | "new" | null>(null);
	const [deleting, setDeleting] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const action = useDataAction();
	const tablePath = `${base}/tables/${encode(table.name)}`;
	const query = new URLSearchParams({ limit: "50", count: "exact" });
	const cursor = cursors.at(-1);
	if (cursor) query.set("cursor", cursor);
	const rows = useDataResource<Page<Row>>(`${tablePath}/rows?${query}`);
	const columns = ["id", ...table.columns.map((column) => column.name), "owner_id", "created_at"];
	const changed = (text: string) => {
		setMessage(text);
		rows.refresh();
		onChanged();
	};
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-sm text-kumo-subtle">
					{rows.data?.count === undefined ? "" : t.database.rowCount(rows.data.count)}
				</p>
				<Button
					type="button"
					variant="primary"
					onClick={() => {
						setMessage(null);
						setEditing("new");
					}}
				>
					{t.database.addRow}
				</Button>
			</div>
			{editing && (
				<RowEditor
					key={editing === "new" ? "new" : rowId(editing)}
					table={table}
					row={editing === "new" ? null : editing}
					onCancel={() => {
						setEditing(null);
					}}
					onSave={(body) => {
						action.run(async () => {
							if (editing === "new") await POST(`${tablePath}/rows`, body);
							else await PATCH(`${tablePath}/rows/${encode(rowId(editing))}`, body);
							setEditing(null);
							changed(t.database.rowSaved);
						});
					}}
					busy={action.busy}
				/>
			)}
			{deleting && (
				<ConfirmPanel
					title={t.database.deleteRow}
					message={t.database.deleteRowMessage(deleting)}
					confirmLabel={t.common.delete}
					busy={action.busy}
					onCancel={() => {
						setDeleting(null);
					}}
					onConfirm={() => {
						action.run(async () => {
							await DELETE(`${tablePath}/rows/${encode(deleting)}`);
							setDeleting(null);
							changed(t.database.rowDeleted);
						});
					}}
				/>
			)}
			<ErrorAlert error={action.error} />
			{message && <Notice>{message}</Notice>}
			<LoadState loading={rows.loading && !rows.data} error={rows.error} onRetry={rows.refresh} />
			{rows.data && rows.data.items.length === 0 && <Notice>{t.database.noRows}</Notice>}
			{rows.data && rows.data.items.length > 0 && (
				<div className="overflow-x-auto">
					<FrontTable>
						<FrontTableHeader>
							<FrontTableRow>
								{columns.map((name) => (
									<FrontTableHead key={name} className="font-mono">
										{name}
									</FrontTableHead>
								))}
								<FrontTableHead>{t.common.actions}</FrontTableHead>
							</FrontTableRow>
						</FrontTableHeader>
						<FrontTableBody>
							{rows.data.items.map((row) => (
								<FrontTableRow key={rowId(row)}>
									{columns.map((name) => (
										<FrontTableCell key={name} className="max-w-xs truncate">
											{cellText(row[name], t)}
										</FrontTableCell>
									))}
									<FrontTableCell>
										<div className="flex gap-2">
											<Button
												type="button"
												variant="secondary"
												size="sm"
												onClick={() => {
													setDeleting(null);
													setMessage(null);
													setEditing(row);
												}}
											>
												{t.common.edit}
											</Button>
											<Button
												type="button"
												variant="secondary-destructive"
												size="sm"
												onClick={() => {
													setEditing(null);
													setMessage(null);
													setDeleting(rowId(row));
												}}
											>
												{t.common.delete}
											</Button>
										</div>
									</FrontTableCell>
								</FrontTableRow>
							))}
						</FrontTableBody>
					</FrontTable>
				</div>
			)}
			<Pager
				hasPrevious={cursors.length > 0}
				next={rows.data?.nextCursor}
				onFirst={() => {
					setCursors([]);
				}}
				onNext={(next) => {
					setCursors((current) => [...current, next]);
				}}
			/>
		</div>
	);
}

function RowEditor({
	table,
	row,
	busy,
	onCancel,
	onSave,
}: {
	table: Table;
	row: Row | null;
	busy: boolean;
	onCancel(): void;
	onSave(body: Record<string, unknown>): void;
}) {
	const { t } = useDataConsoleI18n();
	const [initial] = useState(() => draftsFor(table, row));
	const [drafts, setDrafts] = useState(initial);
	const [invalid, setInvalid] = useState<string | null>(null);
	const body = () => {
		const output: Record<string, unknown> = {};
		for (const column of table.columns) {
			const text = drafts[column.name] ?? "";
			if (row && text === initial[column.name]) continue;
			if (text === "") {
				if (row) output[column.name] = null;
				continue;
			}
			output[column.name] = parseValue(column.type, text, column.name, t);
		}
		const owner = (drafts.owner_id ?? "").trim();
		if (!row && owner) output.owner_id = owner;
		if (row && owner !== initial.owner_id) output.owner_id = owner || null;
		return output;
	};
	return (
		<form
			className="space-y-3 rounded-lg border border-kumo-line p-4"
			onSubmit={(event) => {
				event.preventDefault();
				setInvalid(null);
				try {
					const payload = body();
					if (row && Object.keys(payload).length === 0) {
						onCancel();
						return;
					}
					onSave(payload);
				} catch (cause) {
					setInvalid(cause instanceof DraftError ? cause.message : t.errors.generic);
				}
			}}
		>
			<h2 className="text-base font-semibold">{row ? t.database.editRow : t.database.addRow}</h2>
			{table.columns.map((column) => (
				<ValueInput
					key={column.name}
					type={column.type}
					label={column.name}
					value={drafts[column.name] ?? ""}
					nullable={column.nullable || (!row && column.default !== null)}
					onChange={(value) => {
						setDrafts((current) => ({ ...current, [column.name]: value }));
					}}
				/>
			))}
			<SettingsTextField
				label={t.database.owner}
				description={t.database.ownerHelp}
				value={drafts.owner_id ?? ""}
				autoComplete="off"
				onChange={(event) => {
					setDrafts((current) => ({ ...current, owner_id: event.target.value }));
				}}
			/>
			{invalid && <p role="alert">{invalid}</p>}
			<SettingsActions>
				<Button type="button" variant="secondary" onClick={onCancel}>
					{t.common.cancel}
				</Button>
				<Button type="submit" variant="primary" disabled={busy}>
					{row ? t.database.saveRow : t.database.insertRow}
				</Button>
			</SettingsActions>
		</form>
	);
}
