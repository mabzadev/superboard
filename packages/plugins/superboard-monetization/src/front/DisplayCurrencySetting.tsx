import {
	SettingsRow,
	SettingsSection,
	useSettingsAutosave,
} from "@superboard/front-ui/settings-form";
import { useEffect, useId, useState } from "react";

import {
	getOperatorDisplayCurrency,
	updateOperatorDisplayCurrency,
	type DisplayCurrencySetting as Setting,
} from "./billing/api/billing/billingService.js";
import { useMonetizationI18n } from "./i18n.js";

export function useDisplayCurrency(projectId: string, active: boolean) {
	const [setting, setSetting] = useState<Setting | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);

	useEffect(() => {
		if (!active) return;
		let current = true;
		getOperatorDisplayCurrency(projectId)
			.then((loaded) => {
				if (current) setSetting(loaded);
			})
			.catch(() => {
				if (current) setLoadFailed(true);
			});
		return () => {
			current = false;
		};
	}, [projectId, active]);

	const autosave = useSettingsAutosave({
		resourceKey: setting ? "loaded" : "loading",
		value: setting?.display_currency ?? "",
		enabled: setting !== null,
		save: async (code) => {
			const saved = await updateOperatorDisplayCurrency(projectId, code);
			setSetting(
				(previous) => previous && { ...previous, available_currencies: saved.available_currencies },
			);
		},
	});

	return {
		...autosave,
		setting,
		loadFailed,
		select: (code: string) => {
			setSetting((previous) =>
				previous?.available_currencies.includes(code)
					? { ...previous, display_currency: code }
					: previous,
			);
		},
	};
}

export type DisplayCurrency = ReturnType<typeof useDisplayCurrency>;

export default function DisplayCurrencySetting({ currency }: { currency: DisplayCurrency }) {
	const { t, currency: currencyName } = useMonetizationI18n();
	const id = useId();
	const { setting } = currency;

	return (
		<SettingsSection
			title={t("Display currency")}
			description={t("The currency in which you read revenue amounts.")}
		>
			<SettingsRow>
				<div className="space-y-2">
					<label htmlFor={id} className="block text-sm font-medium">
						{t("Your display currency")}
					</label>
					<select
						id={id}
						aria-describedby={`${id}-help`}
						className="h-9 w-full rounded-md border border-kumo-line bg-kumo-base px-3 text-sm"
						value={setting?.display_currency ?? ""}
						disabled={!setting}
						onChange={(event) => {
							currency.select(event.currentTarget.value);
						}}
					>
						{!setting && <option value="" />}
						{setting?.available_currencies.map((code) => (
							<option key={code} value={code}>
								{`${currencyName(code)} (${code})`}
							</option>
						))}
					</select>
					<p id={`${id}-help`} className="text-xs text-kumo-subtle">
						{t(
							"Only for you: other operators choose their own. Revenue totals, charts and customer spending are converted to USD at the exchange rate of each purchase day, then to this currency at the same day’s rate.",
						)}
					</p>
				</div>
				{currency.loadFailed && (
					<p role="alert" className="text-sm text-kumo-danger">
						{t("Could not load the display currency.")}
					</p>
				)}
			</SettingsRow>
		</SettingsSection>
	);
}
