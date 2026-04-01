import { format, startOfDay, endOfDay } from "date-fns";

/**
 * Format a date for API requests: "yyyy-MM-dd HH:mm:ss"
 */
export function formatApiDate(date: Date | string | number): string {
  return format(new Date(date), "yyyy-MM-dd HH:mm:ss");
}

/**
 * Format start of day for API range queries: "yyyy-MM-dd 00:00:00"
 */
export function formatApiStartOfDay(date: Date | string | number): string {
  return format(startOfDay(new Date(date)), "yyyy-MM-dd HH:mm:ss");
}

/**
 * Format end of day for API range queries: "yyyy-MM-dd 23:59:59"
 */
export function formatApiEndOfDay(date: Date | string | number): string {
  return format(endOfDay(new Date(date)), "yyyy-MM-dd HH:mm:ss");
}

/**
 * Short display date: "Mar 17,2026"
 */
export function formatShortDate(date: Date | string | number): string {
  return format(new Date(date), "MMM dd,yyyy");
}

/**
 * Medium display date: "Mar 17, 2026"
 */
export function formatMediumDate(date: Date | string | number): string {
  return format(new Date(date), "MMM dd, yyyy");
}

/**
 * Slash-separated date: "2026/03/17"
 */
export function formatSlashDate(date: Date | string | number): string {
  return format(new Date(date), "yyyy/MM/dd");
}

/**
 * Day-month-year display: "17 Mar 2026"
 */
export function formatDayMonthYear(date: Date | string | number): string {
  return format(new Date(date), "dd MMM yyyy");
}

/**
 * Time only: "14:30:00"
 */
export function formatTime(date: Date | string | number): string {
  return format(new Date(date), "HH:mm:ss");
}
