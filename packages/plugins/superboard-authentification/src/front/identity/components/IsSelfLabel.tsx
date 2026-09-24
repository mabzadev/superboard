import { useTranslations } from "next-intl";

import { Badge } from "./ui/badge.js";

const IsSelfLabel = () => {
	const t = useTranslations();

	return <Badge>{t("users.you")}</Badge>;
};

export default IsSelfLabel;
