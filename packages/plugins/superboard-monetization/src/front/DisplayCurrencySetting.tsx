import { Label } from "@superboard/front-ui/ui/label.js";
import { useEffect, useId, useState } from "react";

import {
	getDisplayCurrency,
	updateDisplayCurrency,
	type DisplayCurrencySetting as Setting,
} from "./billing/api/billing/billingService.js";
import { useMonetizationI18n } from "./i18n.js";

type Currency = Setting["display_currency"];

const currencyLabels: Record<Currency, string> = {
	USD: "US dollar (USD)",
	EUR: "Euro (EUR)",
};

function isCurrency(value: string): value is Currency {
	return Object.hasOwn(currencyLabels, value);
}

export default function DisplayCurrencySetting({ projectId }: { projectId: string }) {
	const { t } = useMonetizationI18n();
	const id = useId();
	const [currency, setCurrency] = useState<Currency | null>(null);
	const [status, setStatus] = useState<"saved" | "load-error" | "save-error" | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let active = true;
		getDisplayCurrency(projectId)
			.then((setting) => {
				if (active) setCurrency(setting.display_currency);
			})
			.catch(() => {
				if (active) setStatus("load-error");
			});
		return () => {
			active = false;
		};
	}, [projectId]);

	const change = (next: Currency) => {
		const previous = currency;
		setCurrency(next);
		setBusy(true);
		setStatus(null);
		updateDisplayCurrency(projectId, next)
			.then((setting) => {
				setCurrency(setting.display_currency);
				setStatus("saved");
			})
			.catch(() => {
				setCurrency(previous);
				setStatus("save-error");
			})
			.finally(() => {
				setBusy(false);
			});
	};

	return (
		<section className="mt-6 space-y-2 border-t pt-5">
			<Label htmlFor={id}>{t("Display currency")}</Label>
			<p id={`${id}-help`} className="text-sm text-muted-foreground">
				{t(
					"Revenue totals, charts and customer spending are converted to USD at the ECB reference rate of each purchase day, then to the display currency at the same day’s rate.",
				)}
			</p>
			<select
				id={id}
				aria-describedby={`${id}-help`}
				className="h-9 w-full max-w-xs rounded-md border bg-background px-3 text-sm"
				value={currency ?? ""}
				disabled={busy || !currency}
				onChange={(event) => {
					const value = event.currentTarget.value;
					if (isCurrency(value)) change(value);
				}}
			>
				{!currency && <option value="" />}
				{Object.entries(currencyLabels).map(([value, label]) => (
					<option key={value} value={value}>
						{t(label)}
					</option>
				))}
			</select>
			{status === "saved" && <p role="status">{t("Display currency saved.")}</p>}
			{status === "save-error" && <p role="alert">{t("Could not save the display currency.")}</p>}
			{status === "load-error" && <p role="alert">{t("Could not load the display currency.")}</p>}
		</section>
	);
}
