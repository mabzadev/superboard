function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message.toLowerCase();
	if (typeof error === "string") return error.toLowerCase();
	return "";
}

export function isMissingColumnError(error: unknown, column?: string): boolean {
	const message = messageOf(error);
	if (!message) return false;
	if (column && !message.includes(column.toLowerCase())) return false;

	if (message.includes("no such column")) return true;

	if (
		message.includes("does not exist") &&
		message.includes("column") &&
		!message.includes("relation")
	)
		return true;

	return false;
}

export function isMissingTableError(error: unknown): boolean {
	const message = messageOf(error);
	if (!message) return false;

	if (message.includes("no such table")) return true;

	if (message.includes("does not exist") || message.includes("doesn't exist")) {
		return message.includes("relation") || message.includes("table");
	}

	return false;
}
