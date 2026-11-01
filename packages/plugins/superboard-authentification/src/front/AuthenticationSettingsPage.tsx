import {
	authenticationSettingDefinitions,
	AuthenticationSettingsError,
	validateAuthenticationSettings,
	type AuthenticationSettingDefinition,
	type AuthenticationSettingsSnapshot,
	type AuthenticationSettings,
	type AuthenticationSettingValue,
	type AuthenticationSettingsGroup,
} from "@superboard/contracts/authentication-settings";
import { useFrontContext } from "@superboard/front-ui/context";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Button, Checkbox, Input, Loader } from "@superboard/front-ui/kumo";
import { PluginConfigurationTab } from "@superboard/front-ui/plugin-configuration-tab";
import { useQuery, useQueryClient } from "@superboard/front-ui/query";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { useState } from "react";

import { authenticationSettingsI18n } from "./authentication-settings-i18n.js";
import { GET, PUT } from "./transport.js";

const groups: AuthenticationSettingsGroup[] = [
	"general",
	"login",
	"providers",
	"security",
	"advanced",
];
const commaPattern = /[,\n]/u;
const trailingSlashes = /\/+$/u;
const integrationLinks = [
	["openid", "/.well-known/openid-configuration"],
	["jwks", "/.well-known/jwks.json"],
	["apiDocs", "/api/v1/swagger"],
] as const;

function snapshot(value: unknown): AuthenticationSettingsSnapshot {
	if (
		!value ||
		typeof value !== "object" ||
		!("revision" in value) ||
		typeof value.revision !== "number" ||
		!Number.isSafeInteger(value.revision) ||
		value.revision < 0 ||
		!("values" in value)
	)
		throw new Error("CONFIGURATION_INVALID");
	let serverUrl: string | undefined;
	if ("serverUrl" in value && typeof value.serverUrl === "string") {
		const url = new URL(value.serverUrl);
		if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
			throw new Error("CONFIGURATION_INVALID");
		serverUrl = url.href.replace(trailingSlashes, "");
	}
	return {
		revision: value.revision,
		...(serverUrl ? { serverUrl } : {}),
		values: validateAuthenticationSettings(value.values),
		updatedAt: "updatedAt" in value && typeof value.updatedAt === "string" ? value.updatedAt : null,
	};
}

export default function AuthenticationSettingsPage({
	embedded,
	onInvalidField,
}: {
	/** Shows only the settings this predicate accepts, grouped by section, without page chrome. */
	embedded?(key: string): boolean;
	onInvalidField?(key: string): void;
} = {}) {
	const { locale } = useFrontContext();
	const { selectedProject } = useProjectSelection();
	const client = useQueryClient();
	const i18n = authenticationSettingsI18n(locale);
	const projectRef = selectedProject?.id;
	const [group, setGroup] = useState<SettingsTab>("general");
	const endpoint = `/api/v1/identity-admin/projects/${encodeURIComponent(projectRef ?? "")}/api/v1/configuration`;
	const query = useQuery({
		queryKey: ["authentication-settings", projectRef],
		enabled: Boolean(projectRef),
		refetchOnWindowFocus: false,
		retry: false,
		queryFn: async () => snapshot((await GET(endpoint)).data),
	});
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
					{tabs.map((item) => (
						<Button
							key={item}
							type="button"
							variant={group === item ? "primary" : "secondary"}
							aria-pressed={group === item}
							onClick={() => {
								setGroup(item);
							}}
						>
							{i18n._(item)}
						</Button>
					))}
				</nav>
			)}
			{group === "configuration" && <PluginConfigurationTab locale={locale} />}
			{query.isPending
				? group !== "configuration" && (
						<div role="status">
							<Loader />
							{i18n._("loading")}
						</div>
					)
				: query.error
					? group !== "configuration" && (
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
						)
					: query.data && (
							<SettingsForm
								key={projectRef}
								initial={query.data}
								group={group}
								embedded={embedded}
								onInvalidField={onInvalidField}
								setGroup={setGroup}
								endpoint={endpoint}
								locale={locale}
								onUpdate={(next) => {
									client.setQueryData(["authentication-settings", projectRef], next);
								}}
							/>
						)}
		</section>
	);
}

type SettingsTab = AuthenticationSettingsGroup | "configuration";
const tabs: SettingsTab[] = [...groups, "configuration"];

function SettingsForm({
	embedded,
	onInvalidField,
	initial,
	group,
	setGroup,
	endpoint,
	locale,
	onUpdate,
}: {
	embedded?(key: string): boolean;
	onInvalidField?(key: string): void;
	initial: AuthenticationSettingsSnapshot;
	group: SettingsTab;
	setGroup(group: SettingsTab): void;
	endpoint: string;
	locale: string;
	onUpdate(snapshot: AuthenticationSettingsSnapshot): void;
}) {
	const [current, setCurrent] = useState(initial);
	const [values, setValues] = useState<AuthenticationSettings>(initial.values);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const i18n = authenticationSettingsI18n(locale);
	const t = (key: string) => i18n._(key);
	const normalized = Object.fromEntries(
		Object.entries(values).map(([key, value]) => [
			key,
			authenticationSettingDefinitions[key]?.type === "list" && typeof value === "string"
				? value
						.split(commaPattern)
						.map((item) => item.trim())
						.filter(Boolean)
				: authenticationSettingDefinitions[key]?.type === "number" && typeof value === "string"
					? Number(value)
					: value,
		]),
	);
	const changes = Object.fromEntries(
		Object.entries(normalized).filter(
			([key, value]) => JSON.stringify(value) !== JSON.stringify(current.values[key]),
		),
	);
	const dirty = Object.keys(changes).length > 0;
	const change = (key: string, value: AuthenticationSettingValue) => {
		setValues((previous) => ({ ...previous, [key]: value }));
		setSaved(false);
		setError(null);
	};
	const save = async () => {
		setBusy(true);
		setError(null);
		setSaved(false);
		try {
			const next = snapshot(
				(
					await PUT(endpoint, {
						revision: current.revision,
						values: validateAuthenticationSettings(changes),
					})
				).data,
			);
			setCurrent(next);
			setValues(next.values);
			onUpdate(next);
			setSaved(true);
		} catch (cause) {
			if (cause instanceof AuthenticationSettingsError) {
				const field = authenticationSettingDefinitions[cause.field];
				if (field) {
					setGroup(field.group);
					onInvalidField?.(cause.field);
				}
				setError(`${t(cause.field)}: ${t("invalidValue")}`);
				return;
			}
			const code: unknown = cause && typeof cause === "object" ? Reflect.get(cause, "code") : null;
			setError(t(code === "configuration_conflict" ? "conflict" : "saveFailed"));
		} finally {
			setBusy(false);
		}
	};
	const reload = async () => {
		setBusy(true);
		try {
			const next = snapshot((await GET(endpoint)).data);
			setCurrent(next);
			setValues(next.values);
			onUpdate(next);
			setError(null);
			setSaved(false);
		} finally {
			setBusy(false);
		}
	};
	if (group === "configuration") return null;
	const fields = Object.entries(authenticationSettingDefinitions).filter(([key, field]) =>
		embedded ? embedded(key) : field.group === group,
	);
	const shown = groups.filter((section) => fields.some(([, field]) => field.group === section));
	return (
		<form
			className="space-y-5"
			onSubmit={(event) => {
				event.preventDefault();
				save().catch(() => {
					setError(t("saveFailed"));
				});
			}}
		>
			<>
				{shown.includes("providers") && <p className="text-kumo-subtle">{t("providerHelp")}</p>}
				{shown.map((section) => {
					const fieldset = (
						<fieldset key={section} disabled={busy} className="grid gap-5 md:grid-cols-2">
							<legend
								className={
									embedded && shown.length > 1 && section !== "advanced"
										? "mb-3 text-base font-semibold"
										: "sr-only"
								}
							>
								{t(section)}
							</legend>
							{fields
								.filter(([, field]) => field.group === section)
								.map(([key, field]) => (
									<SettingField
										key={key}
										name={key}
										type={field.type}
										value={values[key]}
										label={t(key)}
										listHelp={t("listHelp")}
										onChange={(value) => {
											change(key, value);
										}}
									/>
								))}
						</fieldset>
					);
					return embedded && shown.length > 1 && section === "advanced" ? (
						<details key={section} className="rounded border border-kumo-subtle p-4">
							<summary className="cursor-pointer font-semibold">{t(section)}</summary>
							<div className="mt-4">{fieldset}</div>
						</details>
					) : (
						fieldset
					);
				})}
				{shown.includes("general") && current.serverUrl && (
					<details className="space-y-2 rounded border border-kumo-subtle p-3 text-sm">
						<summary className="cursor-pointer font-medium">{t("integrationLinks")}</summary>
						<p className="text-kumo-subtle">{t("managedAddresses")}</p>
						<ul className="space-y-1 font-mono text-xs">
							{integrationLinks.map(([key, path]) => (
								<li key={key}>
									<span className="font-sans font-medium">{t(key)}:</span>{" "}
									<a
										href={`${current.serverUrl}${path}`}
										className="text-kumo-brand underline"
										target="_blank"
										rel="noreferrer"
									>
										{current.serverUrl}
										{path}
									</a>
								</li>
							))}
						</ul>
					</details>
				)}
				{error && <p role="alert">{error}</p>}
				{saved && <p role="status">{t("saved")}</p>}
				<div className="flex flex-wrap gap-3">
					<Button type="submit" variant="primary" disabled={!dirty || busy}>
						{t(busy ? "saving" : "save")}
					</Button>
					<Button
						type="button"
						disabled={!dirty || busy}
						onClick={() => {
							setValues(current.values);
							setError(null);
							setSaved(false);
						}}
					>
						{t("cancel")}
					</Button>
					{error && (
						<Button
							type="button"
							disabled={busy}
							onClick={() => {
								reload().catch(() => {
									setError(t("loadFailed"));
								});
							}}
						>
							{t("reload")}
						</Button>
					)}
				</div>
			</>
		</form>
	);
}

function SettingField({
	name,
	type,
	value,
	label,
	listHelp,
	onChange,
}: {
	name: string;
	type: AuthenticationSettingDefinition["type"];
	value: AuthenticationSettingValue | undefined;
	label: string;
	listHelp: string;
	onChange(value: AuthenticationSettingValue): void;
}) {
	return (
		<div className="space-y-2">
			{type === "boolean" ? (
				<Checkbox
					label={label}
					checked={value === true}
					onCheckedChange={(checked) => {
						onChange(checked === true);
					}}
				/>
			) : (
				<>
					<label htmlFor={`setting-${name}`} className="block text-sm font-medium">
						{label}
					</label>
					<Input
						className="w-full"
						id={`setting-${name}`}
						aria-label={label}
						value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
						onChange={(event) => {
							onChange(event.target.value);
						}}
					/>
					{type === "list" && <p className="text-xs text-kumo-subtle">{listHelp}</p>}
				</>
			)}
		</div>
	);
}
