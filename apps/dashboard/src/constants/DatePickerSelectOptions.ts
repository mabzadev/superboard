export const LAST_7_DAYS = "last_7_d" as const;
export const LAST_28_DAYS = "last_28_d" as const;
export const LAST_30_DAYS = "last_30_d" as const;
export const LAST_90_DAYS = "last_90_d" as const;
export const LAST_12_MONTHS = "last_12_m" as const;
export const LAST_CALENDAR_YEAR = "last_calendar_year" as const;

export const CURRENT_MONTH = "current_month" as const;

export const LAST_MONTH = "last_month" as const;
export const LAST_3_MONTHS = "last_3_months" as const;
export const LAST_6_MONTHS = "last_6_months" as const;
export const LAST_YEAR = "last_year" as const;
export const CUSTOM_DATE = "custom_date" as const;

export interface DatePickerSelectOption {
  value: string;
  label: string;
}

export const defaultSelectOptions: DatePickerSelectOption[] = [
  { value: CUSTOM_DATE, label: "Custom" },
  { value: LAST_7_DAYS, label: "Last 7 days" },
  { value: LAST_28_DAYS, label: "Last 28 days" },
  { value: LAST_30_DAYS, label: "Last 30 days" },
  { value: LAST_90_DAYS, label: "Last 90 days" },
  { value: LAST_12_MONTHS, label: "Last 12 months" },
  { value: LAST_CALENDAR_YEAR, label: "Last calendar year" },
] as const;

export const settingsOverviewSelectOptions: DatePickerSelectOption[] = [
  { value: CURRENT_MONTH, label: "Current month" },
  { value: LAST_MONTH, label: "Last month" },
  { value: LAST_3_MONTHS, label: "Last 3 months" },
  { value: LAST_6_MONTHS, label: "Last 6 months" },
  { value: LAST_YEAR, label: "Last year" },
] as const;
