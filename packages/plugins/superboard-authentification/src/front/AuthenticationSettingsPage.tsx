import {
	authenticationSettingDefinitions,
	AuthenticationSettingsError,
	validateAuthenticationSettings,
	type AuthenticationDeploymentStatus,
	type AuthenticationSettings,
	type AuthenticationSettingsSnapshot,
	type AuthenticationSettingValue,
} from "@superboard/contracts/authentication-settings";
import { useFrontContext } from "@superboard/front-ui/context";
import { Button, Input, Loader, Select, SwitchField } from "@superboard/front-ui/kumo";
import { PluginConfigurationTab } from "@superboard/front-ui/plugin-configuration-tab";
import { useQueryClient } from "@superboard/front-ui/query";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authenticationSettingsI18n } from "./authentication-settings-i18n.js";
import {
	settingsLayout,
	settingsTabs,
	settingTab,
	captchaKeys,
	signInProviders,
	type SettingItem,
	type SettingsSection,
	type SettingsTab,
	type SignInProvider,
} from "./authentication-settings-layout.js";
import { settingsSnapshot, useAuthenticationSettings } from "./authentication-settings-query.js";
import { GET, PUT } from "./transport.js";

const commaPattern = /[,\n]/u;
const autosaveDelay = 600;
const integrationLinks = [
	["openid", "/.well-known/openid-configuration"],
	["jwks", "/.well-known/jwks.json"],
	["apiDocs", "/api/v1/swagger"],
] as const;
const durationUnits = [
	["days", 86_400],
	["hours", 3_600],
	["minutes", 60],
	["seconds", 1],
] as const;
type DurationUnit = (typeof durationUnits)[number][0];
type PageTab = SettingsTab | "configuration";
type Translate = (key: string, values?: Record<string, string>) => string;
type Change = (key: string, value: AuthenticationSettingValue) => void;

export default function AuthenticationSettingsPage({
	tab,
	onInvalidField,
}: {
	tab?: SettingsTab;
	onInvalidField?(tab: SettingsTab): void;
} = {}) {
	const { locale } = useFrontContext();
	const client = useQueryClient();
	const i18n = authenticationSettingsI18n(locale);
	const { projectRef, endpoint, query } = useAuthenticationSettings();
	const [ownTab, setOwnTab] = useState<PageTab>("sign-in");
	const embedded = tab !== undefined;
	const current = tab ?? ownTab;
	return (
		<section className="ds-page space-y-5">
			{!embedded && (
				<header className="ds-page-header">
					<div>
						<h1 className="ds-page-title">{i18n._("title")}</h1>
						<p className="ds-page-description">{i18n._("description")}</p>
					</div>
				</header>
			)}
			{!embedded && <SectionNavigation />}
			{!embedded && (
				<nav aria-label={i18n._("sections")} className="flex flex-wrap gap-2">
					{[...settingsTabs, "configuration" as const].map((item) => (
						<Button
							key={item}
							type="button"
							variant={current === item ? "primary" : "secondary"}
							aria-pressed={current === item}
							onClick={() => {
								setOwnTab(item);
							}}
						>
							{i18n._(`tab:${item}`)}
						</Button>
					))}
				</nav>
			)}
			{current === "configuration" ? (
				<PluginConfigurationTab locale={locale} />
			) : query.isPending ? (
				<div role="status">
					<Loader />
					{i18n._("loading")}
				</div>
			) : query.error ? (
				<div role="alert">
					<p>{i18n._("loadFailed")}</p>
					<Button
						onClick={() => {
							query.refetch().catch(() => undefined);
						}}
					>
						{i18n._("reload")}
					</Button>
				</div>
			) : (
				query.data && (
					<SettingsForm
						key={projectRef}
						initial={query.data}
						tab={current}
						endpoint={endpoint}
						locale={locale}
						onInvalidTab={(next) => {
							if (embedded) onInvalidField?.(next);
							else setOwnTab(next);
						}}
						onUpdate={(next) => {
							client.setQueryData(["authentication-settings", projectRef], next);
						}}
					/>
				)
			)}
		</section>
	);
}

function SettingsForm({
	initial,
	tab,
	endpoint,
	locale,
	onInvalidTab,
	onUpdate,
}: {
	initial: AuthenticationSettingsSnapshot;
	tab: SettingsTab;
	endpoint: string;
	locale: string;
	onInvalidTab(tab: SettingsTab): void;
	onUpdate(snapshot: AuthenticationSettingsSnapshot): void;
}) {
	const [current, setCurrent] = useState(initial);
	const [values, setValues] = useState<AuthenticationSettings>(initial.values);
	const [openedProviders, setOpenedProviders] = useState<ReadonlySet<string>>(new Set());
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [conflict, setConflict] = useState(false);
	const [saved, setSaved] = useState(false);
	const i18n = useMemo(() => authenticationSettingsI18n(locale), [locale]);
	const t = useCallback<Translate>((key, variables) => i18n._(key, variables), [i18n]);
	const changes = useMemo(
		() =>
			Object.fromEntries(
				Object.entries(values)
					.map(([key, value]) => [key, normalizedSetting(key, value)] as const)
					.filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(current.values[key])),
			),
		[values, current.values],
	);
	const dirty = Object.keys(changes).length > 0;
	const change: Change = (key, value) => {
		setValues((previous) => ({ ...previous, [key]: value }));
		setSaved(false);
		setError(null);
		setConflict(false);
	};
	const save = useCallback(async () => {
		setBusy(true);
		setError(null);
		setConflict(false);
		try {
			const next = settingsSnapshot(
				(
					await PUT(endpoint, {
						revision: current.revision,
						values: validateAuthenticationSettings(changes),
					})
				).data,
			);
			setCurrent(next);
			onUpdate(next);
			setSaved(true);
		} catch (cause) {
			if (cause instanceof AuthenticationSettingsError) {
				const target = settingTab(cause.field);
				if (target) onInvalidTab(target);
				setError(`${t(cause.field)}: ${t("invalidValue")}`);
				return;
			}
			const code: unknown = cause && typeof cause === "object" ? Reflect.get(cause, "code") : null;
			setConflict(code === "configuration_conflict");
			setError(t(code === "configuration_conflict" ? "conflict" : "saveFailed"));
		} finally {
			setBusy(false);
		}
	}, [changes, current.revision, endpoint, onInvalidTab, onUpdate, t]);
	const reload = async () => {
		setBusy(true);
		try {
			const next = settingsSnapshot((await GET(endpoint)).data);
			setCurrent(next);
			setValues(next.values);
			setOpenedProviders(new Set());
			onUpdate(next);
			setError(null);
			setConflict(false);
			setSaved(false);
		} finally {
			setBusy(false);
		}
	};
	useEffect(() => {
		if (!dirty || busy || error) return;
		const timer = setTimeout(() => {
			save().catch(() => {
				setError(t("saveFailed"));
			});
		}, autosaveDelay);
		return () => {
			clearTimeout(timer);
		};
	}, [dirty, busy, error, save, t]);
	const context: ItemContext = {
		values,
		change,
		t,
		deployment: current.deployment,
		serverUrl: current.serverUrl,
		openedProviders,
		setProviderOpen: (id, open) => {
			setOpenedProviders((previous) => {
				const next = new Set(previous);
				if (open) next.add(id);
				else next.delete(id);
				return next;
			});
		},
	};
	return (
		<form
			className="flex w-full flex-col gap-8"
			onSubmit={(event) => {
				event.preventDefault();
			}}
		>
			{settingsLayout[tab].map((section) => (
				<SectionView key={section.id} section={section} context={context} />
			))}
			<p
				role="status"
				className={
					dirty || busy || saved
						? "sticky bottom-4 self-end rounded-md border border-kumo-line bg-kumo-base px-3 py-1.5 text-sm text-kumo-subtle shadow-sm"
						: "sr-only"
				}
			>
				{dirty || busy ? t("saving") : saved ? t("saved") : ""}
			</p>
			{error && (
				<div role="alert" className="space-y-3">
					<p className="text-sm text-kumo-danger">{error}</p>
					<div className="flex justify-end">
						<Button
							type="button"
							disabled={busy}
							onClick={() => {
								(conflict ? reload() : save()).catch(() => {
									setError(t(conflict ? "loadFailed" : "saveFailed"));
								});
							}}
						>
							{t(conflict ? "reload" : "retry")}
						</Button>
					</div>
				</div>
			)}
		</form>
	);
}

function normalizedSetting(key: string, value: AuthenticationSettingValue) {
	const type = authenticationSettingDefinitions[key]?.type;
	if (type === "list" && typeof value === "string")
		return value
			.split(commaPattern)
			.map((item) => item.trim())
			.filter(Boolean);
	return type === "number" && typeof value === "string" ? Number(value) : value;
}

interface ItemContext {
	values: AuthenticationSettings;
	change: Change;
	t: Translate;
	deployment: AuthenticationDeploymentStatus | undefined;
	serverUrl: string | undefined;
	openedProviders: ReadonlySet<string>;
	setProviderOpen(id: string, open: boolean): void;
}

function SectionView({ section, context }: { section: SettingsSection; context: ItemContext }) {
	const { t } = context;
	if (section.id === "links" && !context.serverUrl) return null;
	return (
		<fieldset className="space-y-3">
			<legend className="text-base font-semibold">{t(`section:${section.id}`)}</legend>
			<p className="text-sm text-kumo-subtle">{t(`section:${section.id}:description`)}</p>
			<div className="divide-y divide-kumo-line rounded-lg border border-kumo-line">
				{section.items.map((item) => (
					<ItemView key={itemId(item)} item={item} context={context} />
				))}
			</div>
		</fieldset>
	);
}

function itemId(item: SettingItem) {
	return "key" in item ? item.key : item.kind;
}

function ItemView({ item, context }: { item: SettingItem; context: ItemContext }) {
	if (item.kind === "providers")
		return (
			<>
				{signInProviders.map((provider) => (
					<ProviderView key={provider.id} provider={provider} context={context} />
				))}
			</>
		);
	if (item.kind === "captcha") return <CaptchaView context={context} />;
	if (item.kind === "links") return <LinksView context={context} />;
	if (item.kind === "switch" && item.when && !item.when(context.values)) return null;
	return (
		<div className="space-y-3 p-4">
			<SettingControl item={item} context={context} />
		</div>
	);
}

function SettingControl({ item, context }: { item: SettingItem; context: ItemContext }) {
	const { values, change, t } = context;
	if (item.kind === "switch") {
		const checked = values[item.key] === true;
		const children = (item.children ?? []).filter(
			(child) => child.kind !== "switch" || !child.when || child.when(values),
		);
		return (
			<>
				<SwitchField
					label={t(item.key)}
					checked={checked}
					onCheckedChange={(next) => {
						change(item.key, next);
					}}
				/>
				{checked && children.length > 0 && (
					<div className="ms-5 space-y-3 border-s border-kumo-line ps-4">
						{children.map((child) => (
							<SettingControl key={itemId(child)} item={child} context={context} />
						))}
					</div>
				)}
			</>
		);
	}
	if (item.kind === "field")
		return (
			<TextField
				name={item.key}
				label={t(item.key)}
				value={values[item.key]}
				listHelp={t("listHelp")}
				onChange={(value) => {
					change(item.key, value);
				}}
			/>
		);
	if (item.kind === "duration")
		return (
			<DurationField
				name={item.key}
				value={values[item.key]}
				t={t}
				onChange={(value) => {
					change(item.key, value);
				}}
			/>
		);
	if (item.kind === "choices") {
		const raw = values[item.key];
		const selected = Array.isArray(raw) ? raw : [];
		const minimum = authenticationSettingDefinitions[item.key]?.minimum ?? 0;
		return (
			<div className="space-y-3">
				<p className="text-sm font-medium">{t(item.key)}</p>
				{item.choices.map((choice) => {
					const listed = selected.includes(choice);
					const checked = item.inverted ? !listed : listed;
					return (
						<SwitchField
							key={choice}
							label={t(`choice:${item.key}:${choice}`)}
							checked={checked}
							disabled={!item.inverted && listed && selected.length <= minimum}
							onCheckedChange={(next) => {
								const add = item.inverted ? !next : next;
								change(
									item.key,
									add
										? [...selected.filter((value) => value !== choice), choice]
										: selected.filter((value) => value !== choice),
								);
							}}
						/>
					);
				})}
			</div>
		);
	}
	return null;
}

function TextField({
	name,
	label,
	value,
	listHelp,
	onChange,
}: {
	name: string;
	label: string;
	value: AuthenticationSettingValue | undefined;
	listHelp: string;
	onChange(value: string): void;
}) {
	const definition = authenticationSettingDefinitions[name];
	return (
		<div className="space-y-2">
			<label htmlFor={`setting-${name}`} className="block text-sm font-medium">
				{label}
			</label>
			<Input
				className="w-full"
				id={`setting-${name}`}
				inputMode={definition?.type === "number" ? "numeric" : undefined}
				value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
				onChange={(event) => {
					onChange(event.target.value);
				}}
			/>
			{definition?.type === "list" && <p className="text-xs text-kumo-subtle">{listHelp}</p>}
		</div>
	);
}

interface DurationState {
	unit: DurationUnit;
	amount: string;
	emitted: AuthenticationSettingValue | undefined;
}

function durationState(value: AuthenticationSettingValue | undefined): DurationState {
	const seconds = typeof value === "number" ? value : Number(value);
	if (value === "" || value === undefined || !Number.isFinite(seconds))
		return { unit: "seconds", amount: String(value ?? ""), emitted: value };
	const [unit, size] =
		durationUnits.find(([, length]) => seconds > 0 && seconds % length === 0) ?? durationUnits[3];
	return { unit, amount: String(seconds / size), emitted: value };
}

function DurationField({
	name,
	value,
	t,
	onChange,
}: {
	name: string;
	value: AuthenticationSettingValue | undefined;
	t: Translate;
	onChange(value: AuthenticationSettingValue): void;
}) {
	const [state, setState] = useState(() => durationState(value));
	if (state.emitted !== value) setState(durationState(value));
	const emit = (amount: string, unit: DurationUnit) => {
		const size = durationUnits.find(([candidate]) => candidate === unit)?.[1] ?? 1;
		const number = Number(amount);
		const next = amount.trim() !== "" && Number.isFinite(number) ? Math.round(number * size) : "";
		setState({ unit, amount, emitted: next });
		onChange(next);
	};
	return (
		<div className="space-y-2">
			<label htmlFor={`setting-${name}`} className="block text-sm font-medium">
				{t(name)}
			</label>
			<div className="flex gap-2">
				<Input
					className="min-w-0 flex-1"
					id={`setting-${name}`}
					inputMode="numeric"
					value={state.amount}
					onChange={(event) => {
						emit(event.target.value, state.unit);
					}}
				/>
				<Select
					aria-label={t("unit")}
					value={state.unit}
					onValueChange={(next) => {
						const unit = durationUnits.find(([candidate]) => candidate === next)?.[0];
						if (unit) emit(state.amount, unit);
					}}
					items={Object.fromEntries(durationUnits.map(([unit]) => [unit, t(`unit:${unit}`)]))}
				/>
			</div>
		</div>
	);
}

type SettingStatus = "off" | "incomplete" | "secretMissing" | "enabled";

function StatusBadge({ status, t }: { status: SettingStatus; t: Translate }) {
	return (
		<Badge variant={status === "enabled" ? "success" : status === "off" ? "default" : "warning"}>
			{t(`status:${status}`)}
		</Badge>
	);
}

function providerConfigured(provider: SignInProvider, values: AuthenticationSettings) {
	const primary = values[provider.keys[0] ?? ""];
	return Array.isArray(primary)
		? primary.length > 0
		: typeof primary === "string" && primary.trim() !== "";
}

function ProviderView({ provider, context }: { provider: SignInProvider; context: ItemContext }) {
	const { values, change, t, deployment } = context;
	const configured = providerConfigured(provider, values);
	const enabled = configured || context.openedProviders.has(provider.id);
	const secretMissing =
		provider.secret !== undefined &&
		deployment !== undefined &&
		!deployment.providerSecrets[provider.secret];
	const status: SettingStatus = !enabled
		? "off"
		: !configured
			? "incomplete"
			: secretMissing
				? "secretMissing"
				: "enabled";
	return (
		<div className="space-y-3 p-4">
			<SwitchField
				label={
					provider.id === "oidc"
						? t("provider:oidc")
						: t("provider:switch", { provider: provider.name })
				}
				trailing={<StatusBadge status={status} t={t} />}
				checked={enabled}
				onCheckedChange={(next) => {
					context.setProviderOpen(provider.id, next);
					if (!next)
						for (const key of provider.keys) change(key, Array.isArray(values[key]) ? [] : "");
				}}
			/>
			{enabled && (
				<div className="ms-5 space-y-3 border-s border-kumo-line ps-4">
					{provider.keys.map((key) => (
						<TextField
							key={key}
							name={key}
							label={t(key)}
							value={values[key]}
							listHelp={t("listHelp")}
							onChange={(value) => {
								change(key, value);
							}}
						/>
					))}
					{provider.id === "oidc" && (
						<p className="text-xs text-kumo-subtle">{t("provider:oidcHelp")}</p>
					)}
					{secretMissing && (
						<p className="text-sm text-kumo-warning">
							{t("provider:secretMissing", { provider: provider.name })}
						</p>
					)}
				</div>
			)}
		</div>
	);
}

function CaptchaView({ context }: { context: ItemContext }) {
	const { values, change, t, deployment } = context;
	const [enabledKey, siteKeyKey] = captchaKeys;
	const enabled = values[enabledKey] === true;
	const siteKey = values[siteKeyKey];
	const configured = typeof siteKey === "string" && siteKey.trim() !== "";
	const secretMissing = deployment !== undefined && deployment.captchaSecret !== true;
	const status: SettingStatus = !enabled
		? "off"
		: !configured
			? "incomplete"
			: secretMissing
				? "secretMissing"
				: "enabled";
	return (
		<div className="space-y-3 p-4" data-setting="captcha">
			<SwitchField
				label={t(enabledKey)}
				trailing={<StatusBadge status={status} t={t} />}
				checked={enabled}
				onCheckedChange={(next) => {
					change(enabledKey, next);
				}}
			/>
			{enabled && (
				<div className="ms-5 space-y-3 border-s border-kumo-line ps-4">
					<TextField
						name={siteKeyKey}
						label={t(siteKeyKey)}
						value={siteKey}
						listHelp={t("listHelp")}
						onChange={(value) => {
							change(siteKeyKey, value);
						}}
					/>
					<div className="space-y-1">
						<p className="text-sm font-medium">{t("captcha:secret")}</p>
						<p className={secretMissing ? "text-sm text-kumo-warning" : "text-xs text-kumo-subtle"}>
							{t(secretMissing ? "captcha:secretMissing" : "captcha:secretStored")}
						</p>
					</div>
				</div>
			)}
		</div>
	);
}

function LinksView({ context }: { context: ItemContext }) {
	const { t, serverUrl } = context;
	if (!serverUrl) return null;
	return (
		<ul className="space-y-2 p-4 text-sm">
			{integrationLinks.map(([key, path]) => (
				<li key={key} className="space-y-1">
					<p className="font-medium">{t(key)}</p>
					<a
						href={`${serverUrl}${path}`}
						className="break-all font-mono text-xs text-kumo-brand underline"
						target="_blank"
						rel="noreferrer"
					>
						{serverUrl}
						{path}
					</a>
				</li>
			))}
		</ul>
	);
}
