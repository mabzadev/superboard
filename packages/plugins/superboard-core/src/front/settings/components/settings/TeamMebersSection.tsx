"use client";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showGenericError,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import type { InstanceMember } from "@superboard/front-ui/types";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { trackEvent, EVENTS } from "../../analytics/index.js";
import {
	useAddMemberMutation,
	useRemoveMemberMutation,
} from "../../hooks/mutations/useInstanceMutations.js";
import { useInstanceMembersQuery } from "../../hooks/queries/useInstanceQueries.js";
import { useSettingsI18n } from "../../i18n.js";
import AddNewMemberDialog from "./AddNewMemberDialog.js";
import MemberSectionElement from "./MemberSectionElement.js";

/** Environment settings › Team: members of the selected instance. */
const TeamMebersSection = () => {
	const { t } = useSettingsI18n();
	const { selectedInstance } = useProjectSelection();
	const membersQuery = useInstanceMembersQuery(selectedInstance?.id);
	const addMemberMutation = useAddMemberMutation(selectedInstance?.id);
	const removeMemberMutation = useRemoveMemberMutation(selectedInstance?.id);
	const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
	const invited = t("team.invited");

	const members = useMemo(
		(): InstanceMember[] =>
			(membersQuery.data?.members ?? []).map(
				(member: { user: { id: string; name?: string; email: string }; role: string }) => ({
					id: member.user.id,
					name: member.user.name || invited,
					email: member.user.email,
					role: member.role,
				}),
			),
		[membersQuery.data, invited],
	);

	const handleInviteMember = async (email: string, role: string) => {
		try {
			await addMemberMutation.mutateAsync({ email, role });
			trackEvent(EVENTS.TEAM_MEMBER_INVITED);
			setInviteDialogOpen(false);
		} catch {
			showGenericError();
		}
	};

	const handleRemoveMember = async (email: string) => {
		try {
			await removeMemberMutation.mutateAsync(email);
			showSuccessNotification(t("team.removed"));
		} catch {
			showGenericError();
		}
	};

	return (
		<div className="flex flex-col gap-4">
			{/* Section header */}
			<div className="flex items-center gap-3">
				<div className="flex flex-col gap-0.5 flex-1">
					<h2 className="text-sm font-semibold">{t("team.title")}</h2>
					<span className="text-xs text-muted-foreground">{t("team.description")}</span>
				</div>
				<Button variant="outline" size="sm" onClick={() => setInviteDialogOpen(true)}>
					<Plus className="h-3.5 w-3.5" />
					{t("team.add")}
				</Button>
			</div>

			{/* Table */}
			<div className="rounded-xl border border-sidebar-border overflow-hidden">
				{/* Table header */}
				<div className="grid grid-cols-[1fr_140px_40px] items-center px-4 py-2.5 bg-muted/40 border-b border-sidebar-border">
					<span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
						{t("team.member")}
					</span>
					<span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right">
						{t("team.role")}
					</span>
					<span />
				</div>
				{/* Table rows */}
				<div className="divide-y divide-sidebar-border">
					{members.map((member) => (
						<MemberSectionElement
							key={member.id}
							member={member}
							onRemove={(email) => void handleRemoveMember(email)}
						/>
					))}
				</div>
			</div>

			<AddNewMemberDialog
				open={inviteDialogOpen}
				onOpenChange={setInviteDialogOpen}
				handleInviteMember={(email, role) => void handleInviteMember(email, role)}
			/>
		</div>
	);
};

export default TeamMebersSection;
