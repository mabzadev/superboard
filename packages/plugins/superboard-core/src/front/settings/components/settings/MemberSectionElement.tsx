import DeleteConfirm from "@superboard/front-ui/common/delete-confirm.js";
import { ADMIN_ROLE } from "@superboard/front-ui/constants/OptionsConstants.js";
import { useUserContext } from "@superboard/front-ui/context/useUserContext.js";
import type { InstanceMember } from "@superboard/front-ui/types";
import { Avatar, AvatarFallback } from "@superboard/front-ui/ui/avatar.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";

import { useSettingsI18n } from "../../i18n.js";
import AdminOnlyDisplay from "../../lib/adminOnlyDisplay.js";

function initials(name: string): string {
	const parts = name.trim().split(/\s+/u);
	return parts
		.slice(0, 2)
		.map((part) => part[0] ?? "")
		.join("")
		.toUpperCase();
}

const MemberSectionElement = ({
	member,
	onRemove,
}: {
	member: InstanceMember;
	onRemove: (email: string) => void;
}) => {
	const { t } = useSettingsI18n();
	const { userRef } = useUserContext();
	const invited = member.name === t("team.invited");

	return (
		<div className="flex items-center gap-3 p-4">
			<Avatar className="size-8 shrink-0 rounded-full">
				<AvatarFallback className="rounded-full text-[11px] font-medium">
					{initials(invited ? member.email : member.name)}
				</AvatarFallback>
			</Avatar>
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-sm font-medium">{member.name}</span>
				<span className="truncate text-xs text-kumo-subtle">{member.email}</span>
			</div>
			<Badge variant={member.role === ADMIN_ROLE ? "info" : "default"}>
				{t(member.role === ADMIN_ROLE ? "team.administrator" : "team.memberRole")}
			</Badge>
			{userRef.current?.id !== member.id && (
				<AdminOnlyDisplay>
					<DeleteConfirm
						onConfirm={() => {
							onRemove(member.email);
						}}
						title={t("team.removeTitle")}
						description={t("team.removeDescription", { email: member.email })}
						confirmText={t("team.removeConfirm")}
					>
						<Button
							variant="ghost"
							size="sm"
							className="text-destructive"
							aria-label={t("team.remove", { email: member.email })}
						>
							{t("team.removeConfirm")}
						</Button>
					</DeleteConfirm>
				</AdminOnlyDisplay>
			)}
		</div>
	);
};

export default MemberSectionElement;
