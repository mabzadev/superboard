import { Button, SwitchField } from "@superboard/front-ui/kumo";
import {
	AutosaveIndicator,
	SettingsActions,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
	useSettingsAutosave,
} from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import {
	Table as FrontTable,
	TableBody as FrontTableBody,
	TableCell as FrontTableCell,
	TableHead as FrontTableHead,
	TableHeader as FrontTableHeader,
	TableRow as FrontTableRow,
} from "@superboard/front-ui/ui/table.js";
import { useEffect, useState } from "react";

import { useDataPath, useDataResource } from "./resource.js";
import { DELETE, GET, PATCH, POST } from "./transport.js";
import {
	encode,
	physicalTableName,
	readBody,
	useAddressState,
	useDataAction,
	type DataStatus,
	type Page,
	type SqlResult,
	type Table,
	type TableRules,
} from "../console/client.js";
import {
	ColumnFields,
	ColumnsEditor,
	columnPayload,
	DraftError,
	emptyColumn,
	nextColumnKey,
	type ColumnDraft,
} from "./database-columns.js";
import { RowsBrowser } from "./database-rows.js";
import { useDataConsoleI18n } from "../console/i18n.js";
import {
	BackButton,
	cellText,
	ConfirmPanel,
	CopyButton,
	DataPage,
	ErrorAlert,
	isAccessRule,
	LoadState,
	Notice,
	RuleSelect,
	SectionTabs,
	StatusBadge,
	CodeField,
} from "../console/shared.js";

type TableTab = "rows" | "columns" | "access" | "advanced";
const tableTabs: readonly TableTab[] = ["rows", "columns", "access", "advanced"];

export default function DatabasePage() {
	const { t } = useDataConsoleI18n();
	const base = useDataPath();
	const [table, setTable] = useAddressState("table");
	const [section, setSection] = useAddressState("section");
	const status = useDataResource<DataStatus>(base && `${base}/status`);
	const projectId = status.data?.project_id ?? null;
	if (!base)
		return (
			<DataPage title={t.database.title} description={t.database.description}>
				<Notice>{t.common.noProject}</Notice>
			</DataPage>
		);
	if (table)
		return (
			<TableDetail
				key={table}
				base={base}
				name={table}
				projectId={projectId}
				onBack={() => {
					setTable(null, ["tab"]);
				}}
			/>
		);
	const current = section === "sql" ? "sql" : "tables";
	return (
		<DataPage title={t.database.title} description={t.database.description}>
			<SectionTabs
				tabs={[
					["tables", t.database.tablesTab],
					["sql", t.database.sqlTab],
				]}
				current={current}
				onChange={(next) => {
					setSection(next === "sql" ? "sql" : null);
				}}
			/>
			{current === "sql" ? (
				<SqlConsole base={base} projectId={projectId} />
			) : (
				<TablesOverview
					base={base}
					onOpen={(name) => {
						setTable(name, ["tab", "section"]);
					}}
				/>
			)}
		</DataPage>
	);
}

function useRowCounts(base: string, tables: Table[] | undefined) {
	const [counts, setCounts] = useState<{
		source: Table[];
		values: Record<string, number | null>;
	} | null>(null);
	useEffect(() => {
		if (!tables?.length) return;
		let active = true;
		const load = async () => {
			const entries = await Promise.all(
				tables.map(async (table) => {
					try {
						const response = await GET(`${base}/tables/${encode(table.name)}`);
						return [table.name, readBody<Table>(response).row_count ?? null] as const;
					} catch {
						return [table.name, null] as const;
					}
				}),
			);
			if (active) setCounts({ source: tables, values: Object.fromEntries(entries) });
		};
		load().catch(() => undefined);
		return () => {
			active = false;
		};
	}, [base, tables]);
	return counts && counts.source === tables ? counts.values : null;
}

function TablesOverview({ base, onOpen }: { base: string; onOpen(name: string): void }) {
	const { t, locale } = useDataConsoleI18n();
	const tables = useDataResource<Page<Table>>(`${base}/tables`);
	const counts = useRowCounts(base, tables.data?.items);
	return (
		<div className="space-y-6">
			<LoadState
				loading={tables.loading && !tables.data}
				error={tables.error}
				onRetry={tables.refresh}
			/>
			{tables.data && tables.data.items.length === 0 && <Notice>{t.database.noTables}</Notice>}
			{tables.data && tables.data.items.length > 0 && (
				<FrontTable>
					<FrontTableHeader>
						<FrontTableRow>
							<FrontTableHead>{t.common.name}</FrontTableHead>
							<FrontTableHead>{t.database.columns}</FrontTableHead>
							<FrontTableHead>{t.database.rows}</FrontTableHead>
							<FrontTableHead>{t.database.realtime}</FrontTableHead>
						</FrontTableRow>
					</FrontTableHeader>
					<FrontTableBody>
						{tables.data.items.map((table) => {
							const count = counts?.[table.name];
							return (
								<FrontTableRow key={table.name}>
									<FrontTableCell>
										<Button
											type="button"
											variant="ghost"
											onClick={() => {
												onOpen(table.name);
											}}
										>
											{table.name}
										</Button>
										{table.label && (
											<span className="ms-2 text-sm text-kumo-subtle">{table.label}</span>
										)}
									</FrontTableCell>
									<FrontTableCell>{table.columns.length.toLocaleString(locale)}</FrontTableCell>
									<FrontTableCell>
										{count === undefined || count === null ? "—" : count.toLocaleString(locale)}
									</FrontTableCell>
									<FrontTableCell>
										<StatusBadge state={table.realtime ? "enabled" : "disabled"} />
									</FrontTableCell>
								</FrontTableRow>
							);
						})}
					</FrontTableBody>
				</FrontTable>
			)}
			<CreateTableForm
				base={base}
				onCreated={(name) => {
					tables.refresh();
					onOpen(name);
				}}
			/>
		</div>
	);
}

function CreateTableForm({ base, onCreated }: { base: string; onCreated(name: string): void }) {
	const { t } = useDataConsoleI18n();
	const action = useDataAction();
	const [name, setName] = useState("");
	const [label, setLabel] = useState("");
	const [columns, setColumns] = useState<ColumnDraft[]>(() => [emptyColumn(nextColumnKey())]);
	const [invalid, setInvalid] = useState<string | null>(null);
	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				setInvalid(null);
				let payload;
				try {
					payload = {
						name: name.trim(),
						label: label.trim() || null,
						columns: columns
							.filter((draft) => draft.name.trim())
							.map((draft) => columnPayload(draft, t)),
					};
				} catch (cause) {
					setInvalid(cause instanceof DraftError ? cause.message : t.errors.generic);
					return;
				}
				action.run(async () => {
					const created = readBody<Table>(await POST(`${base}/tables`, payload));
					onCreated(created.name);
				});
			}}
		>
			<SettingsSection title={t.database.createTitle} description={t.database.createDescription}>
				<SettingsRow>
					<SettingsTextField
						label={t.database.tableName}
						description={t.database.tableNameHelp}
						value={name}
						autoComplete="off"
						required
						onChange={(event) => {
							setName(event.target.value);
						}}
					/>
					<SettingsTextField
						label={t.database.tableLabel}
						value={label}
						onChange={(event) => {
							setLabel(event.target.value);
						}}
					/>
				</SettingsRow>
				{columns.map((draft, index) => (
					<SettingsRow key={draft.key}>
						<ColumnFields
							draft={draft}
							editableIdentity
							onChange={(next) => {
								setColumns((current) =>
									current.map((candidate) => (candidate.key === draft.key ? next : candidate)),
								);
							}}
						/>
						{columns.length > 1 && (
							<SettingsActions>
								<Button
									type="button"
									variant="secondary"
									size="sm"
									aria-label={t.database.removeColumnNumber(index + 1)}
									onClick={() => {
										setColumns((current) =>
											current.filter((candidate) => candidate.key !== draft.key),
										);
									}}
								>
									{t.database.removeColumn}
								</Button>
							</SettingsActions>
						)}
					</SettingsRow>
				))}
				<SettingsRow>
					<SettingsActions>
						<Button
							type="button"
							variant="secondary"
							onClick={() => {
								setColumns((current) => [...current, emptyColumn(nextColumnKey())]);
							}}
						>
							{t.database.addColumn}
						</Button>
					</SettingsActions>
				</SettingsRow>
			</SettingsSection>
			{invalid && <p role="alert">{invalid}</p>}
			<ErrorAlert error={action.error} />
			<SettingsActions>
				<Button type="submit" variant="primary" disabled={action.busy || !name.trim()}>
					{t.database.createTable}
				</Button>
			</SettingsActions>
		</form>
	);
}

function TableDetail({
	base,
	name,
	projectId,
	onBack,
}: {
	base: string;
	name: string;
	projectId: number | null;
	onBack(): void;
}) {
	const { t } = useDataConsoleI18n();
	const [tabParameter, setTab] = useAddressState("tab");
	const resource = useDataResource<Table>(`${base}/tables/${encode(name)}`);
	const current = resource.data;
	const tab: TableTab = tableTabs.find((candidate) => candidate === tabParameter) ?? "rows";
	return (
		<DataPage title={name} description={current?.label ?? t.database.description}>
			<div>
				<BackButton label={t.database.backToTables} onClick={onBack} />
			</div>
			<LoadState
				loading={resource.loading && !resource.data}
				error={resource.error}
				onRetry={resource.refresh}
			/>
			{current && (
				<>
					<div className="flex flex-wrap items-center gap-2">
						{current.row_count !== undefined && (
							<Badge>{t.database.rowCount(current.row_count)}</Badge>
						)}
						<span className="text-sm text-kumo-subtle">{t.database.realtime}</span>
						<StatusBadge state={current.realtime ? "enabled" : "disabled"} />
					</div>
					<SectionTabs
						tabs={[
							["rows", t.database.rows],
							["columns", t.database.columns],
							["access", t.database.access],
							["advanced", t.common.advanced],
						]}
						current={tab}
						onChange={(next) => {
							setTab(next === "rows" ? null : next);
						}}
					/>
					{tab === "rows" && (
						<RowsBrowser base={base} table={current} onChanged={resource.refresh} />
					)}
					{tab === "columns" && (
						<ColumnsEditor base={base} table={current} onChanged={resource.refresh} />
					)}
					{tab === "access" && <AccessSettings base={base} table={current} />}
					{tab === "advanced" && (
						<TableAdvanced base={base} table={current} projectId={projectId} onDeleted={onBack} />
					)}
				</>
			)}
		</DataPage>
	);
}

function AccessSettings({ base, table }: { base: string; table: Table }) {
	const { t } = useDataConsoleI18n();
	const [value, setValue] = useState({ rules: table.rules, realtime: table.realtime });
	const autosave = useSettingsAutosave({
		resourceKey: table.name,
		value,
		save: async (next) => {
			await PATCH(`${base}/tables/${encode(table.name)}`, next);
		},
	});
	const operations = ["read", "insert", "update", "delete"] as const;
	return (
		<div className="space-y-5">
			<SettingsSection title={t.database.accessTitle} description={t.database.accessDescription}>
				{operations.map((operation) => (
					<SettingsRow key={operation}>
						<RuleSelect
							label={t.common.ruleNames[operation]}
							value={value.rules[operation]}
							onChange={(rule) => {
								if (!isAccessRule(rule)) return;
								setValue((current) => ({
									...current,
									rules: { ...current.rules, [operation]: rule } satisfies TableRules,
								}));
							}}
						/>
					</SettingsRow>
				))}
			</SettingsSection>
			<SettingsSection title={t.database.realtime}>
				<SettingsRow>
					<SwitchField
						label={t.database.realtimeLabel}
						description={t.database.realtimeHelp}
						trailing={<StatusBadge state={value.realtime ? "enabled" : "disabled"} />}
						checked={value.realtime}
						onCheckedChange={(checked) => {
							setValue((current) => ({ ...current, realtime: checked }));
						}}
					/>
				</SettingsRow>
			</SettingsSection>
			<AutosaveIndicator status={autosave.status} onRetry={autosave.retry} />
		</div>
	);
}

function TableAdvanced({
	base,
	table,
	projectId,
	onDeleted,
}: {
	base: string;
	table: Table;
	projectId: number | null;
	onDeleted(): void;
}) {
	const { t } = useDataConsoleI18n();
	const action = useDataAction();
	const [confirming, setConfirming] = useState(false);
	const sqlName = projectId === null ? null : physicalTableName(projectId, table.name);
	return (
		<div className="space-y-5">
			{sqlName && (
				<SettingsSection title={t.database.sqlName} description={t.database.sqlNameHelp}>
					<SettingsRow className="flex flex-wrap items-center justify-between gap-3 space-y-0">
						<code className="font-mono text-sm">{sqlName}</code>
						<CopyButton value={sqlName} />
					</SettingsRow>
				</SettingsSection>
			)}
			<SettingsSection title={t.database.deleteTable}>
				<SettingsRow>
					<p className="text-sm">{t.database.deleteTableMessage(table.name)}</p>
					{confirming ? (
						<ConfirmPanel
							title={t.database.deleteTable}
							message={t.database.deleteTableMessage(table.name)}
							expected={table.name}
							confirmLabel={t.database.deleteTable}
							busy={action.busy}
							onCancel={() => {
								setConfirming(false);
							}}
							onConfirm={() => {
								action.run(async () => {
									await DELETE(
										`${base}/tables/${encode(table.name)}?confirm=${encode(table.name)}`,
									);
									onDeleted();
								});
							}}
						/>
					) : (
						<SettingsActions>
							<Button
								type="button"
								variant="destructive"
								onClick={() => {
									setConfirming(true);
								}}
							>
								{t.database.deleteTable}
							</Button>
						</SettingsActions>
					)}
					<ErrorAlert error={action.error} />
				</SettingsRow>
			</SettingsSection>
		</div>
	);
}

interface SqlTable {
	columns: { key: string; name: string }[];
	rows: { key: string; cells: { key: string; value: unknown }[] }[];
	truncated: boolean;
}

function sqlTable(result: SqlResult): SqlTable {
	const columns = result.columns.map((name, position) => ({ key: `${position}:${name}`, name }));
	return {
		columns,
		rows: result.rows.map((values, position) => ({
			key: `row-${position}`,
			cells: columns.map((header, cell) => ({ key: header.key, value: values[cell] })),
		})),
		truncated: result.truncated,
	};
}

function SqlConsole({ base, projectId }: { base: string; projectId: number | null }) {
	const { t } = useDataConsoleI18n();
	const action = useDataAction();
	const [query, setQuery] = useState("");
	const [result, setResult] = useState<SqlTable | null>(null);
	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				action.run(async () => {
					setResult(null);
					setResult(sqlTable(readBody<SqlResult>(await POST(`${base}/sql`, { query }))));
				});
			}}
		>
			<SettingsSection
				title={t.database.sqlTitle}
				description={t.database.sqlDescription(`adb_${projectId ?? "<id>"}_<table>`)}
			>
				<SettingsRow>
					<CodeField label={t.database.sqlQuery} value={query} rows={6} onChange={setQuery} />
				</SettingsRow>
			</SettingsSection>
			<SettingsActions>
				<Button type="submit" variant="primary" disabled={action.busy || !query.trim()}>
					{t.database.runQuery}
				</Button>
			</SettingsActions>
			<ErrorAlert error={action.error} />
			{result && result.rows.length === 0 && <Notice>{t.database.noResult}</Notice>}
			{result && result.rows.length > 0 && (
				<div className="overflow-x-auto">
					<FrontTable>
						<FrontTableHeader>
							<FrontTableRow>
								{result.columns.map((header) => (
									<FrontTableHead key={header.key} className="font-mono">
										{header.name}
									</FrontTableHead>
								))}
							</FrontTableRow>
						</FrontTableHeader>
						<FrontTableBody>
							{result.rows.map((row) => (
								<FrontTableRow key={row.key}>
									{row.cells.map((cell) => (
										<FrontTableCell key={cell.key}>{cellText(cell.value, t)}</FrontTableCell>
									))}
								</FrontTableRow>
							))}
						</FrontTableBody>
					</FrontTable>
				</div>
			)}
			{result?.truncated && <Notice>{t.database.truncated}</Notice>}
		</form>
	);
}
