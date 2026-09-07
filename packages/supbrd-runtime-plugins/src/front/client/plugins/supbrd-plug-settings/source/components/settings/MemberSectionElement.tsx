import { ShieldUser, Trash2, User } from "lucide-react";

import DeleteConfirm from "../../../../../../../../../supbrd-front-ui/src/shared/components/common/delete-confirm.js";
import {
	Avatar,
	AvatarFallback,
} from "../../../../../../../../../supbrd-front-ui/src/shared/components/ui/avatar.js";
import { Button } from "../../../../../../../../../supbrd-front-ui/src/shared/components/ui/button.js";
import { ADMIN_ROLE } from "../../../../../../../../../supbrd-front-ui/src/shared/constants/OptionsConstants.js";
import { useUserContext } from "../../../../../../../../../supbrd-front-ui/src/shared/context/useUserContext.js";
import type { InstanceMember } from "../../../../../../../../../supbrd-front-ui/src/shared/types/index.js";
import AdminOnlyDisplay from "../../lib/adminOnlyDisplay.js";

const MemberSectionElement = ({
	member,
	onRemove,
}: {
	member: InstanceMember;
	onRemove: (email: string) => void;
}) => {
	const { userRef } = useUserContext();

	function getInitials(name: string): string {
		if (!name) return "";
		const parts = name.trim().split(/\s+/);
		if (parts.length === 1) {
			return (parts[0]?.[0] ?? "").toUpperCase();
		}
		return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
	}

	return (
		<div className="grid grid-cols-[1fr_140px_40px] items-center px-4 py-3 hover:bg-muted/30 transition-colors">
			{/* Member info */}
			<div className="flex items-center gap-3 min-w-0">
				<Avatar className="h-8 w-8 rounded-full shrink-0">
					<AvatarFallback className="rounded-full text-[11px] font-medium">
						{getInitials(member.name !== "Invited" ? member.name : member.email)}
					</AvatarFallback>
				</Avatar>
				<div className="flex flex-col min-w-0">
					<span className="text-sm font-medium truncate">{member.name}</span>
					<span className="text-xs text-muted-foreground truncate">{member.email}</span>
				</div>
			</div>

			{/* Role */}
			<div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
				{member.role === ADMIN_ROLE ? (
					<ShieldUser className="h-3.5 w-3.5" />
				) : (
					<User className="h-3.5 w-3.5" />
				)}
				{member.role === ADMIN_ROLE ? "Administrator" : "Member"}
			</div>

			{/* Actions */}
			<div className="flex items-center justify-end">
				{userRef.current?.id !== member.id && (
					<AdminOnlyDisplay>
						<DeleteConfirm onConfirm={() => onRemove(member.email)}>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
							>
								<Trash2 className="h-3.5 w-3.5" />
							</Button>
						</DeleteConfirm>
					</AdminOnlyDisplay>
				)}
			</div>
		</div>
	);
};

export default MemberSectionElement;
