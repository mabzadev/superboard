"use client";

import { endOfDay, format, startOfDay, sub } from "date-fns";
import type { DateRange } from "react-day-picker";
import { fr } from "react-day-picker/locale/fr";

import {
	type ComponentMessage,
	useComponentI18n,
	useComponentLocale,
} from "../../lib/component-i18n.js";
import { Button } from "../ui/button.js";
import { Calendar } from "../ui/calendar.js";
import { CardFooter } from "../ui/card.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";

type Unit = "days" | "weeks" | "months";
export type Preset = { label: string; value: number; duration: Unit };

const defaultPresets: (Omit<Preset, "label"> & { label: ComponentMessage })[] = [
	{ label: "date.today", value: 0, duration: "days" },
	{ label: "date.lastWeek", value: 1, duration: "weeks" },
	{ label: "date.lastMonth", value: 1, duration: "months" },
	{ label: "date.last3Months", value: 3, duration: "months" },
];

export function DateRangePicker({
	date,
	setDate,
	presets,
}: {
	date: DateRange | undefined;
	setDate: (date: DateRange | undefined) => void;
	presets?: Preset[];
}) {
	const t = useComponentI18n();
	const locale = useComponentLocale() === "fr" ? fr : undefined;
	const shown = presets ?? defaultPresets.map((preset) => ({ ...preset, label: t(preset.label) }));
	const day = (value: Date) => format(value, "PP", { locale });
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					className="w-fit justify-start text-left font-normal rounded-md border-sidebar-border shadow-none hover:bg-secondary"
				>
					{date?.from ? (
						date.to ? (
							<span>
								{day(date.from)} - {day(date.to)}
							</span>
						) : (
							<span>{day(date.from)}</span>
						)
					) : (
						<span className="text-muted-foreground">{t("date.placeholder")}</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="start">
				<div className="flex flex-col gap-4">
					<Calendar
						mode="range"
						defaultMonth={date?.from}
						selected={date}
						onSelect={setDate}
						numberOfMonths={2}
						locale={locale}
					/>
					<CardFooter className="flex flex-wrap gap-2 border-t p-4 !pt-4">
						{shown.map((preset) => (
							<Button
								key={preset.label}
								variant="outline"
								size="sm"
								className="flex-1"
								onClick={() => {
									const now = new Date();
									const beginning = sub(now, {
										[preset.duration]: preset.value,
									});
									setDate({ from: startOfDay(beginning), to: endOfDay(now) });
								}}
							>
								{preset.label}
							</Button>
						))}
					</CardFooter>
				</div>
			</PopoverContent>
		</Popover>
	);
}
