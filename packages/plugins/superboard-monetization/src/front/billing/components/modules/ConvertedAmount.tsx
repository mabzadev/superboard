import { useMonetizationI18n } from "../../../i18n.js";

export type ConvertibleAmount = {
	micros: number | null | undefined;
	currency: string | null | undefined;
	displayMicros?: number | null;
	displayCurrency?: string | null;
	rateDate?: string | null;
};

type Translate = (message: string, values?: Record<string, unknown>) => string;

export function formatMoney(micros: number, currency: string | null | undefined, locale: string) {
	const amount = micros / 1_000_000;
	const decimal = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(amount);
	if (!currency) return decimal;
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency: currency.toUpperCase(),
		}).format(amount);
	} catch {
		return `${decimal} ${currency}`;
	}
}

export function convertedLabel(amount: ConvertibleAmount, t: Translate, locale: string) {
	if (!amount.displayCurrency || amount.micros == null) return null;
	if (amount.currency?.toUpperCase() === amount.displayCurrency) return null;
	if (amount.displayMicros != null)
		return formatMoney(amount.displayMicros, amount.displayCurrency, locale);
	return amount.rateDate ? t("No exchange rate for this currency") : t("Conversion pending");
}

export function amountText(amount: ConvertibleAmount, t: Translate, locale: string) {
	if (amount.micros == null) return "—";
	const original = formatMoney(amount.micros, amount.currency, locale);
	const converted = convertedLabel(amount, t, locale);
	return converted ? `${original} · ${converted}` : original;
}

export function ConvertedAmount(amount: ConvertibleAmount) {
	const { t, locale } = useMonetizationI18n();
	const converted = convertedLabel(amount, t, locale);
	return (
		<>
			<span className="block">
				{amount.micros == null ? "—" : formatMoney(amount.micros, amount.currency, locale)}
			</span>
			{converted && <span className="block text-xs text-muted-foreground">{converted}</span>}
		</>
	);
}
