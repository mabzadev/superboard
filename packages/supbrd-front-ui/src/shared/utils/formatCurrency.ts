const countryDollar = /[A-Z]{1,3}\$|\$[A-Z]{1,3}/g;

export function formatCurrencyFromCents(
	cents: number,
	locale: string = globalThis.document?.documentElement.lang ||
		globalThis.navigator?.language ||
		"en-US",
	currency: string = "USD",
): string {
	const dollars = cents ? cents / 100 : 0;

	const formatted = new Intl.NumberFormat(locale, {
		style: "currency",
		currency,
		currencyDisplay: "symbol",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(dollars);

	return formatted.replace(countryDollar, "$");
}
