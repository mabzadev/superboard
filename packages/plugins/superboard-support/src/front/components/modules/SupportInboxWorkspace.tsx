import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import { Switch } from "@superboard/front-ui/ui/switch.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { useState } from "react";

import {
	createSupportInbox,
	listSupportInboxes,
	updateSupportInbox,
	type SupportInbox,
} from "../../api/support/workforceService.js";
import { useSupportI18n } from "../../i18n.js";
import { SupportEntityPage } from "../support/SupportEntityPage.js";
import { SupportDetail } from "../support/SupportModulePage.js";
import { SupportError } from "../support/SupportUi.js";
import SupportAutomationsPage from "./SupportAutomationsPage.js";
import SupportChannelsPage from "./SupportChannelsPage.js";
import { SupportInboxMembers } from "./SupportInboxMembers.js";
import InboxPage from "./SupportInboxPage.js";
import SupportProactivePage from "./SupportProactivePage.js";
import { SupportQualityPage } from "./SupportQualityPage.js";
import SupportReportsPage from "./SupportReportsPage.js";

export default function SupportInboxWorkspace() {
	const { t } = useSupportI18n();
	const [channel, setChannel] = useState("widget");
	if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("id"))
		return <InboxPage />;
	return (
		<SupportEntityPage<SupportInbox>
			title={t("Inbox")}
			resource="workforce/inboxes"
			parameter="inbox"
			path="/support/inbox"
			list={listSupportInboxes}
			creationFields={
				<>
					<Label htmlFor="new-inbox-channel">{t("Channel")}</Label>
					<select
						id="new-inbox-channel"
						className="h-9 rounded-md border bg-background px-3"
						value={channel}
						onChange={(event) => {
							setChannel(event.target.value);
						}}
					>
						{[
							"api",
							"widget",
							"email_google",
							"email_microsoft",
							"smtp",
							"whatsapp_cloud",
							"facebook_messenger",
							"instagram",
							"twilio_sms",
							"twilio_voice",
							"telegram",
							"line",
							"twitter",
						].map((value) => (
							<option key={value} value={value}>
								{value}
							</option>
						))}
					</select>
				</>
			}
			create={(project, name) =>
				createSupportInbox(project, {
					name,
					identifier: crypto.randomUUID(),
					channel_type: channel,
					status: "active",
					auto_assignment: true,
					allow_reopen: true,
					csat_enabled: true,
				})
			}
		>
			{(item, project, update) => (
				<InboxDetails key={item.id} inbox={item} project={project} update={update} />
			)}
		</SupportEntityPage>
	);
}

const sections = {
	general: "General",
	channels: "Connections",
	members: "Members",
	automations: "Automations",
	proactive: "Proactive Support",
	reports: "Reports",
};

function InboxDetails({
	inbox,
	project,
	update,
}: {
	inbox: SupportInbox;
	project: string;
	update: (item: SupportInbox) => void;
}) {
	const { t } = useSupportI18n();
	const [tab, setTab] = useState(() =>
		new URLSearchParams(window.location.search).get("tab") === "conversations"
			? "conversations"
			: "settings",
	);
	const [section, setSection] = useState(() => {
		const requested = new URLSearchParams(window.location.search).get("section");
		return requested && Object.hasOwn(sections, requested) ? requested : "general";
	});
	const select = (key: string, value: string) => {
		const url = new URL(window.location.href);
		url.searchParams.set(key, value);
		window.history.replaceState(null, "", url);
		if (key === "tab") setTab(value);
		else setSection(value);
	};
	return (
		<SupportDetail>
			<Tabs
				value={tab}
				onValueChange={(value) => {
					select("tab", value);
				}}
			>
				<TabsList aria-label={t("Inbox sections")}>
					<TabsTrigger value="conversations">{t("Conversations")}</TabsTrigger>
					<TabsTrigger value="settings">{t("Settings")}</TabsTrigger>
				</TabsList>
				<TabsContent value="conversations">
					<InboxPage inboxId={inbox.id} />
				</TabsContent>
				<TabsContent value="settings">
					<Tabs
						value={section}
						onValueChange={(value) => {
							select("section", value);
						}}
					>
						<TabsList aria-label={t("Settings sections")} className="h-auto flex-wrap">
							{Object.entries(sections).map(([value, label]) => (
								<TabsTrigger key={value} value={value}>
									{t(label)}
								</TabsTrigger>
							))}
						</TabsList>
						<TabsContent value="general">
							<InboxSettings inbox={inbox} project={project} update={update} />
						</TabsContent>
						<TabsContent value="members">
							<SupportInboxMembers project={project} inboxId={inbox.id} />
						</TabsContent>
						<TabsContent value="channels">
							<SupportChannelsPage inboxId={inbox.id} />
						</TabsContent>
						<TabsContent value="automations">
							<SupportAutomationsPage inboxId={inbox.id} />
						</TabsContent>
						<TabsContent value="proactive">
							<SupportProactivePage inboxId={inbox.id} />
						</TabsContent>
						<TabsContent value="reports">
							<SupportReportsPage inboxId={inbox.id} />
							<SupportQualityPage inboxId={inbox.id} />
						</TabsContent>
					</Tabs>
				</TabsContent>
			</Tabs>
		</SupportDetail>
	);
}

function InboxSettings({
	inbox,
	project,
	update,
}: {
	inbox: SupportInbox;
	project: string;
	update: (item: SupportInbox) => void;
}) {
	const { t } = useSupportI18n();
	const [draft, setDraft] = useState(inbox);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const save = async () => {
		setSaving(true);
		try {
			const result = await updateSupportInbox(project, inbox.id, {
				name: draft.name.trim(),
				status: draft.status,
				auto_assignment: draft.auto_assignment,
				allow_reopen: draft.allow_reopen,
				csat_enabled: draft.csat_enabled,
			});
			update(result.data);
			setDraft(result.data);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		} finally {
			setSaving(false);
		}
	};
	return (
		<form
			className="space-y-5 rounded-md border p-5"
			onSubmit={(event) => {
				event.preventDefault();
				void save().catch((cause: unknown) => {
					setError(moduleErrorMessage(cause));
				});
			}}
		>
			<SupportError message={error} />
			<Label htmlFor="inbox-name">{t("Name")}</Label>
			<Input
				id="inbox-name"
				value={draft.name}
				required
				onChange={(event) => {
					setDraft({ ...draft, name: event.target.value });
				}}
			/>
			<Label htmlFor="inbox-identifier">{t("Identifier")}</Label>
			<Input id="inbox-identifier" value={inbox.identifier} readOnly />
			<p className="text-sm text-muted-foreground">
				{t("Channel")}: {inbox.channel_type}
			</p>
			{(
				[
					["auto_assignment", "Automatic assignment"],
					["allow_reopen", "Allow customer reopening"],
					["csat_enabled", "Customer satisfaction"],
				] as const
			).map(([key, label]) => (
				<div className="flex items-center justify-between" key={key}>
					<Label htmlFor={`inbox-${key}`}>{t(label)}</Label>
					<Switch
						id={`inbox-${key}`}
						checked={draft[key]}
						onCheckedChange={(value) => {
							setDraft({ ...draft, [key]: value });
						}}
					/>
				</div>
			))}
			<div className="flex items-center justify-between">
				<Label htmlFor="inbox-enabled">{t("Enabled")}</Label>
				<Switch
					id="inbox-enabled"
					checked={draft.status !== "disabled"}
					onCheckedChange={(enabled) => {
						setDraft({ ...draft, status: enabled ? "active" : "disabled" });
					}}
				/>
			</div>
			<div className="flex justify-end">
				<Button type="submit" disabled={saving || !draft.name.trim()}>
					{t("Save settings")}
				</Button>
			</div>
		</form>
	);
}
