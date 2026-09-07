import { useTranslations } from "next-intl";

import { Badge } from "./ui/badge.js";

const SystemLabel = () => {
	const t = useTranslations();

	return <Badge variant="secondary">{t("common.system")}</Badge>;
};

export default SystemLabel;
