const formatters = new Map<string, Intl.NumberFormat>();

function currentFormatter(): Intl.NumberFormat {
	const locale =
		globalThis.document?.documentElement.lang || globalThis.navigator?.language || "en-US";
	let formatter = formatters.get(locale);
	if (!formatter) {
		formatter = new Intl.NumberFormat(locale);
		formatters.set(locale, formatter);
	}
	return formatter;
}

export const numberFormatter = {
	format: (value: number | bigint): string => currentFormatter().format(value),
};
