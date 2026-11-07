import { Input, Select } from "@superboard/front-ui/kumo";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { useId, useState, type ReactNode } from "react";

import { useStudioI18n } from "./i18n.js";

export type FeatureState = "enabled" | "off" | "incomplete";

const stateLabels = { enabled: "Enabled", off: "Off", incomplete: "To complete" } as const;
const stateVariants = { enabled: "success", off: "default", incomplete: "warning" } as const;

export function StateBadge({ state }: { state: FeatureState }) {
	const { t } = useStudioI18n();
	return <Badge variant={stateVariants[state]}>{t(stateLabels[state])}</Badge>;
}

export function SettingsSubsection({
	title,
	description,
	children,
}: {
	title: ReactNode;
	description: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="space-y-3">
			<div className="space-y-1">
				<h3 className="text-sm font-semibold">{title}</h3>
				<p className="text-sm text-kumo-subtle">{description}</p>
			</div>
			<div className="divide-y divide-kumo-line rounded-lg border border-kumo-line">{children}</div>
		</section>
	);
}

const unitHours = { hours: 1, days: 24 } as const;
type HourUnit = keyof typeof unitHours;

function isHourUnit(value: unknown): value is HourUnit {
	return value === "hours" || value === "days";
}

function hourState(hours: number) {
	const unit: HourUnit = hours > 0 && hours % unitHours.days === 0 ? "days" : "hours";
	return { unit, amount: String(hours / unitHours[unit]), emitted: hours };
}

export function HoursField({
	label,
	description,
	value,
	min = 0,
	max,
	onChange,
}: {
	label: string;
	description?: string;
	value: number;
	min?: number;
	max: number;
	onChange(hours: number): void;
}) {
	const { t } = useStudioI18n();
	const id = useId();
	const [state, setState] = useState(() => hourState(value));
	if (state.emitted !== value) setState(hourState(value));
	const emit = (amount: string, unit: HourUnit) => {
		const number = Number(amount);
		if (amount.trim() === "" || !Number.isFinite(number)) {
			setState({ unit, amount, emitted: value });
			return;
		}
		const requested = Math.round(number * unitHours[unit]);
		const hours = Math.min(max, Math.max(min, requested));
		setState({
			unit,
			amount: hours === requested ? amount : String(hours / unitHours[unit]),
			emitted: hours,
		});
		onChange(hours);
	};
	return (
		<div className="space-y-2">
			<label htmlFor={id} className="block text-sm font-medium">
				{label}
			</label>
			<div className="flex gap-2">
				<Input
					id={id}
					className="min-w-0 flex-1"
					inputMode="numeric"
					aria-describedby={description ? `${id}-description` : undefined}
					value={state.amount}
					onChange={(event) => {
						emit(event.target.value, state.unit);
					}}
				/>
				<Select
					aria-label={t("Unit")}
					value={state.unit}
					onValueChange={(next) => {
						if (isHourUnit(next)) emit(state.amount, next);
					}}
					items={{ hours: t("hours"), days: t("days") }}
				/>
			</div>
			{description && (
				<p id={`${id}-description`} className="text-xs text-kumo-subtle">
					{description}
				</p>
			)}
		</div>
	);
}
