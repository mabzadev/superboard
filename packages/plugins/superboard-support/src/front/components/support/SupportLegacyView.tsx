import { useEffect } from "react";

import { useSupportI18n } from "../../i18n.js";

export function SupportLegacyView({ destination }: { destination: string }) {
	const { t } = useSupportI18n();
	useEffect(() => {
		const current = new URL(window.location.href);
		const target = new URL(destination, current.origin);
		for (const [key, value] of current.searchParams) {
			if (key === "lang" || key === "inbox" || key === "portal")
				target.searchParams.set(key, value);
		}
		window.location.replace(target);
	}, [destination]);
	return <p className="p-6 text-sm text-muted-foreground">{t("Opening…")}</p>;
}
