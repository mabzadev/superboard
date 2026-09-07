import { useTranslations } from "next-intl";

import type { UserDetail } from "../services/auth/api.js";
import { Badge } from "./ui/badge.js";

const UserEmailVerified = ({ user }: { user: UserDetail }) => {
	const t = useTranslations();
	return user.emailVerified ? (
		<Badge>{t("users.emailVerified")}</Badge>
	) : (
		<Badge variant="destructive">{t("users.emailNotVerified")}</Badge>
	);
};

export default UserEmailVerified;
