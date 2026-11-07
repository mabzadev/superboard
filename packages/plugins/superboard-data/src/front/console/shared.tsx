import { ArrowLeft } from "@superboard/front-ui/icons";
import { Button, Input, InputArea, Loader, Select } from "@superboard/front-ui/kumo";
import { SettingsActions } from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { useId, useState, type ReactNode } from "react";

import { ACCESS_RULES, errorCode, errorDetail, type AccessRule } from "./client.js";
import { useDataConsoleI18n, type DataConsoleMessages } from "./i18n.js";

export type FeatureState = keyof DataConsoleMessages["common"]["state"];

export function DataPage({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<section className="ds-page space-y-5">
			<header className="ds-page-header">
				<div>
					<h1 className="ds-page-title">{title}</h1>
					<p className="ds-page-description">{description}</p>
				</div>
			</header>
			{children}
		</section>
	);
}

export function SectionTabs<T extends string>({
	tabs,
	current,
	onChange,
}: {
	tabs: readonly (readonly [T, string])[];
	current: T;
	onChange(tab: T): void;
}) {
	const { t } = useDataConsoleI18n();
	return (
		<nav aria-label={t.common.sections} className="flex flex-wrap gap-2">
			{tabs.map(([id, label]) => (
				<Button
					key={id}
					type="button"
					variant={current === id ? "primary" : "secondary"}
					aria-pressed={current === id}
					onClick={() => {
						onChange(id);
					}}
				>
					{label}
				</Button>
			))}
		</nav>
	);
}

export function BackButton({ label, onClick }: { label: string; onClick(): void }) {
	return (
		<Button type="button" variant="ghost" size="sm" onClick={onClick}>
			<ArrowLeft className="rtl:-scale-x-100" />
			{label}
		</Button>
	);
}

const stateVariants = {
	enabled: "success",
	disabled: "default",
	incomplete: "warning",
	secretMissing: "warning",
	unavailable: "default",
} as const;

export function StatusBadge({ state }: { state: FeatureState }) {
	const { t } = useDataConsoleI18n();
	return <Badge variant={stateVariants[state]}>{t.common.state[state]}</Badge>;
}

export function RuleSelect({
	label,
	value,
	choices = ACCESS_RULES,
	names,
	onChange,
}: {
	label: string;
	value: string;
	choices?: readonly string[];
	names?: Record<string, string>;
	onChange(value: string): void;
}) {
	const { t } = useDataConsoleI18n();
	const labels: Record<string, string> = names ?? t.common.rules;
	return (
		<Select
			label={label}
			className="w-full"
			value={value}
			onValueChange={(next) => {
				if (typeof next === "string" && choices.includes(next)) onChange(next);
			}}
			items={Object.fromEntries(choices.map((choice) => [choice, labels[choice] ?? choice]))}
		/>
	);
}

export function isAccessRule(value: string): value is AccessRule {
	return (ACCESS_RULES as readonly string[]).includes(value);
}

export function errorMessage(cause: unknown, t: DataConsoleMessages): string {
	const code = errorCode(cause);
	const known: Record<string, string> = t.errors;
	const text = code ? known[code] : undefined;
	if (code === "sql_failed") return `${t.errors.sql_failed} ${errorDetail(cause) ?? ""}`.trim();
	if (text) return text;
	return code ? `${t.errors.generic} (${code})` : t.errors.generic;
}

export function ErrorAlert({ error }: { error: unknown }) {
	const { t } = useDataConsoleI18n();
	if (!error) return null;
	return (
		<p role="alert" className="text-sm text-kumo-danger">
			{errorMessage(error, t)}
		</p>
	);
}

export function Notice({ children }: { children: ReactNode }) {
	return (
		<p role="status" className="text-sm text-kumo-subtle">
			{children}
		</p>
	);
}

export function LoadState({
	loading,
	error,
	onRetry,
}: {
	loading: boolean;
	error: unknown;
	onRetry(): void;
}) {
	const { t } = useDataConsoleI18n();
	if (error)
		return (
			<div role="alert" className="space-y-3">
				<p className="text-sm text-kumo-danger">
					{t.common.loadFailed} {errorMessage(error, t)}
				</p>
				<SettingsActions>
					<Button type="button" onClick={onRetry}>
						{t.common.retry}
					</Button>
				</SettingsActions>
			</div>
		);
	if (loading)
		return (
			<div role="status" className="flex items-center gap-2 text-sm text-kumo-subtle">
				<Loader />
				{t.common.loading}
			</div>
		);
	return null;
}

export function ConfirmPanel({
	title,
	message,
	expected,
	confirmLabel,
	busy,
	onConfirm,
	onCancel,
}: {
	title: string;
	message: string;
	expected?: string;
	confirmLabel: string;
	busy: boolean;
	onConfirm(): void;
	onCancel(): void;
}) {
	const { t } = useDataConsoleI18n();
	const [typed, setTyped] = useState("");
	const id = useId();
	return (
		<div
			role="alertdialog"
			aria-labelledby={`${id}-title`}
			aria-describedby={`${id}-message`}
			className="space-y-3 rounded-lg border border-kumo-line p-4"
		>
			<p id={`${id}-title`} className="text-sm font-semibold">
				{title}
			</p>
			<p id={`${id}-message`} className="text-sm">
				{message}
			</p>
			{expected !== undefined && (
				<div className="space-y-2">
					<label htmlFor={`${id}-typed`} className="block text-sm font-medium">
						{t.common.typeToConfirm(expected)}
					</label>
					<Input
						id={`${id}-typed`}
						className="w-full"
						autoComplete="off"
						value={typed}
						onChange={(event) => {
							setTyped(event.target.value);
						}}
					/>
				</div>
			)}
			<SettingsActions>
				<Button type="button" variant="secondary" onClick={onCancel}>
					{t.common.cancel}
				</Button>
				<Button
					type="button"
					variant="destructive"
					disabled={busy || (expected !== undefined && typed !== expected)}
					onClick={onConfirm}
				>
					{confirmLabel}
				</Button>
			</SettingsActions>
		</div>
	);
}

export function Pager({
	hasPrevious,
	next,
	onFirst,
	onNext,
}: {
	hasPrevious: boolean;
	next: string | undefined;
	onFirst(): void;
	onNext(cursor: string): void;
}) {
	const { t } = useDataConsoleI18n();
	if (!hasPrevious && !next) return null;
	return (
		<SettingsActions>
			{hasPrevious && (
				<Button type="button" variant="secondary" onClick={onFirst}>
					{t.common.firstPage}
				</Button>
			)}
			{next && (
				<Button
					type="button"
					variant="secondary"
					onClick={() => {
						onNext(next);
					}}
				>
					{t.common.nextPage}
				</Button>
			)}
		</SettingsActions>
	);
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
	const { t } = useDataConsoleI18n();
	const [copied, setCopied] = useState(false);
	return (
		<Button
			type="button"
			variant="secondary"
			size="sm"
			onClick={() => {
				const copy = async () => {
					try {
						await navigator.clipboard.writeText(value);
						setCopied(true);
					} catch {
						setCopied(false);
					}
				};
				copy().catch(() => undefined);
			}}
		>
			{copied ? t.common.copied : (label ?? t.common.copy)}
		</Button>
	);
}

export function CodeBlock({ children }: { children: string }) {
	return (
		<pre className="overflow-x-auto rounded-lg border border-kumo-line bg-kumo-recessed p-3 font-mono text-xs whitespace-pre-wrap break-all">
			{children}
		</pre>
	);
}

export function formatBytes(bytes: number, locale: string, t: DataConsoleMessages): string {
	const units = t.common.byteUnits;
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toLocaleString(locale, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit] ?? ""}`;
}

export function formatDate(value: string | null, locale: string, fallback = "—"): string {
	if (!value) return fallback;
	const time = Date.parse(value);
	if (!Number.isFinite(time)) return value;
	return new Date(time).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

export function cellText(value: unknown, t: DataConsoleMessages): string {
	if (value === null || value === undefined) return "—";
	if (typeof value === "boolean") return value ? t.common.yes : t.common.no;
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "bigint") return value.toString();
	return JSON.stringify(value);
}

export function CodeField({
	label,
	value,
	rows = 12,
	description,
	onChange,
}: {
	label: string;
	value: string;
	rows?: number;
	description?: string;
	onChange(value: string): void;
}) {
	const id = useId();
	return (
		<div className="space-y-2">
			<label htmlFor={id} className="block text-sm font-medium">
				{label}
			</label>
			<InputArea
				id={id}
				rows={rows}
				spellCheck={false}
				className="w-full font-mono text-sm"
				value={value}
				onChange={(event) => {
					onChange(event.target.value);
				}}
			/>
			{description && <p className="text-xs text-kumo-subtle">{description}</p>}
		</div>
	);
}
