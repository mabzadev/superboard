import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type ComponentProps,
	type ReactNode,
} from "react";

import { Button, Input } from "./kumo.js";
import { useComponentI18n } from "./shared/lib/component-i18n.js";
import { cn } from "./shared/lib/utils.js";

export { SwitchField } from "./kumo.js";

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export function SettingsSection({
	title,
	description,
	className,
	children,
}: {
	title: ReactNode;
	description?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section className={cn("space-y-3", className)}>
			<div className="space-y-1">
				<h2 className="text-base font-semibold">{title}</h2>
				{description && <p className="text-sm text-kumo-subtle">{description}</p>}
			</div>
			<div className="divide-y divide-kumo-line rounded-lg border border-kumo-line">{children}</div>
		</section>
	);
}

export function SettingsRow({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn("space-y-3 p-4", className)} {...props} />;
}

export function SettingsDependents({ className, ...props }: ComponentProps<"div">) {
	return (
		<div className={cn("ms-5 space-y-3 border-s border-kumo-line ps-4", className)} {...props} />
	);
}

export function SettingsTextField({
	label,
	description,
	id,
	className,
	...props
}: Omit<ComponentProps<typeof Input>, "label"> & { label: ReactNode; description?: ReactNode }) {
	const generated = useId();
	const inputId = id ?? generated;
	return (
		<div className="space-y-2">
			<label id={`${inputId}-label`} htmlFor={inputId} className="block text-sm font-medium">
				{label}
			</label>
			<Input
				id={inputId}
				aria-labelledby={`${inputId}-label`}
				className={cn("w-full", className)}
				aria-describedby={description ? `${inputId}-description` : undefined}
				{...props}
			/>
			{description && (
				<p id={`${inputId}-description`} className="text-xs text-kumo-subtle">
					{description}
				</p>
			)}
		</div>
	);
}

export function SettingsActions({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn("flex flex-wrap justify-end gap-3", className)} {...props} />;
}

export function AutosaveIndicator({
	status,
	onRetry,
}: {
	status: AutosaveStatus;
	onRetry(): void;
}) {
	const t = useComponentI18n();
	if (status === "error")
		return (
			<div role="alert" className="space-y-3">
				<p className="text-sm text-kumo-danger">{t("autosave.failed")}</p>
				<SettingsActions>
					<Button type="button" onClick={onRetry}>
						{t("autosave.retry")}
					</Button>
				</SettingsActions>
			</div>
		);
	const text =
		status === "pending" || status === "saving"
			? t("autosave.saving")
			: status === "saved"
				? t("autosave.saved")
				: "";
	return (
		<p
			role="status"
			className={
				text
					? "sticky bottom-4 ms-auto w-fit rounded-md border border-kumo-line bg-kumo-base px-3 py-1.5 text-sm text-kumo-subtle shadow-sm"
					: "sr-only"
			}
		>
			{text}
		</p>
	);
}

export function useSettingsAutosave<T>({
	resourceKey,
	value,
	save,
	enabled = true,
	delay = 600,
}: {
	resourceKey: string;
	value: T;
	save(value: T): Promise<void>;
	enabled?: boolean;
	delay?: number;
}) {
	const signature = JSON.stringify(value);
	const latest = useRef({ value, signature, save });
	const baseline = useRef({ key: resourceKey, signature });
	const savedOnce = useRef(false);
	const [status, setStatus] = useState<AutosaveStatus>("idle");
	const [saving, setSaving] = useState(false);
	const [failed, setFailed] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		latest.current = { value, signature, save };
	});
	useEffect(() => {
		if (baseline.current.key !== resourceKey) {
			baseline.current = { key: resourceKey, signature };
			setFailed(null);
			setStatus("idle");
			return;
		}
		if (!enabled || saving || signature === failed) return;
		if (signature === baseline.current.signature) {
			setStatus((current) =>
				current !== "pending" ? current : savedOnce.current ? "saved" : "idle",
			);
			return;
		}
		setStatus("pending");
		const timer = setTimeout(() => {
			const request = latest.current;
			setSaving(true);
			setStatus("saving");
			request
				.save(structuredClone(request.value))
				.then(
					() => {
						if (baseline.current.key !== resourceKey) return;
						baseline.current = { key: resourceKey, signature: request.signature };
						savedOnce.current = true;
						setStatus(latest.current.signature === request.signature ? "saved" : "pending");
					},
					() => {
						setFailed(request.signature);
						setStatus("error");
					},
				)
				.finally(() => {
					setSaving(false);
				});
		}, delay);
		return () => {
			clearTimeout(timer);
		};
	}, [resourceKey, signature, enabled, saving, failed, attempt, delay]);
	const retry = useCallback(() => {
		setFailed(null);
		setAttempt((count) => count + 1);
	}, []);
	return { status, retry };
}
