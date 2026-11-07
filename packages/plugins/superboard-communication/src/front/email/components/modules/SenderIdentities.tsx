import DeleteConfirm from "@superboard/front-ui/common/delete-confirm.js";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Button, Select, SwitchField } from "@superboard/front-ui/kumo";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { cn } from "@superboard/front-ui/lib/utils.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import {
	SettingsActions,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
} from "@superboard/front-ui/settings-form";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { useAutosave } from "../../../marketing/studio/settings-autosave.js";
import { StateBadge, type FeatureState } from "../../../marketing/studio/settings-ui.js";
import {
	deleteSmtpSettings,
	getSmtpSettings,
	saveSmtpSettings,
	type SmtpSettings,
} from "../../api/email/emailService.js";
import { useEmailI18n } from "./email-i18n.js";
import { SenderDomainAuthentication } from "./SenderDomainAuthentication.js";

type Provider = "smtp" | "aws-ses";
type Draft = { profile: SmtpSettings; password: string };
type DraftChange = Dispatch<SetStateAction<Draft>>;

function senderState(profile: SmtpSettings): FeatureState {
	if (profile.enabled === false) return "off";
	return profile.authentication_status === "verified" ? "enabled" : "incomplete";
}

function senderComplete({ profile, password }: Draft, provider: Provider) {
	if (!profile.from_email?.trim()) return false;
	return (
		provider === "aws-ses" || Boolean(profile.host?.trim() && (profile.configured || password))
	);
}

function senderPayload({ profile, password }: Draft) {
	const { dkim_selector: _selector, ...rest } = profile;
	return {
		...rest,
		password: password || undefined,
		hourly_quota: profile.hourly_quota || null,
		daily_quota: profile.daily_quota || null,
	};
}

function optionalNumber(value: string) {
	return Number(value) || null;
}

export function SenderIdentities() {
	const { t } = useEmailI18n();
	const { selectedProject } = useProjectSelection();
	const project = selectedProject?.id;
	const [profiles, setProfiles] = useState<SmtpSettings[]>([]);
	const [provider, setProvider] = useState<Provider>("smtp");
	const [awsRegion, setAwsRegion] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [openId, setOpenId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [revision, setRevision] = useState(0);
	const reload = useCallback(() => {
		setRevision((value) => value + 1);
	}, []);
	useEffect(() => {
		if (!project) return;
		let active = true;
		void getSmtpSettings(project).then(
			(result) => {
				if (!active) return;
				setProfiles(result.profiles || (result.id ? [result] : []));
				setProvider(result.provider || "smtp");
				setAwsRegion(result.aws_region || null);
				setError(null);
			},
			(cause: unknown) => {
				if (active) setError(moduleErrorMessage(cause));
			},
		);
		return () => {
			active = false;
		};
	}, [project, revision]);
	if (!project) return <EmptyProject />;
	const opened = profiles.find((profile) => profile.id && profile.id === openId);
	return (
		<div className="flex w-full flex-col gap-8">
			<div className="space-y-4">
				<SettingsSection
					title={t("Sender identities")}
					description={t(
						"Addresses your emails are sent from. Verify the domain of each sender so emails reach the inbox.",
					)}
				>
					{provider === "aws-ses" && (
						<SettingsRow className="flex items-center justify-between gap-4 space-y-0">
							<div className="min-w-0 space-y-0.5">
								<p className="text-sm font-medium">{t("Amazon SES managed delivery")}</p>
								<p className="text-xs text-kumo-subtle">
									{t("{region} · STARTTLS · port 587", { region: awsRegion || t("AWS region") })}
								</p>
								<p className="text-xs text-kumo-subtle">
									{t(
										"Credentials are owned by the central Email Worker. They are never stored in a project or exposed in this interface.",
									)}
								</p>
							</div>
							<StateBadge state="enabled" />
						</SettingsRow>
					)}
					{profiles.length === 0 ? (
						<SettingsRow>
							<p className="text-sm text-kumo-subtle">
								{t(
									"No sender yet. Add one, then verify its domain: emails cannot be delivered without it.",
								)}
							</p>
						</SettingsRow>
					) : (
						profiles.map((profile) => (
							<SettingsRow
								key={profile.id}
								className={cn("p-0", openId === profile.id && "bg-kumo-tint")}
							>
								<button
									type="button"
									className="flex w-full items-center justify-between gap-4 p-4 text-start"
									aria-expanded={openId === profile.id}
									onClick={() => {
										setCreating(false);
										setOpenId((current) => (current === profile.id ? null : (profile.id ?? null)));
									}}
								>
									<span className="min-w-0 space-y-0.5">
										<span className="block text-sm font-medium">{profile.name}</span>
										<span className="block truncate text-xs text-kumo-subtle">
											{[profile.from_email, provider === "aws-ses" ? null : profile.host]
												.filter(Boolean)
												.join(" · ")}
										</span>
									</span>
									<span className="flex shrink-0 items-center gap-3">
										<StateBadge state={senderState(profile)} />
										<ChevronDown
											aria-hidden
											className={cn(
												"size-4 text-kumo-subtle transition-transform",
												openId === profile.id && "rotate-180",
											)}
										/>
									</span>
								</button>
							</SettingsRow>
						))
					)}
				</SettingsSection>
				{error && (
					<p role="alert" className="text-sm text-kumo-danger">
						{error}
					</p>
				)}
				{!creating && (
					<SettingsActions>
						<Button
							icon={Plus}
							onClick={() => {
								setOpenId(null);
								setCreating(true);
							}}
						>
							{t("Add a sender")}
						</Button>
					</SettingsActions>
				)}
			</div>
			{creating && (
				<NewSender
					project={project}
					provider={provider}
					count={profiles.length}
					onCancel={() => {
						setCreating(false);
					}}
					onCreated={(id) => {
						setCreating(false);
						setOpenId(id);
						reload();
					}}
				/>
			)}
			{opened?.id && (
				<SenderDetails
					key={opened.id}
					project={project}
					profileId={opened.id}
					profile={opened}
					provider={provider}
					onSaved={reload}
					onClose={() => {
						setOpenId(null);
					}}
				/>
			)}
		</div>
	);
}

function NewSender({
	project,
	provider,
	count,
	onCancel,
	onCreated,
}: {
	project: string;
	provider: Provider;
	count: number;
	onCancel(): void;
	onCreated(id: string): void;
}) {
	const { t } = useEmailI18n();
	const [draft, setDraft] = useState<Draft>(() => ({
		profile: {
			id: crypto.randomUUID(),
			name: count === 0 ? t("Default") : t("Sender {number}", { number: count + 1 }),
			configured: false,
			port: 587,
			security: "starttls",
			priority: (count + 1) * 100,
			enabled: true,
		},
		password: "",
	}));
	const [busy, setBusy] = useState(false);
	const create = async () => {
		setBusy(true);
		try {
			await saveSmtpSettings(project, senderPayload(draft));
			showSuccessNotification(
				t(
					provider === "aws-ses"
						? "Amazon SES sender identity saved"
						: "SMTP sender profile encrypted and saved",
				),
			);
			onCreated(draft.profile.id ?? "");
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setBusy(false);
		}
	};
	return (
		<form
			className="flex w-full flex-col gap-8"
			onSubmit={(event) => {
				event.preventDefault();
				create().catch(() => undefined);
			}}
		>
			<SenderFields title={t("New sender")} draft={draft} provider={provider} onChange={setDraft} />
			<SenderAdvancedFields draft={draft} onChange={setDraft} />
			<SettingsActions>
				<Button type="button" variant="ghost" onClick={onCancel}>
					{t("Cancel")}
				</Button>
				<Button
					type="submit"
					variant="primary"
					loading={busy}
					disabled={!senderComplete(draft, provider)}
				>
					{t("Add sender")}
				</Button>
			</SettingsActions>
		</form>
	);
}

function SenderDetails({
	project,
	profileId,
	profile,
	provider,
	onSaved,
	onClose,
}: {
	project: string;
	profileId: string;
	profile: SmtpSettings;
	provider: Provider;
	onSaved(): void;
	onClose(): void;
}) {
	const { t } = useEmailI18n();
	const [draft, setDraft] = useState<Draft>({ profile, password: "" });
	const { indicator } = useAutosave({
		resourceKey: profileId,
		value: draft,
		enabled: senderComplete(draft, provider),
		save: async (next) => {
			await saveSmtpSettings(project, senderPayload(next));
			onSaved();
		},
	});
	return (
		<div className="flex w-full flex-col gap-8">
			<SenderFields
				title={draft.profile.name || t("Sender identity")}
				draft={draft}
				provider={provider}
				onChange={setDraft}
			/>
			<SenderDomainAuthentication
				key={profile.from_email}
				project={project}
				profileId={profileId}
				onVerified={onSaved}
			/>
			<SenderAdvancedFields draft={draft} onChange={setDraft} />
			<SettingsActions>
				<Button variant="ghost" onClick={onClose}>
					{t("Close")}
				</Button>
				<DeleteConfirm
					title={t("Delete this sender?")}
					description={t("Emails can no longer be sent from {email}.", {
						email: profile.from_email ?? profile.name ?? "",
					})}
					onConfirm={async () => {
						try {
							await deleteSmtpSettings(project, profileId);
							showSuccessNotification(t("Sender identity deleted"));
							onClose();
							onSaved();
						} catch (cause) {
							showErrorNotification(moduleErrorMessage(cause));
						}
					}}
				>
					<Button
						variant="secondary-destructive"
						icon={Trash2}
						aria-label={t("Delete {name}", { name: profile.name || "" })}
					>
						{t("Delete sender")}
					</Button>
				</DeleteConfirm>
			</SettingsActions>
			{indicator}
		</div>
	);
}

function SenderFields({
	title,
	draft,
	provider,
	onChange,
}: {
	title: string;
	draft: Draft;
	provider: Provider;
	onChange: DraftChange;
}) {
	const { t } = useEmailI18n();
	const { profile, password } = draft;
	const patch = (value: Partial<SmtpSettings>) => {
		onChange((current) => ({ ...current, profile: { ...current.profile, ...value } }));
	};
	return (
		<>
			<SettingsSection title={title} description={t("Name and address your recipients see.")}>
				<SettingsRow>
					<SwitchField
						label={t("Enabled for failover pool")}
						description={t("Senders are used in priority order. A disabled sender is never used.")}
						checked={profile.enabled ?? true}
						onCheckedChange={(enabled) => {
							patch({ enabled });
						}}
					/>
				</SettingsRow>
				<SettingsRow>
					<SettingsTextField
						label={t("Internal name")}
						description={t("Only shown in SuperBoard.")}
						value={profile.name || ""}
						onChange={(event) => {
							patch({ name: event.target.value });
						}}
					/>
				</SettingsRow>
				<SettingsRow>
					<SettingsTextField
						label={t("From name")}
						value={profile.from_name || ""}
						onChange={(event) => {
							patch({ from_name: event.target.value });
						}}
					/>
				</SettingsRow>
				<SettingsRow>
					<SettingsTextField
						label={t("From email")}
						type="email"
						required
						value={profile.from_email || ""}
						onChange={(event) => {
							patch({ from_email: event.target.value });
						}}
					/>
				</SettingsRow>
				<SettingsRow>
					<SettingsTextField
						label={t("Reply-to email (optional)")}
						type="email"
						value={profile.reply_to || ""}
						onChange={(event) => {
							patch({ reply_to: event.target.value || null });
						}}
					/>
				</SettingsRow>
			</SettingsSection>
			{provider === "smtp" && (
				<SettingsSection
					title={t("Sending server")}
					description={t("The SMTP server that delivers the emails of this sender.")}
				>
					<SettingsRow>
						<SettingsTextField
							label={t("SMTP host")}
							required
							value={profile.host || ""}
							onChange={(event) => {
								patch({ host: event.target.value });
							}}
						/>
					</SettingsRow>
					<SettingsRow>
						<SettingsTextField
							label={t("SMTP port")}
							type="number"
							value={profile.port || 587}
							onChange={(event) => {
								patch({ port: Number(event.target.value) });
							}}
						/>
					</SettingsRow>
					<SettingsRow>
						<Select
							className="w-full"
							label={t("SMTP security")}
							value={profile.security || "starttls"}
							onValueChange={(security) => {
								if (typeof security === "string") patch({ security });
							}}
							items={{ tls: t("TLS"), starttls: t("STARTTLS"), plain: t("Plain") }}
						/>
					</SettingsRow>
					<SettingsRow>
						<SettingsTextField
							label={t("Username")}
							value={profile.username || ""}
							onChange={(event) => {
								patch({ username: event.target.value });
							}}
						/>
					</SettingsRow>
					<SettingsRow>
						<SettingsTextField
							label={t("Password")}
							type="password"
							autoComplete="new-password"
							description={
								profile.configured ? t("Leave blank to keep encrypted password") : undefined
							}
							value={password}
							onChange={(event) => {
								const next = event.target.value;
								onChange((current) => ({ ...current, password: next }));
							}}
						/>
					</SettingsRow>
				</SettingsSection>
			)}
		</>
	);
}

function SenderAdvancedFields({ draft, onChange }: { draft: Draft; onChange: DraftChange }) {
	const { t } = useEmailI18n();
	const { profile } = draft;
	const patch = (value: Partial<SmtpSettings>) => {
		onChange((current) => ({ ...current, profile: { ...current.profile, ...value } }));
	};
	return (
		<SettingsSection
			title={t("Advanced")}
			description={t("Order and volume limits used when several senders are available.")}
		>
			<SettingsRow>
				<SettingsTextField
					label={t("Priority")}
					description={t("Senders with a lower number are used first.")}
					type="number"
					value={profile.priority || 100}
					onChange={(event) => {
						patch({ priority: Number(event.target.value) });
					}}
				/>
			</SettingsRow>
			<SettingsRow>
				<SettingsTextField
					label={t("Hourly quota")}
					description={t("Leave empty for no limit.")}
					type="number"
					value={profile.hourly_quota || ""}
					onChange={(event) => {
						patch({ hourly_quota: optionalNumber(event.target.value) });
					}}
				/>
			</SettingsRow>
			<SettingsRow>
				<SettingsTextField
					label={t("Daily quota")}
					description={t("Leave empty for no limit.")}
					type="number"
					value={profile.daily_quota || ""}
					onChange={(event) => {
						patch({ daily_quota: optionalNumber(event.target.value) });
					}}
				/>
			</SettingsRow>
		</SettingsSection>
	);
}
