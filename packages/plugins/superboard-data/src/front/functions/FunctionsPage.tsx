import { Button, Select, SwitchField } from "@superboard/front-ui/kumo";
import {
	AutosaveIndicator,
	SettingsActions,
	SettingsDependents,
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
import { useState } from "react";

import { useDataPath, useDataResource } from "./resource.js";
import { DELETE, POST, PUT } from "./transport.js";
import {
	encode,
	FUNCTION_ACCESS,
	readBody,
	useAddressState,
	useDataAction,
	type DataFunction,
	type DataStatus,
	type FunctionAccess,
	type FunctionDetails,
	type FunctionLog,
	type FunctionRun,
	type InvocationResult,
	type Page,
} from "../console/client.js";
import { useDataConsoleI18n } from "../console/i18n.js";
import {
	BackButton,
	CodeBlock,
	ConfirmPanel,
	DataPage,
	ErrorAlert,
	formatDate,
	LoadState,
	Notice,
	RuleSelect,
	SectionTabs,
	StatusBadge,
	type FeatureState,
	CodeField,
} from "../console/shared.js";

const template = `export default {
	async fetch(request, env) {
		console.log(request.method, new URL(request.url).pathname);
		return Response.json({ ok: true });
	},
};
`;
const variablePattern = /^[A-Z][A-Z0-9_]{0,63}$/u;
const reservedVariables = new Set(["SUPERBOARD_API_URL", "SUPERBOARD_PROJECT_ID"]);
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function isFunctionAccess(value: string): value is FunctionAccess {
	return (FUNCTION_ACCESS as readonly string[]).includes(value);
}

function validVariableName(name: string): boolean {
	return variablePattern.test(name) && !reservedVariables.has(name);
}

export function functionState(
	definition: DataFunction,
	features: DataStatus["features"] | undefined,
): FeatureState {
	if (features && !features.functions) return "unavailable";
	if (definition.secret_names.length > 0 && features && !features.function_secrets)
		return "secretMissing";
	return definition.active_version === null ? "incomplete" : "enabled";
}

export default function FunctionsPage() {
	const { t } = useDataConsoleI18n();
	const base = useDataPath();
	const [selected, setSelected] = useAddressState("function");
	const status = useDataResource<DataStatus>(base && `${base}/status`);
	const features = status.data?.features;
	if (!base)
		return (
			<DataPage title={t.functions.title} description={t.functions.description}>
				<Notice>{t.common.noProject}</Notice>
			</DataPage>
		);
	if (selected)
		return (
			<FunctionDetail
				key={selected}
				base={base}
				name={selected}
				features={features}
				onBack={() => {
					setSelected(null, ["tab"]);
				}}
			/>
		);
	return (
		<DataPage title={t.functions.title} description={t.functions.description}>
			{features && !features.functions && (
				<div className="flex flex-wrap items-center gap-2">
					<StatusBadge state="unavailable" />
					<Notice>{t.functions.unavailable}</Notice>
				</div>
			)}
			<FunctionsOverview
				base={base}
				features={features}
				onOpen={(name) => {
					setSelected(name, ["tab"]);
				}}
			/>
		</DataPage>
	);
}

function FunctionsOverview({
	base,
	features,
	onOpen,
}: {
	base: string;
	features: DataStatus["features"] | undefined;
	onOpen(name: string): void;
}) {
	const { t } = useDataConsoleI18n();
	const functions = useDataResource<Page<DataFunction>>(`${base}/functions`);
	return (
		<div className="space-y-6">
			<LoadState
				loading={functions.loading && !functions.data}
				error={functions.error}
				onRetry={functions.refresh}
			/>
			{functions.data && functions.data.items.length === 0 && (
				<Notice>{t.functions.noFunctions}</Notice>
			)}
			{functions.data && functions.data.items.length > 0 && (
				<FrontTable>
					<FrontTableHeader>
						<FrontTableRow>
							<FrontTableHead>{t.common.name}</FrontTableHead>
							<FrontTableHead>{t.functions.access}</FrontTableHead>
							<FrontTableHead>{t.functions.version}</FrontTableHead>
							<FrontTableHead>{t.functions.scheduleTab}</FrontTableHead>
						</FrontTableRow>
					</FrontTableHeader>
					<FrontTableBody>
						{functions.data.items.map((definition) => (
							<FrontTableRow key={definition.name}>
								<FrontTableCell>
									<div className="flex flex-wrap items-center gap-2">
										<Button
											type="button"
											variant="ghost"
											onClick={() => {
												onOpen(definition.name);
											}}
										>
											{definition.name}
										</Button>
										<StatusBadge state={functionState(definition, features)} />
									</div>
								</FrontTableCell>
								<FrontTableCell>{t.functions.accessNames[definition.access]}</FrontTableCell>
								<FrontTableCell>
									{definition.active_version === null
										? t.functions.noVersion
										: t.functions.versionLabel(definition.active_version)}
								</FrontTableCell>
								<FrontTableCell>
									{definition.schedule ? (
										<Badge variant="info">{definition.schedule.cron}</Badge>
									) : (
										"—"
									)}
								</FrontTableCell>
							</FrontTableRow>
						))}
					</FrontTableBody>
				</FrontTable>
			)}
			<CreateFunctionForm
				base={base}
				onCreated={(name) => {
					functions.refresh();
					onOpen(name);
				}}
			/>
		</div>
	);
}

function CreateFunctionForm({ base, onCreated }: { base: string; onCreated(name: string): void }) {
	const { t } = useDataConsoleI18n();
	const action = useDataAction();
	const [name, setName] = useState("");
	const [access, setAccess] = useState<FunctionAccess>("authenticated");
	const [source, setSource] = useState(template);
	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				const functionName = name.trim();
				action.run(async () => {
					await PUT(`${base}/functions/${encode(functionName)}`, { source, access });
					onCreated(functionName);
				});
			}}
		>
			<SettingsSection title={t.functions.createTitle}>
				<SettingsRow>
					<SettingsTextField
						label={t.functions.functionName}
						description={t.functions.functionNameHelp}
						value={name}
						autoComplete="off"
						required
						onChange={(event) => {
							setName(event.target.value);
						}}
					/>
					<RuleSelect
						label={t.functions.access}
						value={access}
						choices={FUNCTION_ACCESS}
						names={t.functions.accessNames}
						onChange={(next) => {
							if (isFunctionAccess(next)) setAccess(next);
						}}
					/>
				</SettingsRow>
				<SettingsRow>
					<CodeField
						label={t.functions.source}
						description={t.functions.sourceHelp}
						value={source}
						onChange={setSource}
					/>
				</SettingsRow>
			</SettingsSection>
			<ErrorAlert error={action.error} />
			<SettingsActions>
				<Button type="submit" variant="primary" disabled={action.busy || !name.trim()}>
					{t.functions.deploy}
				</Button>
			</SettingsActions>
		</form>
	);
}

type FunctionTab = "code" | "test" | "runs" | "schedule" | "settings" | "advanced";
const functionTabs: readonly FunctionTab[] = [
	"code",
	"test",
	"runs",
	"schedule",
	"settings",
	"advanced",
];

function FunctionDetail({
	base,
	name,
	features,
	onBack,
}: {
	base: string;
	name: string;
	features: DataStatus["features"] | undefined;
	onBack(): void;
}) {
	const { t } = useDataConsoleI18n();
	const [tabParameter, setTab] = useAddressState("tab");
	const details = useDataResource<FunctionDetails>(`${base}/functions/${encode(name)}`);
	const tab = functionTabs.find((candidate) => candidate === tabParameter) ?? "code";
	const path = `${base}/functions/${encode(name)}`;
	const definition = details.data;
	return (
		<DataPage title={name} description={t.functions.description}>
			<div>
				<BackButton label={t.functions.backToFunctions} onClick={onBack} />
			</div>
			<LoadState
				loading={details.loading && !details.data}
				error={details.error}
				onRetry={details.refresh}
			/>
			{definition && (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<StatusBadge state={functionState(definition, features)} />
						<Badge>
							{definition.active_version === null
								? t.functions.noVersion
								: t.functions.versionLabel(definition.active_version)}
						</Badge>
						{definition.schedule && <Badge variant="info">{t.functions.scheduled}</Badge>}
					</div>
					<SectionTabs
						tabs={[
							["code", t.functions.codeTab],
							["test", t.functions.testTab],
							["runs", t.functions.runsTab],
							["schedule", t.functions.scheduleTab],
							["settings", t.functions.settingsTab],
							["advanced", t.common.advanced],
						]}
						current={tab}
						onChange={(next) => {
							setTab(next === "code" ? null : next);
						}}
					/>
					{tab === "code" && (
						<CodeTab path={path} definition={definition} onChanged={details.refresh} />
					)}
					{tab === "test" && <TestTab path={path} />}
					{tab === "runs" && <RunsTab path={path} />}
					{tab === "schedule" && (
						<ScheduleTab path={path} definition={definition} onChanged={details.refresh} />
					)}
					{tab === "settings" && (
						<SettingsTab
							path={path}
							definition={definition}
							secretsAvailable={features?.function_secrets !== false}
							onChanged={details.refresh}
						/>
					)}
					{tab === "advanced" && (
						<AdvancedTab path={path} definition={definition} onDeleted={onBack} />
					)}
				</>
			)}
		</DataPage>
	);
}

function CodeTab({
	path,
	definition,
	onChanged,
}: {
	path: string;
	definition: FunctionDetails;
	onChanged(): void;
}) {
	const { t, locale } = useDataConsoleI18n();
	const action = useDataAction();
	const [source, setSource] = useState(definition.source ?? template);
	const [message, setMessage] = useState<string | null>(null);
	return (
		<div className="space-y-5">
			<form
				className="space-y-3"
				onSubmit={(event) => {
					event.preventDefault();
					setMessage(null);
					action.run(async () => {
						const deployed = readBody<DataFunction>(await PUT(path, { source }));
						if (deployed.active_version !== null)
							setMessage(t.functions.deployed(deployed.active_version));
						onChanged();
					});
				}}
			>
				<CodeField
					label={t.functions.source}
					description={t.functions.sourceHelp}
					value={source}
					rows={18}
					onChange={setSource}
				/>
				<ErrorAlert error={action.error} />
				{message && <Notice>{message}</Notice>}
				<SettingsActions>
					<Button type="submit" variant="primary" disabled={action.busy || !source.trim()}>
						{t.functions.deploy}
					</Button>
				</SettingsActions>
			</form>
			{definition.versions.length > 0 && (
				<section className="space-y-3">
					<h2 className="text-base font-semibold">{t.functions.versions}</h2>
					<FrontTable>
						<FrontTableHeader>
							<FrontTableRow>
								<FrontTableHead>{t.functions.version}</FrontTableHead>
								<FrontTableHead>{t.common.created}</FrontTableHead>
								<FrontTableHead>{t.common.actions}</FrontTableHead>
							</FrontTableRow>
						</FrontTableHeader>
						<FrontTableBody>
							{definition.versions.map((version) => (
								<FrontTableRow key={version.version}>
									<FrontTableCell>{t.functions.versionLabel(version.version)}</FrontTableCell>
									<FrontTableCell>{formatDate(version.created_at, locale)}</FrontTableCell>
									<FrontTableCell>
										{version.version === definition.active_version ? (
											<Badge variant="success">{t.functions.activeVersion}</Badge>
										) : (
											<Button
												type="button"
												variant="secondary"
												size="sm"
												disabled={action.busy}
												aria-label={t.functions.rollbackVersion(version.version)}
												onClick={() => {
													setMessage(null);
													action.run(async () => {
														await POST(`${path}/rollback`, { version: version.version });
														setMessage(t.functions.rolledBack(version.version));
														onChanged();
													});
												}}
											>
												{t.functions.rollback}
											</Button>
										)}
									</FrontTableCell>
								</FrontTableRow>
							))}
						</FrontTableBody>
					</FrontTable>
				</section>
			)}
		</div>
	);
}

function LogList({ logs }: { logs: FunctionLog[] }) {
	const { t, locale } = useDataConsoleI18n();
	if (logs.length === 0) return <p className="text-sm text-kumo-subtle">{t.functions.noLogs}</p>;
	const entries = logs.map((entry, position) => ({ ...entry, key: `log-${position}` }));
	return (
		<ol className="space-y-1 rounded-lg border border-kumo-line p-3 font-mono text-xs">
			{entries.map((entry) => (
				<li key={entry.key} className="break-all">
					<span className="text-kumo-subtle">{formatDate(entry.at, locale)}</span>{" "}
					<span className={entry.level === "error" ? "text-kumo-danger" : undefined}>
						[{entry.level}]
					</span>{" "}
					{entry.message}
				</li>
			))}
		</ol>
	);
}

function TestTab({ path }: { path: string }) {
	const { t } = useDataConsoleI18n();
	const action = useDataAction();
	const [method, setMethod] = useState<(typeof methods)[number]>("POST");
	const [requestPath, setRequestPath] = useState("/");
	const [body, setBody] = useState("{}");
	const [result, setResult] = useState<InvocationResult | null>(null);
	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				action.run(async () => {
					setResult(null);
					setResult(
						readBody<InvocationResult>(
							await POST(`${path}/invoke`, {
								method,
								path: requestPath || "/",
								...(method === "GET" || !body.trim() ? {} : { body }),
							}),
						),
					);
				});
			}}
		>
			<SettingsSection title={t.functions.testTab}>
				<SettingsRow>
					<Select
						label={t.functions.method}
						className="w-full"
						value={method}
						onValueChange={(next) => {
							const selected = methods.find((candidate) => candidate === next);
							if (selected) setMethod(selected);
						}}
						items={Object.fromEntries(methods.map((candidate) => [candidate, candidate]))}
					/>
					<SettingsTextField
						label={t.functions.requestPath}
						value={requestPath}
						onChange={(event) => {
							setRequestPath(event.target.value);
						}}
					/>
					{method !== "GET" && (
						<CodeField
							label={t.functions.requestBody}
							description={t.functions.requestBodyHelp}
							value={body}
							rows={6}
							onChange={setBody}
						/>
					)}
				</SettingsRow>
			</SettingsSection>
			<SettingsActions>
				<Button type="submit" variant="primary" disabled={action.busy}>
					{t.functions.invoke}
				</Button>
			</SettingsActions>
			<ErrorAlert error={action.error} />
			{result && (
				<section className="space-y-3" aria-label={t.functions.response}>
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-sm font-medium">{t.functions.status}</span>
						<Badge variant={result.status < 400 ? "success" : "warning"}>{result.status}</Badge>
						<span className="text-sm text-kumo-subtle">{t.functions.took(result.duration_ms)}</span>
					</div>
					<h3 className="text-sm font-semibold">{t.functions.response}</h3>
					<CodeBlock>{result.body}</CodeBlock>
					<h3 className="text-sm font-semibold">{t.functions.logs}</h3>
					<LogList logs={result.logs} />
				</section>
			)}
		</form>
	);
}

function RunsTab({ path }: { path: string }) {
	const { t, locale } = useDataConsoleI18n();
	const runs = useDataResource<Page<FunctionRun>>(`${path}/runs?limit=50`);
	const triggers: Record<string, string> = t.functions.triggers;
	const [opened, setOpened] = useState<string | null>(null);
	return (
		<div className="space-y-4">
			<LoadState loading={runs.loading && !runs.data} error={runs.error} onRetry={runs.refresh} />
			{runs.data && runs.data.items.length === 0 && <Notice>{t.functions.noRuns}</Notice>}
			{runs.data && runs.data.items.length > 0 && (
				<ul className="divide-y divide-kumo-line rounded-lg border border-kumo-line">
					{runs.data.items.map((run) => (
						<li key={run.id} className="space-y-3 p-4">
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div className="flex flex-wrap items-center gap-2 text-sm">
									<span>{formatDate(run.started_at, locale)}</span>
									<Badge>{triggers[run.trigger] ?? run.trigger}</Badge>
									<Badge variant={run.outcome === "ok" ? "success" : "warning"}>
										{t.functions.outcomes[run.outcome]}
									</Badge>
									<span className="text-kumo-subtle">
										{run.status} · {t.functions.durationValue(run.duration_ms)}
									</span>
									{run.version !== null && (
										<span className="text-kumo-subtle">
											{t.functions.versionLabel(run.version)}
										</span>
									)}
								</div>
								<Button
									type="button"
									variant="secondary"
									size="sm"
									aria-expanded={opened === run.id}
									onClick={() => {
										setOpened(opened === run.id ? null : run.id);
									}}
								>
									{opened === run.id ? t.functions.hideLogs : t.functions.showLogs}
								</Button>
							</div>
							{opened === run.id && (
								<>
									{run.error && <p className="text-sm text-kumo-danger">{run.error}</p>}
									<LogList logs={run.logs} />
								</>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function ScheduleTab({
	path,
	definition,
	onChanged,
}: {
	path: string;
	definition: FunctionDetails;
	onChanged(): void;
}) {
	const { t, locale } = useDataConsoleI18n();
	const action = useDataAction();
	const [enabled, setEnabled] = useState(definition.schedule !== null);
	const [cron, setCron] = useState(definition.schedule?.cron ?? "0 * * * *");
	const [message, setMessage] = useState<string | null>(null);
	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				setMessage(null);
				action.run(async () => {
					await PUT(`${path}/schedule`, { cron: cron.trim() });
					setMessage(t.functions.scheduleSaved);
					onChanged();
				});
			}}
		>
			<SettingsSection title={t.functions.scheduleTab}>
				<SettingsRow>
					<SwitchField
						label={t.functions.scheduleLabel}
						description={t.functions.scheduleHelp}
						trailing={<StatusBadge state={definition.schedule ? "enabled" : "disabled"} />}
						checked={enabled}
						disabled={action.busy}
						onCheckedChange={(checked) => {
							setEnabled(checked);
							setMessage(null);
							if (!checked && definition.schedule)
								action.run(async () => {
									await DELETE(`${path}/schedule`);
									setMessage(t.functions.scheduleRemoved);
									onChanged();
								});
						}}
					/>
					{enabled && (
						<SettingsDependents>
							<SettingsTextField
								label={t.functions.cron}
								description={t.functions.cronHelp}
								className="font-mono"
								value={cron}
								onChange={(event) => {
									setCron(event.target.value);
								}}
							/>
							{definition.schedule && (
								<dl className="grid gap-2 text-sm sm:grid-cols-2">
									<div>
										<dt className="text-kumo-subtle">{t.functions.nextRun}</dt>
										<dd>{formatDate(definition.schedule.next_run_at, locale)}</dd>
									</div>
									<div>
										<dt className="text-kumo-subtle">{t.functions.lastRun}</dt>
										<dd>
											{formatDate(definition.schedule.last_run_at, locale, t.functions.never)}
										</dd>
									</div>
								</dl>
							)}
						</SettingsDependents>
					)}
				</SettingsRow>
			</SettingsSection>
			<ErrorAlert error={action.error} />
			{message && <Notice>{message}</Notice>}
			{enabled && (
				<SettingsActions>
					<Button type="submit" variant="primary" disabled={action.busy || !cron.trim()}>
						{t.functions.saveSchedule}
					</Button>
				</SettingsActions>
			)}
		</form>
	);
}

function SettingsTab({
	path,
	definition,
	secretsAvailable,
	onChanged,
}: {
	path: string;
	definition: FunctionDetails;
	secretsAvailable: boolean;
	onChanged(): void;
}) {
	const { t } = useDataConsoleI18n();
	const [value, setValue] = useState({ access: definition.access, vars: definition.vars });
	const [variable, setVariable] = useState({ name: "", value: "" });
	const [invalid, setInvalid] = useState<string | null>(null);
	const autosave = useSettingsAutosave({
		resourceKey: definition.name,
		value,
		save: async (next) => {
			await PUT(path, next);
		},
	});
	return (
		<div className="space-y-5">
			<SettingsSection title={t.functions.settingsTitle}>
				<SettingsRow>
					<RuleSelect
						label={t.functions.access}
						value={value.access}
						choices={FUNCTION_ACCESS}
						names={t.functions.accessNames}
						onChange={(next) => {
							if (isFunctionAccess(next)) setValue((current) => ({ ...current, access: next }));
						}}
					/>
				</SettingsRow>
			</SettingsSection>
			<SettingsSection title={t.functions.variables} description={t.functions.variablesHelp}>
				{Object.keys(value.vars).length === 0 && (
					<SettingsRow>
						<Notice>{t.functions.noVariables}</Notice>
					</SettingsRow>
				)}
				{Object.entries(value.vars).map(([name, text]) => (
					<SettingsRow key={name}>
						<SettingsTextField
							label={name}
							className="font-mono"
							value={text}
							onChange={(event) => {
								const next = event.target.value;
								setValue((current) => ({ ...current, vars: { ...current.vars, [name]: next } }));
							}}
						/>
						<SettingsActions>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={() => {
									setValue((current) => ({
										...current,
										vars: Object.fromEntries(
											Object.entries(current.vars).filter(([key]) => key !== name),
										),
									}));
								}}
							>
								{t.functions.removeVariable(name)}
							</Button>
						</SettingsActions>
					</SettingsRow>
				))}
				<SettingsRow>
					<form
						className="space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							const name = variable.name.trim();
							if (!validVariableName(name) || definition.secret_names.includes(name)) {
								setInvalid(
									validVariableName(name)
										? t.errors.variable_conflict
										: t.errors.variable_name_invalid,
								);
								return;
							}
							setInvalid(null);
							setValue((current) => ({
								...current,
								vars: { ...current.vars, [name]: variable.value },
							}));
							setVariable({ name: "", value: "" });
						}}
					>
						<SettingsTextField
							label={t.functions.variableName}
							className="font-mono"
							autoComplete="off"
							value={variable.name}
							onChange={(event) => {
								setVariable((current) => ({ ...current, name: event.target.value.toUpperCase() }));
							}}
						/>
						<SettingsTextField
							label={t.functions.variableValue}
							autoComplete="off"
							value={variable.value}
							onChange={(event) => {
								setVariable((current) => ({ ...current, value: event.target.value }));
							}}
						/>
						{invalid && <p role="alert">{invalid}</p>}
						<SettingsActions>
							<Button type="submit" variant="secondary" disabled={!variable.name.trim()}>
								{t.functions.addVariable}
							</Button>
						</SettingsActions>
					</form>
				</SettingsRow>
			</SettingsSection>
			<AutosaveIndicator status={autosave.status} onRetry={autosave.retry} />
			<SecretsSection
				path={path}
				definition={definition}
				available={secretsAvailable}
				onChanged={onChanged}
			/>
		</div>
	);
}

function SecretsSection({
	path,
	definition,
	available,
	onChanged,
}: {
	path: string;
	definition: FunctionDetails;
	available: boolean;
	onChanged(): void;
}) {
	const { t } = useDataConsoleI18n();
	const action = useDataAction();
	const [secret, setSecret] = useState({ name: "", value: "" });
	const [invalid, setInvalid] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const save = (changes: Record<string, string | null>, done: () => void) => {
		setMessage(null);
		action.run(async () => {
			await PUT(path, { secrets: changes });
			done();
			onChanged();
		});
	};
	return (
		<SettingsSection title={t.functions.secrets} description={t.functions.secretsHelp}>
			{!available && (
				<SettingsRow>
					<div className="flex flex-wrap items-center gap-2">
						<StatusBadge state="secretMissing" />
					</div>
					<p role="status" className="text-sm text-kumo-warning">
						{t.functions.secretsMissing}
					</p>
				</SettingsRow>
			)}
			{definition.secret_names.length === 0 && (
				<SettingsRow>
					<Notice>{t.functions.noSecrets}</Notice>
				</SettingsRow>
			)}
			{definition.secret_names.map((name) => (
				<SettingsRow
					key={name}
					className="flex flex-wrap items-center justify-between gap-3 space-y-0"
				>
					<span className="font-mono text-sm">{name}</span>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={action.busy}
						onClick={() => {
							save({ [name]: null }, () => undefined);
						}}
					>
						{t.functions.removeSecret(name)}
					</Button>
				</SettingsRow>
			))}
			{available && (
				<SettingsRow>
					<form
						className="space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							const name = secret.name.trim();
							if (!validVariableName(name) || name in definition.vars) {
								setInvalid(
									validVariableName(name)
										? t.errors.variable_conflict
										: t.errors.variable_name_invalid,
								);
								return;
							}
							setInvalid(null);
							save({ [name]: secret.value }, () => {
								setSecret({ name: "", value: "" });
								setMessage(t.functions.secretSaved);
							});
						}}
					>
						<SettingsTextField
							label={t.functions.secretName}
							className="font-mono"
							autoComplete="off"
							value={secret.name}
							onChange={(event) => {
								setSecret((current) => ({ ...current, name: event.target.value.toUpperCase() }));
							}}
						/>
						<SettingsTextField
							label={t.functions.secretValue}
							type="password"
							autoComplete="new-password"
							value={secret.value}
							onChange={(event) => {
								setSecret((current) => ({ ...current, value: event.target.value }));
							}}
						/>
						{invalid && <p role="alert">{invalid}</p>}
						<SettingsActions>
							<Button
								type="submit"
								variant="primary"
								disabled={action.busy || !secret.name.trim() || !secret.value}
							>
								{t.functions.addSecret}
							</Button>
						</SettingsActions>
					</form>
				</SettingsRow>
			)}
			{(action.error !== null || message) && (
				<SettingsRow>
					<ErrorAlert error={action.error} />
					{message && <Notice>{message}</Notice>}
				</SettingsRow>
			)}
		</SettingsSection>
	);
}

function AdvancedTab({
	path,
	definition,
	onDeleted,
}: {
	path: string;
	definition: FunctionDetails;
	onDeleted(): void;
}) {
	const { t } = useDataConsoleI18n();
	const action = useDataAction();
	const [seconds, setSeconds] = useState(String(definition.timeout_ms / 1000));
	const [confirming, setConfirming] = useState(false);
	const autosave = useSettingsAutosave({
		resourceKey: definition.name,
		value: seconds,
		save: async (next) => {
			await PUT(path, { timeout_ms: Math.round(Number(next) * 1000) });
		},
	});
	return (
		<div className="space-y-5">
			<SettingsSection title={t.common.advanced}>
				<SettingsRow>
					<SettingsTextField
						label={t.functions.timeout}
						description={t.functions.timeoutHelp}
						inputMode="numeric"
						value={seconds}
						onChange={(event) => {
							setSeconds(event.target.value);
						}}
					/>
				</SettingsRow>
			</SettingsSection>
			<AutosaveIndicator status={autosave.status} onRetry={autosave.retry} />
			<SettingsSection title={t.functions.deleteFunction}>
				<SettingsRow>
					<p className="text-sm">{t.functions.deleteFunctionMessage(definition.name)}</p>
					{confirming ? (
						<ConfirmPanel
							title={t.functions.deleteFunction}
							message={t.functions.deleteFunctionMessage(definition.name)}
							expected={definition.name}
							confirmLabel={t.functions.deleteFunction}
							busy={action.busy}
							onCancel={() => {
								setConfirming(false);
							}}
							onConfirm={() => {
								action.run(async () => {
									await DELETE(`${path}?confirm=${encode(definition.name)}`);
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
								{t.functions.deleteFunction}
							</Button>
						</SettingsActions>
					)}
					<ErrorAlert error={action.error} />
				</SettingsRow>
			</SettingsSection>
		</div>
	);
}
