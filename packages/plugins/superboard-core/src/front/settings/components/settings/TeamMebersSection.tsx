"use client";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showGenericError,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { SettingsActions, SettingsRow, SettingsSection } from "@superboard/front-ui/settings-form";
import type { InstanceMember } from "@superboard/front-ui/types";
import { Button } from "@superboard/front-ui/ui/button.js";
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
			<SettingsSection title={t("team.title")} description={t("team.description")}>
				{members.map((member) => (
					<MemberSectionElement
						key={member.id}
						member={member}
						onRemove={(email) => void handleRemoveMember(email)}
					/>
				))}
				{membersQuery.isSuccess && members.length === 0 ? (
					<SettingsRow>
						<p className="text-sm text-kumo-subtle">{t("team.empty")}</p>
					</SettingsRow>
				) : null}
			</SettingsSection>
			<SettingsActions>
				<Button variant="outline" size="sm" onClick={() => setInviteDialogOpen(true)}>
					{t("team.add")}
				</Button>
			</SettingsActions>

			<AddNewMemberDialog
				open={inviteDialogOpen}
				onOpenChange={setInviteDialogOpen}
				handleInviteMember={(email, role) => void handleInviteMember(email, role)}
			/>
		</div>
	);
};

export default TeamMebersSection;
