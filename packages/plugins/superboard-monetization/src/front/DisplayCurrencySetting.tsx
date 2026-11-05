import { Label } from "@superboard/front-ui/ui/label.js";
import { useEffect, useId, useState } from "react";

import {
	getOperatorDisplayCurrency,
	updateOperatorDisplayCurrency,
	type DisplayCurrencySetting as Setting,
} from "./billing/api/billing/billingService.js";
import { useMonetizationI18n } from "./i18n.js";

export default function DisplayCurrencySetting({ projectId }: { projectId: string }) {
	const { t, currency: currencyName } = useMonetizationI18n();
	const id = useId();
	const [setting, setSetting] = useState<Setting | null>(null);
	const [status, setStatus] = useState<"saved" | "load-error" | "save-error" | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let active = true;
		getOperatorDisplayCurrency(projectId)
			.then((loaded) => {
				if (active) setSetting(loaded);
			})
			.catch(() => {
				if (active) setStatus("load-error");
			});
		return () => {
			active = false;
		};
	}, [projectId]);

	const change = (next: string) => {
		if (!setting) return;
		const previous = setting;
		setSetting({ ...setting, display_currency: next });
		setBusy(true);
		setStatus(null);
		updateOperatorDisplayCurrency(projectId, next)
			.then((saved) => {
				setSetting(saved);
				setStatus("saved");
			})
			.catch(() => {
				setSetting(previous);
				setStatus("save-error");
			})
			.finally(() => {
				setBusy(false);
			});
	};

	return (
		<section className="mt-6 space-y-2 border-t pt-5">
			<Label htmlFor={id}>{t("Your display currency")}</Label>
			<p id={`${id}-help`} className="text-sm text-muted-foreground">
				{t(
					"Only for you: other operators choose their own. Revenue totals, charts and customer spending are converted to USD at the exchange rate of each purchase day, then to this currency at the same day’s rate.",
				)}
			</p>
			<select
				id={id}
				aria-describedby={`${id}-help`}
				className="h-9 w-full max-w-xs rounded-md border bg-background px-3 text-sm"
				value={setting?.display_currency ?? ""}
				disabled={busy || !setting}
				onChange={(event) => {
					const value = event.currentTarget.value;
					if (setting?.available_currencies.includes(value)) change(value);
				}}
			>
				{!setting && <option value="" />}
				{setting?.available_currencies.map((code) => (
					<option key={code} value={code}>
						{`${currencyName(code)} (${code})`}
					</option>
				))}
			</select>
			{status === "saved" && <p role="status">{t("Display currency saved.")}</p>}
			{status === "save-error" && <p role="alert">{t("Could not save the display currency.")}</p>}
			{status === "load-error" && <p role="alert">{t("Could not load the display currency.")}</p>}
		</section>
	);
}
