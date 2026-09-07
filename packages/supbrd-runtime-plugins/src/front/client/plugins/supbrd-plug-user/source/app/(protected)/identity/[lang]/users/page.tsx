"use client";

import { PlusIcon } from "@heroicons/react/16/solid";
import { useTranslations } from "next-intl";
import { useState } from "react";

import Breadcrumb from "../../../../../identity/components/Breadcrumb.js";
import InviteUserModal from "../../../../../identity/components/InviteUserModal.js";
import { Button } from "../../../../../identity/components/ui/button.js";
import UserTable from "../../../../../identity/components/UserTable.js";
import { useAuth } from "../../../../../identity/melody-react.js";
import { accessTool } from "../../../../../identity/tools/index.js";

const Page = () => {
	const t = useTranslations();
	const { userInfo } = useAuth();

	const canWriteUser = accessTool.isAllowedAccess(accessTool.Access.WriteUser, userInfo?.roles);

	const [showInviteModal, setShowInviteModal] = useState(false);

	return (
		<section className="flex flex-col">
			<Breadcrumb
				page={{ label: t("users.title") }}
				action={
					canWriteUser && (
						<Button
							variant="outline"
							size="sm"
							data-testid="inviteUserBtn"
							onClick={() => setShowInviteModal(true)}
						>
							<div className="flex items-center gap-2">
								<PlusIcon className="w-4 h-4" />
								{t("users.invite")}
							</div>
						</Button>
					)
				}
			/>
			<InviteUserModal
				show={showInviteModal}
				onClose={() => setShowInviteModal(false)}
				onInvited={() => setShowInviteModal(false)}
			/>
			<UserTable orgId={null} />
		</section>
	);
};

export default Page;
