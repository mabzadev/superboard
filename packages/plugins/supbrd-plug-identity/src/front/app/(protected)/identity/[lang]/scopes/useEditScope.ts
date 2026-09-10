import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import type { LocaleValues } from "../../../../../identity/components/LocaleEditor.js";
import type { ScopeDetail } from "../../../../../identity/services/auth/api.js";

const useEditScope = (scope: ScopeDetail | undefined) => {
	const t = useTranslations();

	const [name, setName] = useState("");
	const [type, setType] = useState("");
	const [note, setNote] = useState("");
	const [locales, setLocales] = useState<{ locale: string; value: string }[] | undefined>(
		undefined,
	);

	useEffect(() => {
		setName(scope?.name ?? "");
		setType(scope?.type ?? "");
		setNote(scope?.note ?? "");
		setLocales(scope?.locales ?? undefined);
	}, [scope]);

	const values = useMemo(
		() => ({
			name,
			type,
			note,
			locales,
		}),
		[name, type, note, locales],
	);

	const errors = useMemo(
		() => ({
			name: values.name.trim().length ? undefined : t("common.fieldIsRequired"),
			type: values.type.trim().length ? undefined : t("common.fieldIsRequired"),
		}),
		[values, t],
	);

	const onChange = (key: string, value: string | string[] | LocaleValues | undefined) => {
		switch (key) {
			case "name":
				setName(value as string);
				break;
			case "type":
				setType(value as string);
				break;
			case "note":
				setNote(value as string);
				break;
			case "locales":
				setLocales(value as LocaleValues | undefined);
				break;
		}
	};

	return {
		values,
		errors,
		onChange,
	};
};

export default useEditScope;
