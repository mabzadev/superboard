// components/date-range-picker.tsx

"use client";

import { endOfDay, format, startOfDay, sub } from "date-fns";
import { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CardFooter } from "@/components/ui/card";

type Unit = "days" | "weeks" | "months";
export type Preset = { label: string; value: number; duration: Unit };

const defaultPresets: Preset[] = [
  { label: "Today", value: 0, duration: "days" },
  { label: "Last week", value: 1, duration: "weeks" },
  { label: "Last month", value: 1, duration: "months" },
  { label: "Last 3 months", value: 3, duration: "months" },
];

export function DateRangePicker({
  date,
  setDate,
  presets = defaultPresets, // 👈 allow presets as param, default to built-in
}: {
  date: DateRange | undefined;
  setDate: (date: DateRange | undefined) => void;
  presets?: Preset[];
}) {
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
                {format(date.from, "MMM d, yyyy")} -{" "}
                {format(date.to, "MMM d, yyyy")}
              </span>
            ) : (
              <span>{format(date.from, "MMM d, yyyy")}</span>
            )
          ) : (
            <span className="text-muted-foreground">Pick a date range</span>
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
          />
          <CardFooter className="flex flex-wrap gap-2 border-t p-4 !pt-4">
            {presets.map((preset) => (
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
