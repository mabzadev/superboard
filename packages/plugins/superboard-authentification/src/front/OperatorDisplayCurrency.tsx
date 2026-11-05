import { useFrontContext, usePluginEnabled } from "@superboard/front-ui/context";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import { useEffect, useId, useState } from "react";

import {
	getOperatorDisplayCurrency,
	updateOperatorDisplayCurrency,
	type OperatorDisplayCurrency as Setting,
} from "./api/billing/billingService.js";
import { operatorMessages } from "./operator-messages.js";

function currencyLabel(code: string, locale: string) {
	try {
		const name = new Intl.DisplayNames([locale], { type: "currency", fallback: "none" }).of(code);
		return name ? `${name.charAt(0).toLocaleUpperCase(locale)}${name.slice(1)} (${code})` : code;
	} catch {
		return code;
	}
}

export function OperatorDisplayCurrency() {
	const billing = usePluginEnabled("superboard-billing");
	const { selectedProject } = useProjectSelection();
	if (!billing || !selectedProject) return null;
	return <DisplayCurrencyField key={selectedProject.id} projectId={selectedProject.id} />;
}

function DisplayCurrencyField({ projectId }: { projectId: string }) {
	const { locale } = useFrontContext();
	const text = operatorMessages[locale];
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
		<section className="grid gap-2 border-t pt-5">
			<Label htmlFor={id}>{text.displayCurrency}</Label>
			<p id={`${id}-help`} className="text-sm text-muted-foreground">
				{text.displayCurrencyHelp}
			</p>
			<select
				id={id}
				aria-describedby={`${id}-help`}
				className="h-9 w-full rounded-md border bg-background px-3 text-sm"
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
						{currencyLabel(code, locale)}
					</option>
				))}
			</select>
			{status === "saved" && <p role="status">{text.displayCurrencySaved}</p>}
			{status === "save-error" && <p role="alert">{text.displayCurrencySaveError}</p>}
			{status === "load-error" && <p role="alert">{text.displayCurrencyLoadError}</p>}
		</section>
	);
}
