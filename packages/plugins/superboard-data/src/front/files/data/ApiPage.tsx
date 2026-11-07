import { useFrontContext } from "@superboard/front-ui/context";
import { Button, Input, SwitchField } from "@superboard/front-ui/kumo";
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
import { useId, useState } from "react";

import { DELETE, PATCH, POST } from "../transport.js";
import {
	encode,
	readBody,
	useAddressState,
	useDataAction,
	useDataPath,
	useDataResource,
	type DataStatus,
	type Page,
	type ProjectSettings,
	type ServiceKey,
} from "./client.js";
import { useDataConsoleI18n, type DataConsoleMessages } from "./i18n.js";
import {
	CodeBlock,
	ConfirmPanel,
	CopyButton,
	DataPage,
	ErrorAlert,
	formatDate,
	LoadState,
	Notice,
	SectionTabs,
	StatusBadge,
	type FeatureState,
} from "./shared.js";

const trailingSlashes = /\/+$/u;

type ApiTab = "overview" | "keys" | "advanced";
const apiTabs: readonly ApiTab[] = ["overview", "keys", "advanced"];

function usePublicApiBase(): string | null {
	const sdk = useFrontContext().publicEndpoints?.sdk?.trim();
	return sdk ? `${sdk.replace(trailingSlashes, "")}/v1/data` : null;
}

export default function ApiPage() {
	const { t } = useDataConsoleI18n();
	const base = useDataPath();
	const [tabParameter, setTab] = useAddressState("tab");
	const tab = apiTabs.find((candidate) => candidate === tabParameter) ?? "overview";
	return (
		<DataPage title={t.api.title} description={t.api.description}>
			{base ? (
				<>
					<SectionTabs
						tabs={[
							["overview", t.api.overviewTab],
							["keys", t.api.keysTab],
							["advanced", t.common.advanced],
						]}
						current={tab}
						onChange={(next) => {
							setTab(next === "overview" ? null : next);
						}}
					/>
					{tab === "overview" && <Overview base={base} />}
					{tab === "keys" && <ServerKeys base={base} />}
					{tab === "advanced" && <Advanced />}
				</>
			) : (
				<Notice>{t.common.noProject}</Notice>
			)}
		</DataPage>
	);
}

function Overview({ base }: { base: string }) {
	const { t } = useDataConsoleI18n();
	const status = useDataResource<DataStatus>(`${base}/status`);
	const settings = useDataResource<ProjectSettings>(`${base}/settings`);
	const apiBase = usePublicApiBase();
	const features = status.data?.features;
	const rows: readonly [keyof DataConsoleMessages["api"]["features"], FeatureState][] = features
		? [
				["database", "enabled"],
				["realtime", features.realtime ? "enabled" : "unavailable"],
				["functions", features.functions ? "enabled" : "unavailable"],
				["function_secrets", features.function_secrets ? "enabled" : "secretMissing"],
				["image_transformations", features.image_transformations ? "enabled" : "disabled"],
				["vectors", features.vectors ? "enabled" : "unavailable"],
			]
		: [];
	return (
		<div className="space-y-6">
			<LoadState
				loading={status.loading && !status.data}
				error={status.error}
				onRetry={status.refresh}
			/>
			{status.data && (
				<SettingsSection
					title={t.api.featuresTitle}
					description={t.api.counts(
						status.data.counts.tables,
						status.data.counts.buckets,
						status.data.counts.functions,
					)}
				>
					{rows.map(([feature, state]) => (
						<SettingsRow key={feature}>
							<div className="flex items-center justify-between gap-4">
								<span className="text-sm font-medium">{t.api.features[feature]}</span>
								<StatusBadge state={state} />
							</div>
							{feature === "realtime" && features?.realtime && settings.data && (
								<SettingsDependents>
									<RealtimeAnonymous base={base} initial={settings.data} />
								</SettingsDependents>
							)}
						</SettingsRow>
					))}
				</SettingsSection>
			)}
			<SettingsSection title={t.api.publicApiTitle}>
				<SettingsRow>
					{apiBase ? (
						<div className="space-y-2">
							<p className="text-sm font-medium">{t.api.baseUrl}</p>
							<div className="flex flex-wrap items-center justify-between gap-3">
								<code className="font-mono text-sm break-all">{apiBase}</code>
								<CopyButton value={apiBase} />
							</div>
						</div>
					) : (
						<div className="flex items-center justify-between gap-4">
							<span className="text-sm">{t.api.sdkMissing}</span>
							<StatusBadge state="incomplete" />
						</div>
					)}
				</SettingsRow>
			</SettingsSection>
		</div>
	);
}

function RealtimeAnonymous({ base, initial }: { base: string; initial: ProjectSettings }) {
	const { t } = useDataConsoleI18n();
	const [value, setValue] = useState(initial);
	const autosave = useSettingsAutosave({
		resourceKey: base,
		value,
		save: async (next) => {
			await PATCH(`${base}/settings`, next);
		},
	});
	return (
		<>
			<SwitchField
				label={t.api.realtimeAnonymous}
				description={t.api.realtimeAnonymousHelp}
				checked={value.realtime_anonymous}
				onCheckedChange={(checked) => {
					setValue({ realtime_anonymous: checked });
				}}
			/>
			<AutosaveIndicator status={autosave.status} onRetry={autosave.retry} />
		</>
	);
}

function ServerKeys({ base }: { base: string }) {
	const { t, locale } = useDataConsoleI18n();
	const keys = useDataResource<Page<ServiceKey>>(`${base}/keys`);
	const action = useDataAction();
	const [name, setName] = useState("");
	const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
	const [revoking, setRevoking] = useState<ServiceKey | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	return (
		<div className="space-y-6">
			<SettingsSection title={t.api.keysTitle} description={t.api.keysDescription}>
				<SettingsRow>
					<form
						className="space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							setMessage(null);
							action.run(async () => {
								const created = readBody<{ key: ServiceKey; secret: string }>(
									await POST(`${base}/keys`, { name: name.trim() }),
								);
								setSecret({ name: created.key.name, value: created.secret });
								setName("");
								keys.refresh();
							});
						}}
					>
						<SettingsTextField
							label={t.api.keyName}
							value={name}
							autoComplete="off"
							required
							onChange={(event) => {
								setName(event.target.value);
							}}
						/>
						<SettingsActions>
							<Button type="submit" variant="primary" disabled={action.busy || !name.trim()}>
								{t.api.createKey}
							</Button>
						</SettingsActions>
					</form>
				</SettingsRow>
			</SettingsSection>
			{secret && (
				<NewSecret
					name={secret.name}
					value={secret.value}
					onDismiss={() => {
						setSecret(null);
					}}
				/>
			)}
			{revoking && (
				<ConfirmPanel
					title={t.api.revokeKey(revoking.name)}
					message={t.api.revokeMessage(revoking.name)}
					confirmLabel={t.api.revoke}
					busy={action.busy}
					onCancel={() => {
						setRevoking(null);
					}}
					onConfirm={() => {
						action.run(async () => {
							await DELETE(`${base}/keys/${encode(revoking.id)}`);
							setRevoking(null);
							setMessage(t.api.keyRevoked);
							keys.refresh();
						});
					}}
				/>
			)}
			<ErrorAlert error={action.error} />
			{message && <Notice>{message}</Notice>}
			<LoadState loading={keys.loading && !keys.data} error={keys.error} onRetry={keys.refresh} />
			{keys.data && keys.data.items.length === 0 && <Notice>{t.api.noKeys}</Notice>}
			{keys.data && keys.data.items.length > 0 && (
				<FrontTable>
					<FrontTableHeader>
						<FrontTableRow>
							<FrontTableHead>{t.common.name}</FrontTableHead>
							<FrontTableHead>{t.api.hint}</FrontTableHead>
							<FrontTableHead>{t.common.created}</FrontTableHead>
							<FrontTableHead>{t.api.lastUsed}</FrontTableHead>
							<FrontTableHead>{t.common.actions}</FrontTableHead>
						</FrontTableRow>
					</FrontTableHeader>
					<FrontTableBody>
						{keys.data.items.map((key) => (
							<FrontTableRow key={key.id}>
								<FrontTableCell>{key.name}</FrontTableCell>
								<FrontTableCell className="font-mono">{key.hint}</FrontTableCell>
								<FrontTableCell>{formatDate(key.created_at, locale)}</FrontTableCell>
								<FrontTableCell>{formatDate(key.last_used_at, locale, t.api.never)}</FrontTableCell>
								<FrontTableCell>
									{key.revoked_at ? (
										<Badge>{t.api.revoked}</Badge>
									) : (
										<div className="flex items-center gap-2">
											<Badge variant="success">{t.api.active}</Badge>
											<Button
												type="button"
												variant="secondary-destructive"
												size="sm"
												aria-label={t.api.revokeKey(key.name)}
												onClick={() => {
													setMessage(null);
													setRevoking(key);
												}}
											>
												{t.api.revoke}
											</Button>
										</div>
									)}
								</FrontTableCell>
							</FrontTableRow>
						))}
					</FrontTableBody>
				</FrontTable>
			)}
		</div>
	);
}

function NewSecret({ name, value, onDismiss }: { name: string; value: string; onDismiss(): void }) {
	const { t } = useDataConsoleI18n();
	const id = useId();
	return (
		<section
			aria-labelledby={`${id}-title`}
			className="space-y-3 rounded-lg border border-kumo-warning bg-kumo-warning-tint p-4"
		>
			<h2 id={`${id}-title`} className="text-base font-semibold">
				{t.api.newSecretTitle}
			</h2>
			<p role="alert" className="text-sm">
				{t.api.newSecretWarning}
			</p>
			<div className="space-y-2">
				<label htmlFor={`${id}-secret`} className="block text-sm font-medium">
					{t.api.newSecretLabel} · {name}
				</label>
				<Input
					id={`${id}-secret`}
					readOnly
					className="w-full font-mono"
					value={value}
					onFocus={(event) => {
						event.currentTarget.select();
					}}
				/>
			</div>
			<SettingsActions>
				<CopyButton value={value} />
				<Button type="button" variant="primary" onClick={onDismiss}>
					{t.api.dismissSecret}
				</Button>
			</SettingsActions>
		</section>
	);
}

function Advanced() {
	const { t } = useDataConsoleI18n();
	const apiBase = usePublicApiBase();
	if (!apiBase)
		return (
			<div className="flex items-center justify-between gap-4">
				<span className="text-sm">{t.api.sdkMissing}</span>
				<StatusBadge state="incomplete" />
			</div>
		);
	const openApi = `${apiBase}/openapi.json`;
	const cli = [
		`superboard login --url ${apiBase} --key sb_secret_…`,
		"superboard db push schema.json",
		"superboard gen types",
	].join("\n");
	return (
		<div className="space-y-6">
			<SettingsSection title={t.api.openApi}>
				<SettingsRow className="flex flex-wrap items-center justify-between gap-3 space-y-0">
					<code className="font-mono text-sm break-all">{openApi}</code>
					<CopyButton value={openApi} />
				</SettingsRow>
			</SettingsSection>
			<SettingsSection title={t.api.cliTitle} description={t.api.cliDescription}>
				<SettingsRow>
					<CodeBlock>{cli}</CodeBlock>
					<SettingsActions>
						<CopyButton value={cli} />
					</SettingsActions>
				</SettingsRow>
			</SettingsSection>
		</div>
	);
}
