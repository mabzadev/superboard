"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { SettingsActions, SettingsRow, SettingsSection } from "@superboard/front-ui/settings-form";
import { Button } from "@superboard/front-ui/ui/button.js";
import { useCallback, useEffect, useState } from "react";

import {
	deleteSupportNotification,
	getSupportNotifications,
	markAllSupportNotificationsRead,
	markSupportNotificationRead,
	snoozeSupportNotification,
	type SupportNotification,
} from "../../api/support/operationsService.js";
import { useSupportI18n } from "../../i18n.js";
import { AccessNotice, SupportLoading, SupportStatus } from "../support/SupportUi.js";

function oneHourFromNow() {
	return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

export default function SupportNotificationsPage() {
	const { t, locale } = useSupportI18n();
	const { selectedProject } = useProjectSelection();
	const projectRef = selectedProject?.id;
	const [notifications, setNotifications] = useState<SupportNotification[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!projectRef) return;
		try {
			setNotifications((await getSupportNotifications(projectRef)).data);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		}
	}, [projectRef, locale]);
	useEffect(() => {
		let active = true;
		Promise.resolve()
			.then(async () => {
				if (active) await load();
			})
			.catch((cause: unknown) => {
				setError(moduleErrorMessage(cause, locale));
			});
		return () => {
			active = false;
		};
	}, [load, locale]);

	const update = async (item: SupportNotification, action: "read" | "snooze" | "delete") => {
		if (!projectRef) return;
		try {
			if (action === "read") {
				await markSupportNotificationRead(projectRef, item.id);
			} else if (action === "snooze") {
				await snoozeSupportNotification(projectRef, item.id, oneHourFromNow());
			} else {
				await deleteSupportNotification(projectRef, item.id);
			}
			await load();
			showSuccessNotification(
				action === "read"
					? t("Notification marked as read")
					: action === "snooze"
						? t("Notification snoozed for one hour")
						: t("Notification removed"),
			);
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};

	const markAllRead = async () => {
		if (!projectRef) return;
		try {
			await markAllSupportNotificationsRead(projectRef);
			await load();
			showSuccessNotification(t("All notifications marked as read"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};

	if (!selectedProject) return <EmptyProject />;
	if (error)
		return (
			<AccessNotice>
				{error}
				{t(
					". Personal notification controls require an active Support membership; project administration remains available in the other Settings tabs.",
				)}
			</AccessNotice>
		);
	if (!notifications) return <SupportLoading />;
	return (
		<div className="pt-4">
			<SettingsSection
				title={t("Recent notifications")}
				description={t("Assignment, SLA and conversation notifications sent to you.")}
			>
				{notifications.length === 0 ? (
					<SettingsRow>
						<p className="text-sm font-medium">{t("No notifications")}</p>
						<p className="text-sm text-kumo-subtle">
							{t("Assignment, SLA and conversation notifications will appear here.")}
						</p>
					</SettingsRow>
				) : (
					notifications.map((item) => (
						<SettingsRow key={item.id}>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="min-w-0">
									<p className="font-medium">{item.title}</p>
									<p className="mt-1 text-sm text-kumo-subtle">{item.body}</p>
									<p className="mt-2 text-xs text-kumo-subtle">
										{new Date(item.created_at).toLocaleString(locale)} · {item.notification_type}
									</p>
								</div>
								<SupportStatus value={item.read_at ? "read" : "unread"} />
							</div>
							<SettingsActions className="gap-2">
								{!item.read_at ? (
									<Button size="sm" variant="outline" onClick={() => void update(item, "read")}>
										{t("Mark read")}
									</Button>
								) : null}
								<Button size="sm" variant="outline" onClick={() => void update(item, "snooze")}>
									{t("Snooze 1 hour")}
								</Button>
								<Button size="sm" variant="ghost" onClick={() => void update(item, "delete")}>
									{t("Remove")}
								</Button>
							</SettingsActions>
						</SettingsRow>
					))
				)}
				<SettingsRow>
					<SettingsActions>
						<Button size="sm" variant="outline" onClick={() => void markAllRead()}>
							{t("Read all")}
						</Button>
					</SettingsActions>
				</SettingsRow>
			</SettingsSection>
		</div>
	);
}
