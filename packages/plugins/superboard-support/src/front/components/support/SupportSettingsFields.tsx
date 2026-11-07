import { Input, InputArea } from "@superboard/front-ui/kumo";
import { cn } from "@superboard/front-ui/lib/utils.js";
import { useId, useState, type ComponentProps, type ReactNode } from "react";

import { useSupportI18n } from "../../i18n.js";

const selectClass = "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

function FieldFrame({
	id,
	label,
	description,
	error,
	children,
}: {
	id: string;
	label: ReactNode;
	description?: ReactNode;
	error?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="space-y-2">
			<label htmlFor={id} className="block text-sm font-medium">
				{label}
			</label>
			{children}
			{description && (
				<p id={`${id}-description`} className="text-xs text-kumo-subtle">
					{description}
				</p>
			)}
			{error && (
				<p id={`${id}-error`} role="alert" className="text-xs text-kumo-danger">
					{error}
				</p>
			)}
		</div>
	);
}

function describedBy(id: string, description?: ReactNode, error?: ReactNode) {
	const ids = [description ? `${id}-description` : "", error ? `${id}-error` : ""].filter(Boolean);
	return ids.length ? ids.join(" ") : undefined;
}

export function SettingsSelectField({
	label,
	description,
	id,
	className,
	children,
	...props
}: ComponentProps<"select"> & { label: ReactNode; description?: ReactNode }) {
	const generated = useId();
	const selectId = id ?? generated;
	return (
		<FieldFrame id={selectId} label={label} description={description}>
			<select
				id={selectId}
				className={cn(selectClass, className)}
				aria-describedby={describedBy(selectId, description)}
				{...props}
			>
				{children}
			</select>
		</FieldFrame>
	);
}

export function SettingsTextAreaField({
	label,
	description,
	id,
	className,
	...props
}: Omit<ComponentProps<typeof InputArea>, "label"> & {
	label: ReactNode;
	description?: ReactNode;
}) {
	const generated = useId();
	const areaId = id ?? generated;
	return (
		<FieldFrame id={areaId} label={label} description={description}>
			<InputArea
				id={areaId}
				className={cn("w-full", className)}
				aria-describedby={describedBy(areaId, description)}
				{...props}
			/>
		</FieldFrame>
	);
}

export function SettingsValidatedField({
	label,
	description,
	error,
	id,
	className,
	...props
}: Omit<ComponentProps<typeof Input>, "label"> & {
	label: ReactNode;
	description?: ReactNode;
	error?: ReactNode;
}) {
	const generated = useId();
	const inputId = id ?? generated;
	return (
		<FieldFrame id={inputId} label={label} description={description} error={error}>
			<Input
				id={inputId}
				className={cn("w-full", className)}
				aria-invalid={error ? true : undefined}
				aria-describedby={describedBy(inputId, description, error)}
				{...props}
			/>
		</FieldFrame>
	);
}

const durationUnits = [
	["days", 1440],
	["hours", 60],
	["minutes", 1],
] as const;
type DurationUnit = (typeof durationUnits)[number][0];
const durationUnitLabels: Record<DurationUnit, string> = {
	days: "Days",
	hours: "Hours",
	minutes: "Minutes",
};

interface DurationState {
	unit: DurationUnit;
	amount: string;
	emitted: number | "";
}

function durationState(minutes: number | ""): DurationState {
	if (minutes === "") return { unit: "minutes", amount: "", emitted: minutes };
	const [unit, size] = durationUnits.find(
		([, length]) => minutes > 0 && minutes % length === 0,
	) ?? ["minutes", 1];
	return { unit, amount: String(minutes / size), emitted: minutes };
}

export function SettingsDurationField({
	label,
	description,
	error,
	minutes,
	onChange,
}: {
	label: ReactNode;
	description?: ReactNode;
	error?: ReactNode;
	minutes: number | "";
	onChange(minutes: number | ""): void;
}) {
	const { t } = useSupportI18n();
	const id = useId();
	const [state, setState] = useState(() => durationState(minutes));
	if (state.emitted !== minutes) setState(durationState(minutes));
	const emit = (amount: string, unit: DurationUnit) => {
		const size = durationUnits.find(([candidate]) => candidate === unit)?.[1] ?? 1;
		const number = Number(amount);
		const next =
			amount.trim() !== "" && Number.isFinite(number) && number >= 0
				? Math.round(number * size)
				: "";
		setState({ unit, amount, emitted: next });
		onChange(next);
	};
	return (
		<FieldFrame id={id} label={label} description={description} error={error}>
			<div className="flex gap-2">
				<Input
					id={id}
					className="min-w-0 flex-1"
					inputMode="decimal"
					aria-invalid={error ? true : undefined}
					aria-describedby={describedBy(id, description, error)}
					value={state.amount}
					onChange={(event) => {
						emit(event.target.value, state.unit);
					}}
				/>
				<select
					aria-label={t("Unit")}
					className="h-9 w-auto rounded-md border border-input bg-background px-3 text-sm"
					value={state.unit}
					onChange={(event) => {
						const unit = durationUnits.find(([candidate]) => candidate === event.target.value);
						if (unit) emit(state.amount, unit[0]);
					}}
				>
					{durationUnits.map(([unit]) => (
						<option key={unit} value={unit}>
							{t(durationUnitLabels[unit])}
						</option>
					))}
				</select>
			</div>
		</FieldFrame>
	);
}
