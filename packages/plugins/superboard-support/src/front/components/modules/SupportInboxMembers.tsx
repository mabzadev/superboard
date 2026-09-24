import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import { useCallback, useEffect, useState } from "react";

import {
	listSupportInboxMembers,
	listSupportMemberships,
	linkSupportInboxMember,
	unlinkSupportInboxMember,
	type SupportMembership,
} from "../../api/support/workforceService.js";
import { useSupportI18n } from "../../i18n.js";
import { SupportError, SupportLoadMore, useSupportCollection } from "../support/SupportUi.js";

export function SupportInboxMembers({ project, inboxId }: { project: string; inboxId: string }) {
	const { t } = useSupportI18n();
	const agents = useSupportCollection(project, listSupportMemberships);
	const [members, setMembers] = useState<SupportMembership[]>([]);
	const [selected, setSelected] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const load = useCallback(async () => {
		try {
			setMembers((await listSupportInboxMembers(project, inboxId)).data);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		}
	}, [project, inboxId]);
	useEffect(() => {
		let active = true;
		void listSupportInboxMembers(project, inboxId)
			.then((result) => {
				if (active) {
					setMembers(result.data);
					setError(null);
				}
			})
			.catch((cause: unknown) => {
				if (active) setError(moduleErrorMessage(cause));
			});
		return () => {
			active = false;
		};
	}, [project, inboxId]);
	const change = async (id: string, add: boolean) => {
		setBusy(true);
		try {
			if (add) await linkSupportInboxMember(project, inboxId, id);
			else await unlinkSupportInboxMember(project, inboxId, id);
			await load();
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className="space-y-4">
			<SupportError message={error ?? agents.error} />
			<div className="flex flex-wrap items-end gap-3">
				<div className="space-y-2">
					<Label htmlFor="inbox-member">{t("Member")}</Label>
					<select
						id="inbox-member"
						className="block h-9 rounded-md border bg-background px-3"
						value={selected}
						onChange={(event) => {
							setSelected(event.target.value);
						}}
					>
						<option value="">{t("Select")}</option>
						{agents.items
							.filter((agent) => agent.active && !members.some((member) => member.id === agent.id))
							.map((agent) => (
								<option key={agent.id} value={agent.id}>
									{agent.display_name}
								</option>
							))}
					</select>
				</div>
				<Button disabled={busy || !selected} onClick={() => void change(selected, true)}>
					{t("Add member")}
				</Button>
			</div>
			<SupportLoadMore
				visible={agents.hasMore}
				loading={agents.loadingMore}
				onClick={() => void agents.loadMore()}
			/>
			{members.map((member) => (
				<div key={member.id} className="flex items-center justify-between rounded-md border p-4">
					<span>{member.display_name}</span>
					<Button variant="outline" disabled={busy} onClick={() => void change(member.id, false)}>
						{t("Remove")}
					</Button>
				</div>
			))}
		</section>
	);
}
