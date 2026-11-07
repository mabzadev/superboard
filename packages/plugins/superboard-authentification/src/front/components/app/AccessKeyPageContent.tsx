"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import {
	EmptyProject,
	ModulePage,
	moduleErrorMessage,
} from "@superboard/front-ui/modules/ModulePage.js";
import { SettingsActions, SettingsRow, SettingsSection } from "@superboard/front-ui/settings-form";
import { Alert, AlertDescription, AlertTitle } from "@superboard/front-ui/ui/alert.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superboard/front-ui/ui/dialog.js";
import { Copy, RefreshCw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { getAccessKey, rotateAccessKey, type AccessKeyInfo } from "../../api/app/appService.js";
import { RenderCodeBlock } from "../developers/SetupShared.js";
import { useAccessKeyI18n } from "./access-key-i18n.js";

export default function AccessKeyPageContent() {
	const { locale, t } = useAccessKeyI18n();
	const { selectedProject } = useProjectSelection();
	const [key, setKey] = useState<AccessKeyInfo | null>(null);
	const [secret, setSecret] = useState<string>();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [rotateOpen, setRotateOpen] = useState(false);

	const load = useCallback(async () => {
		if (!selectedProject) return;
		setLoading(true);
		try {
			setKey(await getAccessKey(selectedProject.id));
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		} finally {
			setLoading(false);
		}
	}, [selectedProject]);

	useEffect(() => {
		void load();
	}, [load]);

	const rotate = async () => {
		if (!selectedProject) return;
		setLoading(true);
		try {
			const next = await rotateAccessKey(selectedProject.id);
			setKey(next);
			setSecret(next.secret);
			setRotateOpen(false);
			showSuccessNotification(t("rotated"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setLoading(false);
		}
	};

	const copySecret = async () => {
		if (!secret) return;
		await navigator.clipboard.writeText(secret);
		showSuccessNotification(t("copied"));
	};

	const formatDate = (value: string | null | undefined, fallback: string) =>
		value ? new Date(value).toLocaleString(locale) : fallback;
	const displayedKey = secret || (key ? `${key.prefix}••••••••••••••••` : error ? "—" : t("noKey"));
	const status = key
		? key.revoked_at
			? "revoked"
			: "active"
		: error
			? "unavailable"
			: "notConfigured";

	return (
		<ModulePage title={t("title")} description={t("description")} error={error}>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="flex max-w-3xl flex-col gap-8">
					<div className="space-y-3">
						<SettingsSection title={t("keyTitle")} description={t("keyDescription")}>
							<SettingsRow>
								<div className="flex items-center justify-between gap-4">
									<p className="text-sm font-medium">{t("status")}</p>
									<Badge
										variant={
											status === "active"
												? "success"
												: status === "revoked"
													? "destructive"
													: "default"
										}
									>
										{t(status)}
									</Badge>
								</div>
							</SettingsRow>
							<SettingsRow>
								<p className="text-xs text-kumo-subtle">{t("key")}</p>
								<div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
									{secret || key ? (
										<code className="min-w-0 flex-1 break-all text-sm">{displayedKey}</code>
									) : (
										<span className="min-w-0 flex-1 text-sm text-kumo-subtle">{displayedKey}</span>
									)}
									<Button
										variant="outline"
										size="icon"
										aria-label={t("copy")}
										disabled={!secret}
										onClick={() => {
											copySecret().catch(() => undefined);
										}}
									>
										<Copy className="size-4" />
									</Button>
								</div>
								{secret ? (
									<Alert variant="destructive">
										<ShieldAlert className="size-4" />
										<AlertTitle>{t("oneTimeTitle")}</AlertTitle>
										<AlertDescription>{t("oneTimeDescription")}</AlertDescription>
									</Alert>
								) : null}
							</SettingsRow>
							<Metadata label={t("prefix")}>{key?.prefix || "—"}</Metadata>
							<Metadata label={t("created")}>{formatDate(key?.created_at, "—")}</Metadata>
							<Metadata label={t("lastUsed")}>{formatDate(key?.last_used_at, t("never"))}</Metadata>
						</SettingsSection>
						<SettingsActions>
							<Button
								variant="outline"
								disabled={loading}
								onClick={() => {
									load().catch(() => undefined);
								}}
							>
								{t("refresh")}
							</Button>
							<Button
								disabled={loading}
								onClick={() => {
									setRotateOpen(true);
								}}
							>
								<RefreshCw className="size-4" />
								{key ? t("rotate") : t("create")}
							</Button>
						</SettingsActions>
					</div>

					<SettingsSection title={t("sdkTitle")} description={t("sdkDescription")}>
						<SettingsRow>
							<RenderCodeBlock
								data={[
									{
										language: "typescript",
										filename: "superboard.ts",
										code: `SuperBoard.initialize({\n  accessKey: "${secret || "YOUR_ACCESS_KEY"}"\n});`,
									},
									{
										language: "dart",
										filename: "main.dart",
										code: `await SuperBoard.initialize(\n  accessKey: '${secret || "YOUR_ACCESS_KEY"}',\n);`,
									},
								]}
							/>
						</SettingsRow>
					</SettingsSection>
				</div>
			)}

			<Dialog open={rotateOpen} onOpenChange={setRotateOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{key ? t("rotateTitle") : t("createTitle")}</DialogTitle>
						<DialogDescription>
							{key ? t("rotateDescription") : t("createDescription")}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setRotateOpen(false);
							}}
						>
							{t("cancel")}
						</Button>
						<Button
							disabled={loading}
							onClick={() => {
								rotate().catch(() => undefined);
							}}
						>
							{key ? t("rotateConfirm") : t("createConfirm")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</ModulePage>
	);
}

function Metadata({ label, children }: { label: string; children: ReactNode }) {
	return (
		<SettingsRow className="space-y-1">
			<p className="text-xs text-kumo-subtle">{label}</p>
			<p className="break-all text-sm font-medium">{children}</p>
		</SettingsRow>
	);
}
