export function toDatetimeLocalInputValue(value: unknown): string {
	if (typeof value !== "string" || value === "") return "";
	if (value.length === 10) return `${value}T00:00`;
	return value.slice(0, 16);
}

export function fromDatetimeLocalInputValue(value: string): string {
	return value === "" ? "" : `${value}:00.000Z`;
}
