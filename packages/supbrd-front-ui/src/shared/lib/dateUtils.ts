import { format, startOfDay, endOfDay } from "date-fns";

export function formatApiDate(date: Date | string | number): string {
	return format(new Date(date), "yyyy-MM-dd HH:mm:ss");
}

export function formatApiStartOfDay(date: Date | string | number): string {
	return format(startOfDay(new Date(date)), "yyyy-MM-dd HH:mm:ss");
}

export function formatApiEndOfDay(date: Date | string | number): string {
	return format(endOfDay(new Date(date)), "yyyy-MM-dd HH:mm:ss");
}

export function formatShortDate(date: Date | string | number): string {
	return format(new Date(date), "MMM dd,yyyy");
}

export function formatMediumDate(date: Date | string | number): string {
	return format(new Date(date), "MMM dd, yyyy");
}

export function formatSlashDate(date: Date | string | number): string {
	return format(new Date(date), "yyyy/MM/dd");
}

export function formatDayMonthYear(date: Date | string | number): string {
	return format(new Date(date), "dd MMM yyyy");
}

export function formatTime(date: Date | string | number): string {
	return format(new Date(date), "HH:mm:ss");
}
