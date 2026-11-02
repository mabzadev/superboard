export function getEntryTitle(
	item: { data: Record<string, unknown>; slug: string | null; id: string },
	titleField?: string,
): string {
	const preferred = titleField ? item.data[titleField] : undefined;
	const rawTitle = item.data.title;
	const rawName = item.data.name;
	return (
		(typeof preferred === "string" ? preferred : "") ||
		(typeof rawTitle === "string" ? rawTitle : "") ||
		(typeof rawName === "string" ? rawName : "") ||
		item.slug ||
		item.id
	);
}
